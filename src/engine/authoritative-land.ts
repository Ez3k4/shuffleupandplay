/**
 * Stage 28E: plan a single transactional land play without mutating inputs.
 * The manual Room controls card contents and presentation. The engine controls
 * timing and the once-per-turn land allowance. GameRoom persists both at once.
 */
import { applyPlayerAction } from "../game/player.ts"
import type { Card, Player } from "../game/types.ts"
import { applyEngineCommand } from "./reducer.ts"
import { inspectTabletopBridge } from "./tabletop-bridge.ts"
import type { EngineState } from "./types.ts"

export type LandAwareEngineState = EngineState & { readonly landPlayedTurnByPlayer?: Readonly<Record<string, number>> }

export type LandPlayFailure =
  | "out_of_sync" | "not_active_player" | "not_priority_holder"
  | "wrong_step" | "stack_not_empty" | "land_limit"
  | "not_land" | "not_in_hand"

export type LandPlayPlan =
  | { readonly ok: true; readonly engine: LandAwareEngineState; readonly players: Player[] }
  | { readonly ok: false; readonly reason: LandPlayFailure }

/** Only explicit, server-imported land metadata qualifies. */
export function isLandCard(card: Pick<Card, "isLand" | "typeLine">): boolean {
  return card.isLand === true || /\bLand\b/i.test(card.typeLine ?? "")
}

/** Returns zero or one; independent of the current priority holder. */
export function landAllowance(engine: EngineState, playerId: string): number {
  const played = (engine as LandAwareEngineState).landPlayedTurnByPlayer?.[playerId] === engine.turnNumber
  return engine.activePlayerId === playerId && !played ? 1 : 0
}

export function planExperimentalLandPlay(options: {
  readonly engine: EngineState
  readonly players: readonly Player[]
  readonly playerId: string
  readonly instanceId: string
}): LandPlayPlan {
  const { engine, players, playerId, instanceId } = options
  if (players.length !== 2 || !engine.playerIds.includes(playerId) ||
      typeof instanceId !== "string" || instanceId.length === 0 || instanceId.length > 128) {
    return { ok: false, reason: "out_of_sync" }
  }
  const player = players.find((p) => p.id === playerId)
  if (!player || player.deckStatus !== "loaded" || inspectTabletopBridge(engine, players).status !== "synced") {
    return { ok: false, reason: "out_of_sync" }
  }
  if (engine.activePlayerId !== playerId) return { ok: false, reason: "not_active_player" }
  if (engine.priorityPlayerId !== playerId) return { ok: false, reason: "not_priority_holder" }
  if (engine.step !== "precombat_main" && engine.step !== "postcombat_main") {
    return { ok: false, reason: "wrong_step" }
  }
  if (engine.stack.length !== 0) return { ok: false, reason: "stack_not_empty" }
  if (landAllowance(engine, playerId) === 0) return { ok: false, reason: "land_limit" }
  const card = player.hand.find((item) => item.instanceId === instanceId)
  if (!card) return { ok: false, reason: "not_in_hand" }
  if (!isLandCard(card)) return { ok: false, reason: "not_land" }

  const scopedId = `${playerId}:${instanceId}`
  const tracked = engine.cards.find((item) => item.instanceId === scopedId)
  if (!tracked || tracked.ownerId !== playerId || tracked.zone !== "hand") {
    return { ok: false, reason: "out_of_sync" }
  }

  const transition = applyEngineCommand(engine, playerId, {
    type: "PROTOTYPE_MOVE_CARD", instanceId: scopedId, toZone: "battlefield",
  })
  if (!transition.accepted) return { ok: false, reason: "out_of_sync" }
  const manual = applyPlayerAction({ player, action: { type: "playFromHand", instanceId } })
  if (manual.hand.length !== player.hand.length - 1 ||
      manual.battlefield.length !== player.battlefield.length + 1 ||
      !manual.battlefield.some((item) => item.instanceId === instanceId)) {
    return { ok: false, reason: "out_of_sync" }
  }
  const nextEngine: LandAwareEngineState = {
    ...transition.state,
    landPlayedTurnByPlayer: {
      ...(engine as LandAwareEngineState).landPlayedTurnByPlayer,
      [playerId]: engine.turnNumber,
    },
  }
  const nextPlayers = players.map((p) => p.id === playerId ? manual : p)
  if (inspectTabletopBridge(nextEngine, nextPlayers).status !== "synced") {
    return { ok: false, reason: "out_of_sync" }
  }
  return { ok: true, engine: nextEngine, players: nextPlayers }
}
