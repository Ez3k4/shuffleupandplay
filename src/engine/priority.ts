import { priorityActorError } from "./guards.ts"
import { nextPriorityWindow } from "./turn.ts"
import type { EngineEvent, EngineState, TransitionResult } from "./types.ts"

/**
 * Model two-player priority passing around the prototype stack.
 *
 * If both players pass, the top object is removed and a placeholder event
 * explicitly indicates that its effect was NOT executed. After that, the
 * active player gets priority again, as in Magic's stack-resolution cycle.
 * A complete engine will replace this placeholder with actual effect rules.
 */
export function passPriority(state: EngineState, playerId: string): TransitionResult {
  const actorError = priorityActorError(state, playerId)
  if (actorError !== null) {
    return { accepted: false, reason: actorError, state, events: [] }
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
    events.push({ type: "stack_effect_not_implemented", objectId: top.id })
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
