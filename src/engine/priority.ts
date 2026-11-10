import { nextPriorityWindow } from "./turn.ts"
import type { EngineEvent, EngineState, TransitionResult } from "./types.ts"

/**
 * Two consecutive passes either advance the priority window (empty stack) or
 * pop the top stack placeholder. No real spell/ability effects run yet.
 */
export function passPriority(state: EngineState, playerId: string): TransitionResult {
  if (!state.playerIds.includes(playerId)) {
    return { accepted: false, reason: "unknown_player", state, events: [] }
  }
  if (state.priorityPlayerId !== playerId) {
    return { accepted: false, reason: "not_priority_holder", state, events: [] }
  }

  const events: EngineEvent[] = [{ type: "priority_passed", playerId }]
  const passes = state.consecutivePasses + 1
  if (passes < state.playerIds.length) {
    const nextPlayer = state.playerIds.find((id) => id !== playerId)
    if (nextPlayer === undefined) throw new Error("Engine state has no other player")
    events.push({ type: "priority_granted", playerId: nextPlayer })
    return {
      accepted: true,
      state: { ...state, priorityPlayerId: nextPlayer, consecutivePasses: passes },
      events,
    }
  }

  if (state.stack.length > 0) {
    const top = state.stack[state.stack.length - 1]
    if (top === undefined) throw new Error("Missing top stack object")
    events.push({ type: "stack_object_popped", object: top })
    events.push({ type: "priority_granted", playerId: state.activePlayerId })
    return {
      accepted: true,
      state: {
        ...state,
        stack: state.stack.slice(0, -1),
        priorityPlayerId: state.activePlayerId,
        consecutivePasses: 0,
      },
      events,
    }
  }

  const nextWindow = nextPriorityWindow(state)
  events.push({ type: "step_started", ...nextWindow })
  events.push({ type: "priority_granted", playerId: nextWindow.activePlayerId })
  return {
    accepted: true,
    state: {
      ...state,
      ...nextWindow,
      priorityPlayerId: nextWindow.activePlayerId,
      consecutivePasses: 0,
    },
    events,
  }
}
