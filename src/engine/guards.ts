import type { EngineRejectionReason, EngineState } from "./types.ts"

/** All player-driven commands in Stage 27B require the current priority holder. */
export function priorityActorError(
  state: EngineState,
  playerId: string,
): Extract<EngineRejectionReason, "unknown_player" | "not_priority_holder"> | null {
  if (!state.playerIds.includes(playerId)) return "unknown_player"
  if (state.priorityPlayerId !== playerId) return "not_priority_holder"
  return null
}
