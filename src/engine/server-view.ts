import { projectPlayerZones, type PlayerZoneView } from "./views.ts"
import type { EngineState, PriorityStep } from "./types.ts"

/** A deliberately restricted view: no raw EngineState, library order, or raw events. */
export type EngineServerView =
  | { readonly status: "inactive"; readonly roomVersion: number }
  | {
      readonly status: "active"
      readonly roomVersion: number
      readonly viewerId: string
      readonly turnNumber: number
      readonly step: PriorityStep
      readonly activePlayerId: string
      readonly priorityPlayerId: string
      readonly lifeTotals: readonly { readonly playerId: string; readonly life: number }[]
      readonly stack: readonly { readonly id: string; readonly kind: string; readonly controllerId: string }[]
      readonly zones: PlayerZoneView
    }

/** Never pass raw engine state, internal events, or stack effects to HTTP clients. */
export function projectEngineServerView(
  state: EngineState | null | undefined,
  viewerId: string,
  roomVersion: number,
): EngineServerView {
  if (!state) return { status: "inactive", roomVersion }
  if (!state.playerIds.includes(viewerId)) throw new Error("Unknown engine viewer")

  return {
    status: "active",
    roomVersion,
    viewerId,
    turnNumber: state.turnNumber,
    step: state.step,
    activePlayerId: state.activePlayerId,
    priorityPlayerId: state.priorityPlayerId,
    lifeTotals: state.playerIds.map((playerId, index) => ({
      playerId,
      life: state.lifeTotals[index] ?? 20,
    })),
    // Effects and descriptions are intentionally withheld for the first server adapter.
    stack: state.stack.map(({ id, kind, controllerId }) => ({ id, kind, controllerId })),
    zones: projectPlayerZones(state, viewerId),
  }
}
