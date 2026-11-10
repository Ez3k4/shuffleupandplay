/**
 * Stage 28C: read-only identity bridge between the existing manual tabletop and the
 * experimental rules engine. The manual Room remains authoritative for cards.
 * No engine command may use this bridge to move, draw, or cast a tabletop card.
 */
import type { Card, Player } from "../game/types.ts"
import type { CardInstance, CardZone, EngineState } from "./types.ts"

const ZONES = ["library", "hand", "battlefield", "graveyard", "exile"] as const
const MAX_CARDS_PER_PLAYER = 250

type TabletopPlayer = Pick<Player,
  "id" | "library" | "hand" | "battlefield" | "graveyard" | "exile" | "pendingSpells" | "commander"
>

export type TabletopBridgeSummary = Readonly<{
  mode: "read_only"
  status: "synced" | "out_of_sync"
  linkedCardCount: number
  tabletopCardCount: number
  engineCardCount: number
}>

function definitionId(card: Card): string {
  const scryfallId = typeof card.scryfallId === "string" ? card.scryfallId.trim() : ""
  return scryfallId || (typeof card.name === "string" ? card.name.trim() : "")
}

function validId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value.trim() === value && !/[\u0000-\u001F\u007F]/u.test(value)
}

/**
 * Read stable identities and locations from the server's live room, never from
 * an HTTP body. Reject unsupported zones rather than silently ignoring cards.
 */
function extractCards(players: readonly TabletopPlayer[], expectedIds: readonly string[]): CardInstance[] {
  if (players.length !== 2 || players[0]?.id !== expectedIds[0] || players[1]?.id !== expectedIds[1]) {
    throw new Error("The tabletop participants do not match the engine seats")
  }

  const seen = new Set<string>()
  const cards: CardInstance[] = []
  for (const player of players) {
    if ((player.pendingSpells?.length ?? 0) > 0 || player.commander !== undefined) {
      throw new Error("Pending spells and the command zone are not supported by the Stage 28C bridge")
    }
    const count = ZONES.reduce((sum, zone) => sum + player[zone].length, 0)
    if (count > MAX_CARDS_PER_PLAYER) throw new Error("Too many cards for the Stage 28C bridge")

    for (const zone of ZONES) {
      for (const card of player[zone]) {
        const id = card.instanceId
        const definition = definitionId(card)
        // Legacy deck imports can give both players the same per-deck ID.
        // Namespace with the server-assigned player ID to avoid collisions.
        const scopedId = `${player.id}:${id}`
        if (!validId(id) || !validId(definition) || seen.has(scopedId)) {
          throw new Error("Invalid or duplicated tabletop card identity")
        }
        seen.add(scopedId)
        cards.push({
          instanceId: scopedId,
          definitionId: definition,
          ownerId: player.id,
          controllerId: player.id,
          zone: zone as CardZone,
          zoneOwnerId: zone === "library" || zone === "hand" || zone === "graveyard" ? player.id : null,
        })
      }
    }
  }
  return cards
}

/**
 * Seed the prototype from the *existing* card instance IDs, including cards
 * already in hand or on the battlefield. Never shuffles or changes Room.
 */
export function seedEngineFromTabletop(
  engine: EngineState, players: readonly TabletopPlayer[],
): EngineState {
  if (engine.cards.length !== 0 || engine.nextCardInstanceNumber !== 1) {
    throw new Error("Can only link cards into a fresh engine state")
  }
  const cards = extractCards(players, engine.playerIds)
  return { ...engine, cards, nextCardInstanceNumber: cards.length + 1 }
}

/**
 * Diagnose divergence without modifying either state. The player-specific HTTP
 * view receives only aggregate counts, never private IDs or definition IDs.
 * Library order is significant; changes to that order must invalidate the link.
 */
export function inspectTabletopBridge(
  engine: EngineState, players: readonly TabletopPlayer[],
): TabletopBridgeSummary {
  let tabletop: CardInstance[]
  try {
    tabletop = extractCards(players, engine.playerIds)
  } catch {
    return {
      mode: "read_only", status: "out_of_sync", linkedCardCount: 0,
      tabletopCardCount: 0, engineCardCount: engine.cards.length,
    }
  }
  const engineById = new Map(engine.cards.map((card) => [card.instanceId, card]))
  let linkedCardCount = 0
  for (const card of tabletop) {
    const matched = engineById.get(card.instanceId)
    if (matched && matched.definitionId === card.definitionId &&
      matched.ownerId === card.ownerId && matched.controllerId === card.controllerId &&
      matched.zone === card.zone && matched.zoneOwnerId === card.zoneOwnerId) {
      linkedCardCount++
    }
  }
  const libraryOrderMatches = engine.playerIds.every((id) => {
    const fromEngine = engine.cards.filter((card) => card.ownerId === id && card.zone === "library")
      .map((card) => card.instanceId)
    const fromRoom = tabletop.filter((card) => card.ownerId === id && card.zone === "library")
      .map((card) => card.instanceId)
    return fromEngine.length === fromRoom.length && fromEngine.every((id, index) => id === fromRoom[index])
  })
  const synced = linkedCardCount === tabletop.length &&
    tabletop.length === engine.cards.length && engineById.size === engine.cards.length && libraryOrderMatches
  return {
    mode: "read_only",
    status: synced ? "synced" : "out_of_sync",
    linkedCardCount,
    tabletopCardCount: tabletop.length,
    engineCardCount: engine.cards.length,
  }
}
