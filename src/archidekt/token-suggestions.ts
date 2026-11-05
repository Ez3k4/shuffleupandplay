// Stage 21: Archidekt's Deck Tokens & Extras section is generated from deck
// card abilities. The public deck payload contains the card's oracle text;
// infer a conservative subset that the existing built-in token catalog can
// actually create. Do not claim that this reproduces every official token.
const SUPPORTED_TOKEN_NAMES = [
  ["treasure", "Treasure"], ["food", "Food"], ["clue", "Clue"],
  ["blood", "Blood"], ["map", "Map"], ["gold", "Gold"],
  ["soldier", "Soldier"], ["goblin", "Goblin"],
  ["elf-warrior", "Elf Warrior"], ["saproling", "Saproling"],
  ["spirit", "Spirit"], ["thopter", "Thopter"],
  ["zombie", "Zombie"], ["beast", "Beast"],
] as const

export function deckTokenPresetIds(payload: Record<string, unknown>): string[] {
  const inclusion = new Map<string, boolean>()
  for (const category of recordArray(payload.categories)) {
    const name = stringValue(category.name, "")
    inclusion.set(name, typeof category.includedInDeck === "boolean" ? category.includedInDeck : true)
  }
  const found = new Set<string>()
  for (const entry of recordArray(payload.cards)) {
    const card = record(entry.card)
    const oracle = record(card?.oracleCard)
    const categories = Array.isArray(entry.categories) ? entry.categories : []
    const explicitlyToken = categories.some((category) =>
      typeof category === "string" && /^tokens?(?:\s*&\s*extras)?$/i.test(category.trim()),
    )
    const name = stringValue(card?.displayName, stringValue(oracle?.name, ""))
    if (explicitlyToken) {
      for (const [id, label] of SUPPORTED_TOKEN_NAMES) {
        if (name.toLowerCase() === label.toLowerCase()) found.add(id)
      }
      continue
    }
    if (categories.includes("Sideboard")) continue
    const primaryCategory = categories[0]
    if (typeof primaryCategory === "string" && inclusion.get(primaryCategory) === false) continue
    const text = stringValue(oracle?.text, stringValue(oracle?.oracleText, ""))
      .replace(/<[^>]*>/g, " ")
    // Only scan clauses describing the creation of tokens, not any mention
    // of a token in removal, sacrifice, or reminder text.
    const creationClauses = text.match(/\bcreat(?:e|es|ed|ing)\b[^.!\n]{0,210}\btoken(?:s)?\b/gi) ?? []
    for (const clause of creationClauses) {
      for (const [id, label] of SUPPORTED_TOKEN_NAMES) {
        const pattern = new RegExp(`\\b${label.replace(/[-\s]+/g, "[-\\s]*")}\\b`, "i")
        if (pattern.test(clause)) found.add(id)
      }
    }
  }
  return SUPPORTED_TOKEN_NAMES.filter(([id]) => found.has(id)).map(([id]) => id)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item) => record(item) !== null) : []
}
function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}
