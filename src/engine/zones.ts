import type { EngineCommand } from "./commands.ts"
import { priorityActorError } from "./guards.ts"
import type { CardInstance, CardZone, EngineState, TransitionResult } from "./types.ts"

export type LibrarySeed = {
  readonly playerId: string
  /** Engine-independent card-definition IDs. Top of library first. */
  readonly cardDefinitionIds: readonly string[]
}

/**
 * Trusted setup helper for tests and, eventually, server-side deck loading.
 * Never accept this input directly from a connected browser without first
 * checking card ownership, deck construction and the player's seat.
 */
export function seedEngineLibraries(state: EngineState, libraries: readonly LibrarySeed[]): EngineState {
  if (state.cards.length !== 0 || state.nextCardInstanceNumber !== 1) {
    throw new Error("Prototype libraries can only be seeded into a fresh state")
  }
  if (libraries.length !== state.playerIds.length ||
      new Set(libraries.map((item) => item.playerId)).size !== state.playerIds.length ||
      libraries.some((item) => !state.playerIds.includes(item.playerId))) {
    throw new Error("Exactly one library per seated player is required")
  }
  let nextNumber = 1
  const cards: CardInstance[] = []
  for (const playerId of state.playerIds) {
    const deck = libraries.find((item) => item.playerId === playerId)
    if (deck === undefined || !Array.isArray(deck.cardDefinitionIds) || deck.cardDefinitionIds.length > 250) {
      throw new Error(`Invalid library for player ${playerId}`)
    }
    for (const definitionId of deck.cardDefinitionIds) {
      if (typeof definitionId !== "string" || !definitionId.trim() ||
          definitionId.length > 128 || /[\u0000-\u001F\u007F]/u.test(definitionId)) {
        throw new Error("Invalid card definition ID in library")
      }
      cards.push({
        instanceId: `card-${nextNumber}`,
        definitionId,
        ownerId: playerId,
        controllerId: playerId,
        zone: "library",
        zoneOwnerId: playerId,
      })
      nextNumber += 1
    }
  }
  return { ...state, cards, nextCardInstanceNumber: nextNumber }
}

/** First matching array entry is top of that player's library. */
function firstLibraryCard(state: EngineState, playerId: string): CardInstance | undefined {
  return state.cards.find((card) => card.zone === "library" && card.ownerId === playerId)
}

type DrawCommand = Extract<EngineCommand, { readonly type: "PROTOTYPE_DRAW_CARD" }>
type MoveCommand = Extract<EngineCommand, { readonly type: "PROTOTYPE_MOVE_CARD" }>

/**
 * Test-only manual draw. Real turn-based draw rules, mandatory draws, and
 * losses for empty libraries are intentionally not implemented here.
 */
export function drawPrototypeCard(
  state: EngineState, playerId: string, _command: DrawCommand,
): TransitionResult {
  const actorError = priorityActorError(state, playerId)
  if (actorError !== null) return { accepted: false, reason: actorError, state, events: [] }
  const card = firstLibraryCard(state, playerId)
  if (card === undefined) return { accepted: false, reason: "library_empty", state, events: [] }

  const nextCard: CardInstance = { ...card, zone: "hand", zoneOwnerId: playerId, controllerId: playerId }
  return {
    accepted: true,
    state: {
      ...state,
      cards: state.cards.map((item) => item.instanceId === card.instanceId ? nextCard : item),
      consecutivePasses: 0,
    },
    // Only an aggregate event, never definitionId/instanceId for a hidden draw.
    events: [{ type: "card_drawn", playerId }, { type: "priority_granted", playerId }],
  }
}

const MOVE_DESTINATIONS: readonly CardZone[] = ["hand", "battlefield", "graveyard", "exile"]

/**
 * Test-only zone movement for the acting player's own cards. Does NOT cast,
 * activate abilities, pay costs, target, or check zone-changing permissions.
 * Library placement and moves from library are deliberately forbidden here.
 */
export function movePrototypeCard(
  state: EngineState, playerId: string, command: MoveCommand,
): TransitionResult {
  const actorError = priorityActorError(state, playerId)
  if (actorError !== null) return { accepted: false, reason: actorError, state, events: [] }
  if (typeof command.instanceId !== "string" ||
      !MOVE_DESTINATIONS.includes(command.toZone) ||
      typeof command.toZone !== "string") {
    return { accepted: false, reason: "invalid_zone_move", state, events: [] }
  }
  const card = state.cards.find((item) => item.instanceId === command.instanceId)
  if (!card || card.ownerId !== playerId || card.controllerId !== playerId ||
      card.zone === "library" || card.zone === command.toZone) {
    return { accepted: false, reason: "invalid_zone_move", state, events: [] }
  }

  const fromZone = card.zone
  const nextCard: CardInstance = {
    ...card,
    zone: command.toZone,
    zoneOwnerId: isPersonalZone(command.toZone) ? card.ownerId : null,
    controllerId: card.ownerId,
  }
  return {
    accepted: true,
    state: {
      ...state,
      cards: state.cards.map((item) => item.instanceId === card.instanceId ? nextCard : item),
      consecutivePasses: 0,
    },
    // This is an INTERNAL event; game-room integration must project it per
    // viewer instead of broadcasting all raw engine events.
    events: [{ type: "prototype_card_moved", instanceId: card.instanceId, fromZone, toZone: command.toZone }],
  }
}

function isPersonalZone(zone: CardZone): boolean {
  return zone === "library" || zone === "hand" || zone === "graveyard"
}
