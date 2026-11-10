/**
 * Engine commands express intentions, not HTTP requests or UI events.
 *
 * PROTOTYPE_ANNOUNCE_STACK_OBJECT deliberately does NOT cast a legal Magic
 * spell or activate an actual ability. It only exercises stack/priority flow.
 * In particular, triggered abilities cannot be announced by a player.
 */
export type EngineCommand =
  | { readonly type: "PASS_PRIORITY" }
  | {
      readonly type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT"
      readonly kind: "spell" | "activated_ability"
      readonly description: string
    }
