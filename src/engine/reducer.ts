import type { EngineCommand } from "./commands.ts"
import { passPriority } from "./priority.ts"
import type { EngineState, TransitionResult } from "./types.ts"

/** Create a deterministic initial state without network, database or random IDs. */
export function createEngineState(playerOneId: string, playerTwoId: string): EngineState {
  if (
    typeof playerOneId !== "string" ||
    typeof playerTwoId !== "string" ||
    !playerOneId.trim() ||
    !playerTwoId.trim() ||
    playerOneId === playerTwoId
  ) {
    throw new Error("An engine game requires two distinct, non-empty player IDs")
  }

  return {
    playerIds: [playerOneId, playerTwoId],
    activePlayerId: playerOneId,
    priorityPlayerId: playerOneId,
    turnNumber: 1,
    step: "upkeep",
    consecutivePasses: 0,
    stack: [],
  }
}

/**
 * Call only with an authenticated player ID once wired to GameRoom.
 * This module intentionally does not persist data or communicate with clients.
 */
export function applyEngineCommand(
  state: EngineState,
  playerId: string,
  command: EngineCommand,
): TransitionResult {
  switch (command.type) {
    case "PASS_PRIORITY":
      return passPriority(state, playerId)
  }
}
