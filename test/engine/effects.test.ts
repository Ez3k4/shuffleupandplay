import { describe, expect, test } from "vitest"
import { applyEngineCommand, createEngineState } from "../../src/engine/reducer.ts"
import type { EngineCommand } from "../../src/engine/commands.ts"
import type { EngineState, PrototypeEffect, TransitionResult } from "../../src/engine/types.ts"

function accept(result: TransitionResult): Extract<TransitionResult, { accepted: true }> {
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error(`Rejected: ${result.reason}`)
  return result
}

function announce(
  state: EngineState,
  playerId: string,
  effect?: unknown,
) {
  return applyEngineCommand(state, playerId, {
    type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT",
    kind: "spell",
    description: "Prototype life effect",
    ...(effect === undefined ? {} : { effect }),
  } as EngineCommand)
}

function pass(state: EngineState) {
  return accept(applyEngineCommand(state, state.priorityPlayerId, { type: "PASS_PRIORITY" }))
}

function resolveTop(state: EngineState) {
  return pass(pass(state).state)
}

const effect = (playerId: string, delta: number): PrototypeEffect => ({
  type: "CHANGE_LIFE", playerId, delta,
})

describe("Stage 27C deterministic prototype effects", () => {
  test("initial state has 20 life per seat, without changing Stage 27B priority behavior", () => {
    const initial = createEngineState("alice", "bob")
    expect(initial.lifeTotals).toEqual([20, 20])
    expect(pass(initial).state.lifeTotals).toEqual([20, 20])
  })

  test("effects are only queued on announcement; life does not change until two passes", () => {
    const initial = createEngineState("alice", "bob")
    const added = accept(announce(initial, "alice", effect("bob", -3)))
    expect(initial.lifeTotals).toEqual([20, 20])
    expect(added.state.lifeTotals).toEqual([20, 20])
    expect(added.state.stack[0]?.effect).toEqual(effect("bob", -3))
    expect(added.events.map((e) => e.type)).toEqual(["stack_object_added", "priority_granted"])

    const firstPass = pass(added.state)
    expect(firstPass.state.lifeTotals).toEqual([20, 20])
    const result = pass(firstPass.state)
    expect(result.state.lifeTotals).toEqual([20, 17])
    expect(result.state.stack).toEqual([])
    expect(result.state.priorityPlayerId).toBe("alice")
    expect(result.state.consecutivePasses).toBe(0)
    expect(result.state.step).toBe("upkeep")
    expect(result.events).toEqual([
      { type: "priority_passed", playerId: "bob" },
      { type: "stack_object_popped", object: added.state.stack[0] },
      { type: "life_total_changed", objectId: "stack-1", playerId: "bob", before: 20, after: 17, delta: -3 },
      { type: "stack_effect_resolved", objectId: "stack-1", effectType: "CHANGE_LIFE" },
      { type: "priority_granted", playerId: "alice" },
    ])
  })

  test("can increase life and can target the controller", () => {
    const result = resolveTop(accept(announce(createEngineState("alice", "bob"), "alice", effect("alice", 5))).state)
    expect(result.state.lifeTotals).toEqual([25, 20])
  })

  test("response effects resolve in LIFO order, one per pair of passes", () => {
    let state = accept(announce(createEngineState("alice", "bob"), "alice", effect("bob", -3))).state
    state = pass(state).state
    state = accept(announce(state, "bob", effect("bob", 7))).state
    expect(state.stack.map((entry) => entry.id)).toEqual(["stack-1", "stack-2"])
    const first = resolveTop(state)
    expect(first.state.lifeTotals).toEqual([20, 27])
    expect(first.state.stack.map((entry) => entry.id)).toEqual(["stack-1"])
    const second = resolveTop(first.state)
    expect(second.state.lifeTotals).toEqual([20, 24])
    expect(second.state.stack).toEqual([])
    expect(resolveTop(second.state).state.step).toBe("draw")
  })

  test("legacy placeholders without effects retain the not-implemented event", () => {
    const added = accept(announce(createEngineState("alice", "bob"), "alice"))
    const result = resolveTop(added.state)
    expect(result.state.lifeTotals).toEqual([20, 20])
    expect(result.events).toContainEqual({ type: "stack_effect_not_implemented", objectId: "stack-1" })
    expect(result.events.map((evt) => evt.type)).not.toContain("stack_effect_resolved")
  })

  test.each([
    ["unknown player", { type: "CHANGE_LIFE", playerId: "eve", delta: -3 }],
    ["wrong type", { type: "DEAL_DAMAGE", playerId: "alice", delta: -3 }],
    ["string amount", { type: "CHANGE_LIFE", playerId: "alice", delta: "-3" }],
    ["zero amount", { type: "CHANGE_LIFE", playerId: "alice", delta: 0 }],
    ["fraction", { type: "CHANGE_LIFE", playerId: "alice", delta: 1.5 }],
    ["NaN", { type: "CHANGE_LIFE", playerId: "alice", delta: NaN }],
    ["infinite", { type: "CHANGE_LIFE", playerId: "alice", delta: Infinity }],
    ["oversized", { type: "CHANGE_LIFE", playerId: "alice", delta: 1001 }],
    ["null", null],
    ["array", []],
  ])("rejects invalid effect %s without mutation", (_label, badEffect) => {
    const initial = createEngineState("alice", "bob")
    const result = announce(initial, "alice", badEffect)
    expect(result).toMatchObject({ accepted: false, reason: "invalid_effect", events: [] })
    expect(result.state).toBe(initial)
    expect(initial.lifeTotals).toEqual([20, 20])
    expect(initial.stack).toEqual([])
  })

  test("unknown actors and players without priority cannot announce effects", () => {
    const state = createEngineState("alice", "bob")
    expect(announce(state, "eve", effect("alice", 5))).toMatchObject({ accepted: false, reason: "unknown_player" })
    expect(announce(state, "bob", effect("alice", 5))).toMatchObject({ accepted: false, reason: "not_priority_holder" })
  })

  test("copies validated effects so caller mutations cannot change queued results", () => {
    const initial = createEngineState("alice", "bob")
    const input = { type: "CHANGE_LIFE", playerId: "bob", delta: -3, accidental: "not stored" }
    const result = accept(announce(initial, "alice", input))
    input.delta = 99
    expect(result.state.stack[0]?.effect).toEqual(effect("bob", -3))
    expect(resolveTop(result.state).state.lifeTotals).toEqual([20, 17])
  })

  test("works on deeply frozen state and doesn't mutate input life totals", () => {
    const state = createEngineState("alice", "bob")
    Object.freeze(state.lifeTotals)
    Object.freeze(state.playerIds)
    Object.freeze(state.stack)
    Object.freeze(state)
    const added = accept(announce(state, "alice", effect("bob", -3)))
    Object.freeze(added.state.stack[0]?.effect)
    Object.freeze(added.state.stack[0])
    Object.freeze(added.state.stack)
    Object.freeze(added.state)
    const resolved = resolveTop(added.state)
    expect(resolved.state.lifeTotals).toEqual([20, 17])
    expect(added.state.lifeTotals).toEqual([20, 20])
    expect(state.lifeTotals).toEqual([20, 20])
  })

  test("same state and actions are deterministic JSON-safe values", () => {
    const command: EngineCommand = {
      type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT", kind: "spell", description: "Lose 3", effect: effect("bob", -3),
    }
    const run = () => {
      const announced = accept(applyEngineCommand(createEngineState("alice", "bob"), "alice", command))
      return resolveTop(announced.state)
    }
    expect(run()).toEqual(run())
    expect(JSON.parse(JSON.stringify(run()))).toEqual(run())
  })

  test("the engine tracks life below zero but does not implement losing the game", () => {
    const start = createEngineState("alice", "bob")
    const after = resolveTop(accept(announce(start, "alice", effect("bob", -30))).state)
    expect(after.state.lifeTotals).toEqual([20, -10])
    expect(after.events.map((evt) => evt.type)).not.toContain("game_ended")
  })
})
