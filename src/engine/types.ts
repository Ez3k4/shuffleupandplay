/**
 * Stage 27A is an isolated two-player turn/priority prototype.
 * It does not yet implement draw/untap actions, combat choices, triggers,
 * state-based actions, casting, or effects. It is not wired to GameRoom.
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

/** Placeholder entry to exercise stack ordering; effects are not executed yet. */
export interface StackObject {
  readonly id: string
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
}

export type EngineEvent =
  | { readonly type: "priority_passed"; readonly playerId: string }
  | { readonly type: "priority_granted"; readonly playerId: string }
  | { readonly type: "step_started"; readonly step: PriorityStep; readonly turnNumber: number; readonly activePlayerId: string }
  | { readonly type: "stack_object_popped"; readonly object: StackObject }

export type TransitionResult =
  | {
      readonly accepted: true
      readonly state: EngineState
      readonly events: readonly EngineEvent[]
    }
  | {
      readonly accepted: false
      readonly reason: "unknown_player" | "not_priority_holder"
      readonly state: EngineState
      readonly events: readonly []
    }
