import { resolvePrototypeEffect } from "./effects.ts"
import { priorityActorError } from "./guards.ts"
import { nextPriorityWindow } from "./turn.ts"
import type { EngineEvent, EngineState, TransitionResult } from "./types.ts"

/**
 * Pass priority, resolving one top-of-stack prototype object after both pass.
 * After resolution, grant priority to the active player. All real Magic
 * priority exceptions, triggers, state-based actions etc. remain out of scope.
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
    const popped: EngineState = {
      ...state,
      stack: state.stack.slice(0, -1),
      priorityPlayerId: state.activePlayerId,
      consecutivePasses: 0,
    }
    const resolved = resolvePrototypeEffect(popped, top)
    events.push({ type: "stack_object_popped", object: top })
    events.push(...resolved.events)
    events.push({ type: "priority_granted", playerId: state.activePlayerId })
    return { accepted: true, state: resolved.state, events }
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
