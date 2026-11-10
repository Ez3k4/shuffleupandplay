import { describe, expect, test } from "vitest"
import { applyEngineCommand, createEngineState } from "../../src/engine/reducer.ts"
import type { EngineCommand } from "../../src/engine/commands.ts"
import type { EngineState, TransitionResult } from "../../src/engine/types.ts"

const PASS = { type: "PASS_PRIORITY" } as const

function announce(state: EngineState, playerId: string, kind: "spell" | "activated_ability", description: string) {
  return applyEngineCommand(state, playerId, {
    type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT", kind, description,
  })
}

function accepted(result: TransitionResult): Extract<TransitionResult, { accepted: true }> {
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error(`Command rejected: ${result.reason}`)
  return result
}

function pass(state: EngineState, playerId: string) {
  return accepted(applyEngineCommand(state, playerId, PASS))
}

function passTwice(state: EngineState) {
  const first = pass(state, state.priorityPlayerId)
  return pass(first.state, first.state.priorityPlayerId)
}

describe("Stage 27B synthetic stack commands and events", () => {
  test("adds a typed stack object with a deterministic engine-assigned ID", () => {
    const state = createEngineState("alice", "bob")
    const result = accepted(announce(state, "alice", "spell", "  Test spell  "))
    expect(result.state.stack).toEqual([{
      id: "stack-1", kind: "spell", controllerId: "alice", description: "Test spell",
    }])
    expect(result.state.nextStackObjectNumber).toBe(2)
    expect(result.state.priorityPlayerId).toBe("alice")
    expect(result.events).toEqual([
      { type: "stack_object_added", object: result.state.stack[0] },
      { type: "priority_granted", playerId: "alice" },
    ])
  })

  test("can model activated abilities, but not player-announced triggered abilities", () => {
    const state = createEngineState("alice", "bob")
    expect(accepted(announce(state, "alice", "activated_ability", "Tap for mana")).state.stack[0]?.kind)
      .toBe("activated_ability")
    const bad = applyEngineCommand(state, "alice", {
      type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT", kind: "triggered_ability", description: "Not allowed",
    } as unknown as EngineCommand)
    expect(bad).toMatchObject({ accepted: false, reason: "invalid_stack_object", state })
  })

  test("a priority holder can respond after an opponent has passed; passes reset", () => {
    const start = createEngineState("alice", "bob")
    const afterAlicePass = pass(start, "alice").state
    expect(afterAlicePass).toMatchObject({ priorityPlayerId: "bob", consecutivePasses: 1 })
    const action = accepted(announce(afterAlicePass, "bob", "spell", "Response"))
    expect(action.state).toMatchObject({ priorityPlayerId: "bob", consecutivePasses: 0 })
    expect(action.state.stack[0]?.controllerId).toBe("bob")
    const afterBobPass = pass(action.state, "bob").state
    expect(afterBobPass).toMatchObject({ priorityPlayerId: "alice", consecutivePasses: 1 })
  })

  test("supports responses above pending spells and pops entries in LIFO order", () => {
    let state = createEngineState("alice", "bob")
    state = accepted(announce(state, "alice", "spell", "First")).state
    state = pass(state, "alice").state
    state = accepted(announce(state, "bob", "spell", "Response")).state
    expect(state.stack.map((entry) => entry.id)).toEqual(["stack-1", "stack-2"])

    const firstPopped = passTwice(state)
    expect(firstPopped.events).toContainEqual({
      type: "stack_object_popped", object: state.stack[1],
    })
    expect(firstPopped.events).toContainEqual({ type: "stack_effect_not_implemented", objectId: "stack-2" })
    expect(firstPopped.state.stack.map((entry) => entry.id)).toEqual(["stack-1"])
    expect(firstPopped.state.priorityPlayerId).toBe("alice")
    expect(firstPopped.state.step).toBe("upkeep")

    const secondPopped = passTwice(firstPopped.state)
    expect(secondPopped.state.stack).toEqual([])
    expect(secondPopped.events).toContainEqual({ type: "stack_effect_not_implemented", objectId: "stack-1" })
    expect(passTwice(secondPopped.state).state.step).toBe("draw")
  })

  test("does not reuse IDs after popping entries", () => {
    let state = accepted(announce(createEngineState("alice", "bob"), "alice", "spell", "A")).state
    state = passTwice(state).state
    expect(state.stack).toEqual([])
    state = accepted(announce(state, "alice", "spell", "B")).state
    expect(state.stack[0]?.id).toBe("stack-2")
    expect(state.nextStackObjectNumber).toBe(3)
  })

  test("rejects unknown players and players without priority, without mutation", () => {
    const state = createEngineState("alice", "bob")
    const unknown = announce(state, "eve", "spell", "X")
    const noPriority = announce(state, "bob", "spell", "X")
    expect(unknown).toMatchObject({ accepted: false, reason: "unknown_player", state, events: [] })
    expect(noPriority).toMatchObject({ accepted: false, reason: "not_priority_holder", state, events: [] })
    expect(unknown.state).toBe(state)
    expect(noPriority.state).toBe(state)
  })

  test.each(["", "  ", "x".repeat(161), "has\nnewline"])( 
    "rejects an invalid description: %j",
    (description) => {
      const state = createEngineState("alice", "bob")
      const result = announce(state, "alice", "spell", description)
      expect(result).toMatchObject({ accepted: false, reason: "invalid_stack_object", events: [] })
      expect(result.state).toBe(state)
    },
  )

  test("rejects untrusted runtime input even when it bypasses TypeScript", () => {
    const state = createEngineState("alice", "bob")
    const command = { type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT", kind: "spell", description: null }
    const result = applyEngineCommand(state, "alice", command as unknown as EngineCommand)
    expect(result).toMatchObject({ accepted: false, reason: "invalid_stack_object" })
  })

  test("ignores a forged controllerId field in the command", () => {
    const state = createEngineState("alice", "bob")
    const forged = {
      type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT",
      kind: "spell",
      description: "Owned by Alice",
      controllerId: "bob",
    }
    const result = accepted(applyEngineCommand(state, "alice", forged as EngineCommand))
    expect(result.state.stack[0]?.controllerId).toBe("alice")
  })

  test("does not mutate even deeply frozen engine state", () => {
    const state = createEngineState("alice", "bob")
    Object.freeze(state.playerIds)
    Object.freeze(state.stack)
    Object.freeze(state)
    const result = accepted(announce(state, "alice", "spell", "A"))
    expect(state.stack).toEqual([])
    expect(state.nextStackObjectNumber).toBe(1)
    expect(result.state.stack).toHaveLength(1)
  })

  test("the same input state and command produce identical output", () => {
    const command: EngineCommand = { type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT", kind: "spell", description: "A" }
    expect(applyEngineCommand(createEngineState("alice", "bob"), "alice", command))
      .toEqual(applyEngineCommand(createEngineState("alice", "bob"), "alice", command))
  })

  test("state and events remain serializable plain data", () => {
    const result = accepted(announce(createEngineState("alice", "bob"), "alice", "spell", "A"))
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
