import type { EngineEvent, EngineState, PrototypeEffect, StackObject } from "./types.ts"

/** Reject malformed or oversized prototype effects supplied at runtime. */
export function isValidPrototypeEffect(effect: unknown, playerIds: readonly [string, string]): effect is PrototypeEffect {
  if (typeof effect !== "object" || effect === null || Array.isArray(effect)) return false
  const candidate = effect as Record<string, unknown>
  return (
    candidate.type === "CHANGE_LIFE" &&
    typeof candidate.playerId === "string" &&
    playerIds.includes(candidate.playerId) &&
    typeof candidate.delta === "number" &&
    Number.isSafeInteger(candidate.delta) &&
    candidate.delta !== 0 &&
    Math.abs(candidate.delta) <= 1000
  )
}

/**
 * Resolve one already-validated effect against authoritative state.
 * Deterministic and side-effect free: never mutates the state or stack object.
 * This prototype assumes effects came through the validation in stack.ts.
 */
export function resolvePrototypeEffect(
  state: EngineState,
  object: StackObject,
): { readonly state: EngineState; readonly events: readonly EngineEvent[] } {
  if (object.effect === undefined) {
    return {
      state,
      events: [{ type: "stack_effect_not_implemented", objectId: object.id }],
    }
  }

  const effect = object.effect
  if (!isValidPrototypeEffect(effect, state.playerIds)) {
    // Internal corruption is a programmer/persistence error, not an accepted
    // player action. Never silently apply a malformed saved effect.
    throw new Error(`Invalid persisted prototype effect for ${object.id}`)
  }

  const seat = state.playerIds.indexOf(effect.playerId)
  const before = state.lifeTotals[seat]
  if (before === undefined) throw new Error("Missing player life total")
  const after = before + effect.delta
  if (!Number.isSafeInteger(after)) {
    throw new Error(`Life total overflow while resolving ${object.id}`)
  }

  const lifeTotals: [number, number] = [...state.lifeTotals]
  lifeTotals[seat] = after
  return {
    state: { ...state, lifeTotals },
    events: [
      {
        type: "life_total_changed",
        objectId: object.id,
        playerId: effect.playerId,
        before,
        after,
        delta: effect.delta,
      },
      { type: "stack_effect_resolved", objectId: object.id, effectType: effect.type },
    ],
  }
}
