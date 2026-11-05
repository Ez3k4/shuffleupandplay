/** Resolve real token printings from the Scryfall cards in an Archidekt deck.
 * Archidekt's generated CSS classes are not a stable data API. Scryfall's
 * all_parts[] relations provide explicit token links and official card images.
 * This covers printed linked tokens; it is not guaranteed to reproduce every
 * special case in Archidekt's Deck Tokens & Extras UI.
 */
export type DeckTokenCard = {
  id: string
  name: string
  typeLine: string
  imageUrl: string
  artCropUrl: string
  printedPower?: string
  printedToughness?: string
}

type JsonRecord = Record<string, unknown>
type Fetcher = typeof fetch
const SCRYFALL_COLLECTION = "https://api.scryfall.com/cards/collection"
const SCRYFALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAXIMUM_SOURCE_CARDS = 300
const MAXIMUM_DECK_TOKENS = 90
const COLLECTION_BATCH_SIZE = 75

export async function resolveDeckTokenCards(
  scryfallCardIds: readonly string[],
  request: Fetcher = fetch,
): Promise<DeckTokenCard[]> {
  const ids = [...new Set(scryfallCardIds.filter((id) => SCRYFALL_ID.test(id)))].slice(0, MAXIMUM_SOURCE_CARDS)
  if (!ids.length) return []

  const sourceCards = await fetchCollection(ids, request)
  const referencedIds = new Set<string>()
  for (const card of sourceCards) {
    const typeLine = stringOf(card.type_line)
    if (/\bToken\b/i.test(typeLine) && SCRYFALL_ID.test(stringOf(card.id))) {
      referencedIds.add(stringOf(card.id))
    }
    for (const part of records(card.all_parts)) {
      const id = stringOf(part.id)
      if (part.component === "token" && SCRYFALL_ID.test(id)) referencedIds.add(id)
    }
  }

  const tokenCards = await fetchCollection([...referencedIds].slice(0, MAXIMUM_DECK_TOKENS * 3), request)
  const distinct = new Set<string>()
  const tokens: DeckTokenCard[] = []
  for (const card of tokenCards) {
    const id = stringOf(card.id)
    const name = stringOf(card.name)
    const typeLine = stringOf(card.type_line)
    if (!SCRYFALL_ID.test(id) || !name || !/\bToken\b/i.test(typeLine)) continue
    const image = record(card.image_uris) ?? record(records(card.card_faces)[0]?.image_uris)
    const imageUrl = trustedImage(image?.normal) ?? scryfallImage(id, "normal")
    const artCropUrl = trustedImage(image?.art_crop) ?? scryfallImage(id, "art_crop")
    const power = statOf(card.power)
    const toughness = statOf(card.toughness)
    // Keep distinct color and P/T variants without flooding the picker with
    // alternate printings of the same token type.
    const colors = Array.isArray(card.colors) ? card.colors.filter((c): c is string => typeof c === "string").join("") : ""
    const key = `${name}\u0000${typeLine}\u0000${power ?? ""}/${toughness ?? ""}\u0000${colors}`.toLowerCase()
    if (distinct.has(key)) continue
    distinct.add(key)
    tokens.push({
      id, name, typeLine, imageUrl, artCropUrl,
      ...(power === undefined ? {} : { printedPower: power }),
      ...(toughness === undefined ? {} : { printedToughness: toughness }),
    })
    if (tokens.length >= MAXIMUM_DECK_TOKENS) break
  }
  return tokens.sort((a, b) => a.name.localeCompare(b.name) || a.typeLine.localeCompare(b.typeLine))
}

async function fetchCollection(ids: readonly string[], request: Fetcher): Promise<JsonRecord[]> {
  const cards: JsonRecord[] = []
  for (let i = 0; i < ids.length; i += COLLECTION_BATCH_SIZE) {
    const response = await request(SCRYFALL_COLLECTION, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ identifiers: ids.slice(i, i + COLLECTION_BATCH_SIZE).map((id) => ({ id })) }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error(`Scryfall token lookup failed (HTTP ${response.status})`)
    const result: unknown = await response.json()
    const payload = record(result)
    if (!payload || !Array.isArray(payload.data)) throw new Error("Unexpected Scryfall token response")
    cards.push(...records(payload.data))
  }
  return cards
}

function scryfallImage(id: string, variant: "normal" | "art_crop"): string {
  return `https://cards.scryfall.io/${variant}/front/${id[0]}/${id[1]}/${id}.jpg`
}
function trustedImage(value: unknown): string | null {
  if (typeof value !== "string") return null
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "cards.scryfall.io" ? value : null } catch { return null }
}
function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null
}
function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => record(item) !== null) : []
}
function stringOf(value: unknown): string { return typeof value === "string" ? value : "" }
function statOf(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}


// ===== Stage 23: global searchable token catalog =====
// Search is independent of Archidekt and its sometimes incomplete all_parts links.
// Scryfall excludes extras by default; include_extras is essential for tokens.
const TOKEN_SEARCH_URL = "https://api.scryfall.com/cards/search"
const TOKEN_CACHE_TTL = 15 * 60_000
const TOKEN_CACHE_LIMIT = 160
const catalogCache = new Map<string, { expires: number; result: TokenSearchResult }>()
const cardCache = new Map<string, DeckTokenCard>()

export type TokenSearchResult = {
  tokens: DeckTokenCard[]
  hasMore: boolean
  page: number
}

/** Strictly validate the token definition attached to a server action. */
export function parseTokenDefinition(value: unknown): DeckTokenCard | null {
  const card = record(value)
  if (!card) return null
  const id = stringOf(card.id)
  const name = stringOf(card.name)
  const typeLine = stringOf(card.typeLine)
  const imageUrl = trustedImage(card.imageUrl)
  const artCropUrl = trustedImage(card.artCropUrl)
  if (!SCRYFALL_ID.test(id) || !name || name.length > 120 ||
      !/\bToken\b/i.test(typeLine) || typeLine.length > 180 || !imageUrl || !artCropUrl) return null
  const power = statOf(card.printedPower)
  const toughness = statOf(card.printedToughness)
  if ((power && !/^[-+*0-9?Xx/]{1,12}$/.test(power)) ||
      (toughness && !/^[-+*0-9?Xx/]{1,12}$/.test(toughness))) return null
  return {
    id, name, typeLine, imageUrl, artCropUrl,
    ...(power === undefined ? {} : { printedPower: power }),
    ...(toughness === undefined ? {} : { printedToughness: toughness }),
  }
}

function tokenFromScryfall(value: unknown): DeckTokenCard | null {
  const card = record(value)
  if (!card || !/\bToken\b/i.test(stringOf(card.type_line))) return null
  const id = stringOf(card.id)
  if (!SCRYFALL_ID.test(id)) return null
  const images = record(card.image_uris) ?? record(records(card.card_faces)[0]?.image_uris)
  return parseTokenDefinition({
    id,
    name: card.name,
    typeLine: card.type_line,
    imageUrl: trustedImage(images?.normal) ?? scryfallImage(id, "normal"),
    artCropUrl: trustedImage(images?.art_crop) ?? scryfallImage(id, "art_crop"),
    ...(statOf(card.power) === undefined ? {} : { printedPower: statOf(card.power) }),
    ...(statOf(card.toughness) === undefined ? {} : { printedToughness: statOf(card.toughness) }),
  })
}

function rememberToken(token: DeckTokenCard): void {
  if (cardCache.size > 1600) cardCache.delete(cardCache.keys().next().value ?? "")
  cardCache.set(token.id, token)
}

export async function searchPrintedTokens(
  query: string,
  page = 1,
  request: Fetcher = fetch,
): Promise<TokenSearchResult> {
  // Only search token names, never raw Scryfall search expressions from users.
  const safeQuery = query.trim().replace(/[\"\\]/g, " ").slice(0, 64)
  const safePage = Number.isSafeInteger(page) && page >= 1 && page <= 50 ? page : 1
  const cacheKey = `${safeQuery.toLowerCase()}:${safePage}`
  const cached = request === fetch ? catalogCache.get(cacheKey) : undefined
  if (cached && cached.expires > Date.now()) return cached.result

  const url = new URL(TOKEN_SEARCH_URL)
  url.searchParams.set("q", `t:token${safeQuery ? ` name:${JSON.stringify(safeQuery)}` : ""}`)
  url.searchParams.set("include_extras", "true")
  url.searchParams.set("unique", "cards")
  url.searchParams.set("order", "name")
  url.searchParams.set("page", String(safePage))

  const response = await request(url.toString(), {
    headers: { accept: "application/json", "user-agent": "shuffleupandplay/0.1 (private tabletop token search)" },
    signal: AbortSignal.timeout(10_000),
  })
  // Scryfall returns 404 for a valid search with no matches.
  if (response.status === 404) return { tokens: [], hasMore: false, page: safePage }
  if (!response.ok) throw new Error(`Scryfall token search failed (HTTP ${response.status})`)
  const payload: unknown = await response.json()
  const json = record(payload)
  if (!json || !Array.isArray(json.data)) throw new Error("Unexpected Scryfall token search response")
  const tokens = records(json.data).map(tokenFromScryfall).filter((token): token is DeckTokenCard => token !== null)
  for (const token of tokens) rememberToken(token)
  const result: TokenSearchResult = { tokens, hasMore: json.has_more === true, page: safePage }
  if (request === fetch) {
    if (catalogCache.size >= TOKEN_CACHE_LIMIT) catalogCache.delete(catalogCache.keys().next().value ?? "")
    catalogCache.set(cacheKey, { expires: Date.now() + TOKEN_CACHE_TTL, result })
  }
  return result
}

/** Validate the chosen UUID against Scryfall, not against the deck's token list. */
export async function lookupPrintedToken(
  id: string,
  request: Fetcher = fetch,
): Promise<DeckTokenCard | null> {
  if (!SCRYFALL_ID.test(id)) return null
  if (request === fetch && cardCache.has(id)) return cardCache.get(id) ?? null
  const response = await request(`https://api.scryfall.com/cards/${id}`, {
    headers: { accept: "application/json", "user-agent": "shuffleupandplay/0.1 (private tabletop token lookup)" },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Scryfall token lookup failed (HTTP ${response.status})`)
  const token = tokenFromScryfall(await response.json())
  if (token && request === fetch) rememberToken(token)
  return token
}
