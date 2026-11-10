/**
 * Stage 28D: plan one experimental card draw in two representations, atomically.
 *
 * The live manual tabletop Room is still authoritative for card contents and
 * ordering. The engine tracks a linked projection and enforces priority.
 * This function does NOT mutate either input or perform persistence/IO.
 * The GameRoom actor must commit both returned values in the same operation.
 */
import { applyPlayerAction } from "../game/player.ts"
import type { Player } from "../game/types.ts"
import { applyEngineCommand } from "./reducer.ts"
import { inspectTabletopBridge } from "./tabletop-bridge.ts"
import type { EngineState } from "./types.ts"

export type ExperimentalDrawFailure =
  | "out_of_sync"
  | "not_priority_holder"
  | "library_empty"

export type ExperimentalDrawPlan =
  | {
      readonly ok: true
      readonly engine: EngineState
      readonly players: Player[]
    }
  | {
      readonly ok: false
      readonly reason: ExperimentalDrawFailure
    }

/**
 * The command takes only a server-authenticated player ID, never a client card
 * ID. The next card is drawn from the existing live library in its known order.
 */
export function planExperimentalDraw(options: {
  readonly engine: EngineState
  readonly players: readonly Player[]
  readonly playerId: string
}): ExperimentalDrawPlan {
  const { engine, players, playerId } = options
  const player = players.find((item) => item.id === playerId)
  if (!player || !engine.playerIds.includes(playerId) || players.length !== 2) {
    return { ok: false, reason: "out_of_sync" }
  }
  if (playerId !== engine.priorityPlayerId) {
    return { ok: false, reason: "not_priority_holder" }
  }
  if (player.deckStatus !== "loaded" || inspectTabletopBridge(engine, players).status !== "synced") {
    return { ok: false, reason: "out_of_sync" }
  }

  const top = player.library[0]
  if (!top) return { ok: false, reason: "library_empty" }

  // The Stage 28C bridge namespaces deck instance IDs with their player ID.
  const linkedTopId = `${player.id}:${top.instanceId}`
  const engineTop = engine.cards.find((card) => card.zone === "library" && card.ownerId === playerId)
  if (engineTop?.instanceId !== linkedTopId) return { ok: false, reason: "out_of_sync" }

  // The prototype draw transition checks priority and moves the correct engine
  // object. It does not modify the manual Room or execute spell/card effects.
  const transition = applyEngineCommand(engine, playerId, { type: "PROTOTYPE_DRAW_CARD" })
  if (!transition.accepted) {
    return { ok: false, reason: transition.reason === "library_empty" ? "library_empty" : "not_priority_holder" }
  }

  // Reuse the same proven tabletop draw action as the manual UI. This is not a
  // second draw: both results are computed from their original states.
  const updatedPlayer = applyPlayerAction({ player, action: { type: "drawCard", count: 1 } })
  if (
    updatedPlayer.library.length !== player.library.length - 1 ||
    updatedPlayer.hand.length !== player.hand.length + 1 ||
    updatedPlayer.hand.at(-1)?.instanceId !== top.instanceId ||
    transition.state.cards.find((card) => card.instanceId === linkedTopId)?.zone !== "hand"
  ) {
    return { ok: false, reason: "out_of_sync" }
  }

  const updatedPlayers = players.map((candidate) => candidate.id === playerId ? updatedPlayer : candidate)
  if (inspectTabletopBridge(transition.state, updatedPlayers).status !== "synced") {
    return { ok: false, reason: "out_of_sync" }
  }
  return { ok: true, engine: transition.state, players: updatedPlayers }
}
