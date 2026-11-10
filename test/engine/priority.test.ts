import { describe, expect, test } from "vitest"
import { applyEngineCommand, createEngineState } from "../../src/engine/reducer.ts"
import { PRIORITY_STEPS, type EngineState, type StackObject } from "../../src/engine/types.ts"

const PASS = { type: "PASS_PRIORITY" } as const

function pass(state: EngineState, playerId: string) {
  return applyEngineCommand(state, playerId, PASS)
}

function bothPass(state: EngineState): EngineState {
  const first = pass(state, state.priorityPlayerId)
  expect(first.accepted).toBe(true)
  if (!first.accepted) throw new Error("First priority pass rejected")
  const second = pass(first.state, first.state.priorityPlayerId)
  expect(second.accepted).toBe(true)
  if (!second.accepted) throw new Error("Second priority pass rejected")
  return second.state
}

describe("isolated Stage 27A engine", () => {
  test("starts a two-player game at the upkeep priority window", () => {
    expect(createEngineState("alice", "bob")).toEqual({
      playerIds: ["alice", "bob"],
      lifeTotals: [20, 20],
      cards: [],
      nextCardInstanceNumber: 1,
      activePlayerId: "alice",
      priorityPlayerId: "alice",
      turnNumber: 1,
      step: "upkeep",
      consecutivePasses: 0,
      stack: [],
      nextStackObjectNumber: 1,
    })
  })

  test("rejects blank or identical player IDs", () => {
    expect(() => createEngineState("", "bob")).toThrow()
    expect(() => createEngineState("alice", "alice")).toThrow()
    expect(() => createEngineState(" ", "bob")).toThrow()
  })

  test("rejects an unknown player without changing state", () => {
    const state = createEngineState("alice", "bob")
    const result = pass(state, "eve")
    expect(result).toMatchObject({ accepted: false, reason: "unknown_player" })
    expect(result.state).toBe(state)
    expect(result.events).toEqual([])
  })

  test("rejects passing when the other player has priority", () => {
    const state = createEngineState("alice", "bob")
    const result = pass(state, "bob")
    expect(result).toMatchObject({ accepted: false, reason: "not_priority_holder" })
    expect(result.state).toBe(state)
  })

  test("one pass hands priority to the opponent, preserving the active player", () => {
    const state = createEngineState("alice", "bob")
    const result = pass(state, "alice")
    expect(result.accepted).toBe(true)
    expect(result.state).toMatchObject({
      activePlayerId: "alice",
      priorityPlayerId: "bob",
      consecutivePasses: 1,
      step: "upkeep",
    })
    expect(state.priorityPlayerId).toBe("alice")
  })

  test("two passes on an empty stack advance the step", () => {
    const result = bothPass(createEngineState("alice", "bob"))
    expect(result).toMatchObject({
      step: "draw",
      turnNumber: 1,
      activePlayerId: "alice",
      priorityPlayerId: "alice",
      consecutivePasses: 0,
    })
  })

  test("moves through the prototype priority windows and then changes turns", () => {
    let state = createEngineState("alice", "bob")
    const visited = [state.step]
    for (let i = 1; i < PRIORITY_STEPS.length; i += 1) {
      state = bothPass(state)
      visited.push(state.step)
    }
    expect(visited).toEqual([...PRIORITY_STEPS])
    state = bothPass(state)
    expect(state).toMatchObject({
      step: "upkeep",
      turnNumber: 2,
      activePlayerId: "bob",
      priorityPlayerId: "bob",
    })
  })

  test("pops the top placeholder in LIFO order after two passes", () => {
    const first: StackObject = { id: "one", controllerId: "alice", description: "first", kind: "spell" }
    const second: StackObject = { id: "two", controllerId: "bob", description: "second", kind: "activated_ability" }
    const state: EngineState = {
      ...createEngineState("alice", "bob"),
      stack: [first, second],
    }
    const next = bothPass(state)
    expect(next.stack).toEqual([first])
    expect(next.step).toBe("upkeep")
    expect(next.priorityPlayerId).toBe("alice")
    expect(next.consecutivePasses).toBe(0)
    const after = bothPass(next)
    expect(after.stack).toEqual([])
    expect(after.step).toBe("upkeep")
    expect(bothPass(after).step).toBe("draw")
    expect(state.stack).toEqual([first, second])
  })

  test("reports stack-pop and new priority as explicit events", () => {
    const object: StackObject = { id: "spell-1", controllerId: "alice", description: "test", kind: "spell" }
    const state: EngineState = { ...createEngineState("alice", "bob"), stack: [object] }
    const first = pass(state, "alice")
    if (!first.accepted) throw new Error("First priority pass rejected")
    const second = pass(first.state, "bob")
    expect(second.events).toContainEqual({ type: "stack_object_popped", object })
    expect(second.events).toContainEqual({ type: "priority_granted", playerId: "alice" })
  })

  test("does not mutate input state", () => {
    const state = createEngineState("alice", "bob")
    Object.freeze(state.playerIds)
    Object.freeze(state.stack)
    Object.freeze(state)
    const result = pass(state, "alice")
    expect(result.accepted).toBe(true)
    expect(state).toMatchObject({ priorityPlayerId: "alice", consecutivePasses: 0 })
  })

  test("same initial state and command produce equivalent output", () => {
    const a = createEngineState("alice", "bob")
    const b = createEngineState("alice", "bob")
    expect(pass(a, "alice")).toEqual(pass(b, "alice"))
  })
})
