import { PRIORITY_STEPS, type EngineState, type PriorityStep } from "./types.ts"

/**
 * Only priority windows are modeled for Stage 27A. Untap and cleanup are
 * automatic/no-priority steps in ordinary games and are omitted for now.
 * This is NOT a complete implementation of Magic's turn rules.
 */
export function nextPriorityWindow(state: EngineState): {
  readonly step: PriorityStep
  readonly activePlayerId: string
  readonly turnNumber: number
} {
  const index = PRIORITY_STEPS.indexOf(state.step)
  if (index < PRIORITY_STEPS.length - 1) {
    const step = PRIORITY_STEPS[index + 1]
    if (step === undefined) throw new Error("Missing next priority step")
    return { step, activePlayerId: state.activePlayerId, turnNumber: state.turnNumber }
  }

  const nextPlayer = state.playerIds.find((id) => id !== state.activePlayerId)
  if (nextPlayer === undefined) throw new Error("Engine state has no next player")

  return { step: "upkeep", activePlayerId: nextPlayer, turnNumber: state.turnNumber + 1 }
}
