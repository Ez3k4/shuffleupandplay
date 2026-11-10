import type { EngineCommand } from "./commands.ts"
import { priorityActorError } from "./guards.ts"
import type { EngineState, StackObject, TransitionResult } from "./types.ts"

type Announcement = Extract<EngineCommand, { readonly type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT" }>

/**
 * Add a synthetic stack object for exercising priority and response ordering.
 *
 * This operation is *not* a CAST_SPELL or ACTIVATE_ABILITY implementation:
 * it checks neither game rules nor costs, legal targets, source ownership, etc.
 * Never expose it to real game clients as an unrestricted action.
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

  // Commands may eventually originate as untrusted JSON, so check at runtime
  // instead of trusting TypeScript's compile-time union alone.
  if (
    (command.kind !== "spell" && command.kind !== "activated_ability") ||
    typeof command.description !== "string" ||
    command.description.trim().length === 0 ||
    command.description.trim().length > 160 ||
    /[\u0000-\u001F\u007F]/u.test(command.description)
  ) {
    return { accepted: false, reason: "invalid_stack_object", state, events: [] }
  }

  const object: StackObject = {
    id: `stack-${state.nextStackObjectNumber}`,
    kind: command.kind,
    controllerId: playerId, // Never trust a client-supplied controller.
    description: command.description.trim(),
  }
  return {
    accepted: true,
    state: {
      ...state,
      stack: [...state.stack, object],
      nextStackObjectNumber: state.nextStackObjectNumber + 1,
      priorityPlayerId: playerId,
      consecutivePasses: 0, // A new action breaks a pending sequence of passes.
    },
    events: [
      { type: "stack_object_added", object },
      { type: "priority_granted", playerId },
    ],
  }
}
