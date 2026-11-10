import type { PrototypeEffect } from "./types.ts"

/**
 * Engine commands express player intentions, not HTTP requests or UI events.
 *
 * PROTOTYPE_ANNOUNCE_STACK_OBJECT does NOT cast a legal spell or pay costs.
 * Its optional effect is for isolated rules-engine tests only. A real client
 * must never be allowed to choose arbitrary life-total adjustments.
 */
export type EngineCommand =
  | { readonly type: "PASS_PRIORITY" }
  /** Test-only draw. Not tied to draw steps or actual Magic rules. */
  | { readonly type: "PROTOTYPE_DRAW_CARD" }
  /** Test-only move. Does not pay casting costs or validate legal plays. */
  | { readonly type: "PROTOTYPE_MOVE_CARD"; readonly instanceId: string; readonly toZone: "hand" | "battlefield" | "graveyard" | "exile" }
  | {
      readonly type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT"
      readonly kind: "spell" | "activated_ability"
      readonly description: string
      readonly effect?: PrototypeEffect
    }
