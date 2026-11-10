import type { EngineCommand } from "./commands.ts"
import { isValidPrototypeEffect } from "./effects.ts"
import { priorityActorError } from "./guards.ts"
import type { EngineState, StackObject, TransitionResult } from "./types.ts"

type Announcement = Extract<EngineCommand, { readonly type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT" }>

/**
 * Insert a synthetic object for testing priority and effect execution.
 * NOT legal spell casting or real ability activation: no costs, targets,
 * ownership, timings, permissions or replacement effects are implemented.
 */
export function announcePrototypeStackObject(
  state: EngineState,
  playerId: string,
  command: Announcement,
): TransitionResult {
  const actorError = priorityActorError(state, playerId)
  if (actorError !== null) {
    return { accepted: false, reason: actorError, state, events: [] }
  }

  if (
    (command.kind !== "spell" && command.kind !== "activated_ability") ||
    typeof command.description !== "string" ||
    command.description.trim().length === 0 ||
    command.description.trim().length > 160 ||
    /[\u0000-\u001F\u007F]/u.test(command.description)
  ) {
    return { accepted: false, reason: "invalid_stack_object", state, events: [] }
  }
  if (command.effect !== undefined && !isValidPrototypeEffect(command.effect, state.playerIds)) {
    return { accepted: false, reason: "invalid_effect", state, events: [] }
  }

  // Reconstruct the validated effect to prevent retaining caller-controlled
  // references or unexpected properties in persistent authoritative state.
  const object: StackObject = {
    id: `stack-${state.nextStackObjectNumber}`,
    kind: command.kind,
    controllerId: playerId,
    description: command.description.trim(),
    ...(command.effect === undefined ? {} : {
      effect: {
        type: command.effect.type,
        playerId: command.effect.playerId,
        delta: command.effect.delta,
      },
    }),
  }
  return {
    accepted: true,
    state: {
      ...state,
      stack: [...state.stack, object],
      nextStackObjectNumber: state.nextStackObjectNumber + 1,
      priorityPlayerId: playerId,
      consecutivePasses: 0,
    },
    events: [
      { type: "stack_object_added", object },
      { type: "priority_granted", playerId },
    ],
  }
}
