/**
 * Isolated two-player Magic engine prototype.
 *
 * Stage 27B adds a typed stack and deterministic prototype announcement command.
 * It does NOT validate casting legality, charge mana, or execute card effects.
 */
export const PRIORITY_STEPS = [
  "upkeep",
  "draw",
  "precombat_main",
  "beginning_of_combat",
  "declare_attackers",
  "declare_blockers",
  "combat_damage",
  "end_of_combat",
  "postcombat_main",
  "end_step",
] as const

export type PriorityStep = (typeof PRIORITY_STEPS)[number]

/** These are stack-entry categories, not implemented rules for casting/triggering. */
export type StackObjectKind = "spell" | "activated_ability" | "triggered_ability"

/** Objects on the prototype stack; identifiers are allocated by the reducer. */
export interface StackObject {
  readonly id: string
  readonly kind: StackObjectKind
  readonly controllerId: string
  readonly description: string
}

export interface EngineState {
  /** Exactly two participants; stored in seat/turn order. */
  readonly playerIds: readonly [string, string]
  readonly activePlayerId: string
  readonly priorityPlayerId: string
  readonly turnNumber: number
  readonly step: PriorityStep
  readonly consecutivePasses: number
  readonly stack: readonly StackObject[]
  /** Monotonic counter persists with the game state; no random IDs. */
  readonly nextStackObjectNumber: number
}

/**
 * Events describe the accepted transition. State is authoritative; events are
 * for tests, future animations and logging, not an event-sourced database.
 */
export type EngineEvent =
  | { readonly type: "priority_passed"; readonly playerId: string }
  | { readonly type: "priority_granted"; readonly playerId: string }
  | {
      readonly type: "step_started"
      readonly step: PriorityStep
      readonly turnNumber: number
      readonly activePlayerId: string
    }
  | { readonly type: "stack_object_added"; readonly object: StackObject }
  | { readonly type: "stack_object_popped"; readonly object: StackObject }
  | { readonly type: "stack_effect_not_implemented"; readonly objectId: string }

export type EngineRejectionReason =
  | "unknown_player"
  | "not_priority_holder"
  | "invalid_stack_object"

export type TransitionResult =
  | {
      readonly accepted: true
      readonly state: EngineState
      readonly events: readonly EngineEvent[]
    }
  | {
      readonly accepted: false
      readonly reason: EngineRejectionReason
      readonly state: EngineState
      readonly events: readonly []
    }
