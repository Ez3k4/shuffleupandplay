/**
 * Isolated two-player Magic engine prototype.
 *
 * Stage 27C adds a deterministic life-total effect. This is NOT a complete
 * implementation of damage, targeting, costs, casting or game-loss rules.
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
export type StackObjectKind = "spell" | "activated_ability" | "triggered_ability"

/**
 * A deliberately small, data-only effect vocabulary.
 * `CHANGE_LIFE` changes a life total; it is NOT damage and doesn't trigger
 * damage-related abilities or implement targeting/replacement effects.
 */
export type PrototypeEffect = {
  readonly type: "CHANGE_LIFE"
  readonly playerId: string
  readonly delta: number
}

/** Objects on the prototype stack; identifiers are allocated by the reducer. */
export interface StackObject {
  readonly id: string
  readonly kind: StackObjectKind
  readonly controllerId: string
  readonly description: string
  /** Absent on Stage 27B-compatible placeholders, which remain unresolved. */
  readonly effect?: PrototypeEffect
}

export interface EngineState {
  /** Exactly two participants, stored in seat/turn order. */
  readonly playerIds: readonly [string, string]
  /** Indexed by playerIds, NOT keyed by arbitrary client-controlled strings. */
  readonly lifeTotals: readonly [number, number]
  readonly activePlayerId: string
  readonly priorityPlayerId: string
  readonly turnNumber: number
  readonly step: PriorityStep
  readonly consecutivePasses: number
  readonly stack: readonly StackObject[]
  /** Monotonic counter persists with the game state; no random IDs. */
  readonly nextStackObjectNumber: number
}

/** Events describe transitions; the authoritative state is the source of truth. */
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
  | {
      readonly type: "life_total_changed"
      readonly objectId: string
      readonly playerId: string
      readonly before: number
      readonly after: number
      readonly delta: number
    }
  | { readonly type: "stack_effect_resolved"; readonly objectId: string; readonly effectType: "CHANGE_LIFE" }

export type EngineRejectionReason =
  | "unknown_player"
  | "not_priority_holder"
  | "invalid_stack_object"
  | "invalid_effect"

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
