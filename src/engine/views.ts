import type { CardInstance, CardZone, EngineState } from "./types.ts"

type HiddenZone = "library" | "hand"

export type VisibleCard = Readonly<Pick<CardInstance,
  "instanceId" | "definitionId" | "ownerId" | "controllerId" | "zone" | "zoneOwnerId"
>>

export interface PlayerZoneView {
  readonly viewerId: string
  /** Own hand and public, face-up zones. No opponent hand or library cards. */
  readonly visibleCards: readonly VisibleCard[]
  /** No instance IDs or definition IDs in hidden-zone counts. */
  readonly hiddenZones: readonly {
    readonly playerId: string
    readonly zone: HiddenZone
    readonly count: number
  }[]
}

/**
 * Player-specific *card-zone* projection for a future browser adapter.
 * Library contents are hidden even from their owner until drawn/revealed.
 * Public battlefield, graveyards and exile are assumed face-up for Stage 27D;
 * facedown and revealed cards will need additional visibility rules later.
 * Do not serialize EngineState or raw EngineEvent objects to clients.
 */
export function projectPlayerZones(state: EngineState, viewerId: string): PlayerZoneView {
  if (!state.playerIds.includes(viewerId)) throw new Error("Unknown viewer")
  const visibleCards: VisibleCard[] = state.cards
    .filter((card) => isPublic(card.zone) || (card.zone === "hand" && card.ownerId === viewerId))
    .map((card) => ({
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      ownerId: card.ownerId,
      controllerId: card.controllerId,
      zone: card.zone,
      zoneOwnerId: card.zoneOwnerId,
    }))
  const hiddenZones = state.playerIds.flatMap((playerId) => ([
    {
      playerId, zone: "library" as const,
      count: state.cards.filter((card) => card.ownerId === playerId && card.zone === "library").length,
    },
    {
      playerId, zone: "hand" as const,
      count: state.cards.filter((card) => card.ownerId === playerId && card.zone === "hand").length,
    },
  ]))
  return { viewerId, visibleCards, hiddenZones }
}

function isPublic(zone: CardZone): boolean {
  return zone === "battlefield" || zone === "graveyard" || zone === "exile"
}
