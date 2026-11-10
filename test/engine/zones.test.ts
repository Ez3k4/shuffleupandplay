import { describe, expect, test } from "vitest"
import type { EngineCommand } from "../../src/engine/commands.ts"
import { applyEngineCommand, createEngineState } from "../../src/engine/reducer.ts"
import type { EngineState, TransitionResult } from "../../src/engine/types.ts"
import { projectPlayerZones } from "../../src/engine/views.ts"
import { seedEngineLibraries } from "../../src/engine/zones.ts"

function fresh() {
  return seedEngineLibraries(createEngineState("alice", "bob"), [
    { playerId: "alice", cardDefinitionIds: ["forest", "mountain", "bear"] },
    { playerId: "bob", cardDefinitionIds: ["island", "counterspell"] },
  ])
}

function accepted(result: TransitionResult): Extract<TransitionResult, { accepted: true }> {
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error(`Command rejected: ${result.reason}`)
  return result
}

const DRAW = { type: "PROTOTYPE_DRAW_CARD" } as const

function draw(state: EngineState, playerId = "alice") {
  return applyEngineCommand(state, playerId, DRAW)
}

function move(state: EngineState, playerId: string, instanceId: string, toZone: string) {
  return applyEngineCommand(state, playerId, {
    type: "PROTOTYPE_MOVE_CARD", instanceId, toZone,
  } as EngineCommand)
}

describe("Stage 27D card instances, zones, and hidden-information projections", () => {
  test("existing fresh games have an empty object collection", () => {
    const initial = createEngineState("alice", "bob")
    expect(initial.cards).toEqual([])
    expect(initial.nextCardInstanceNumber).toBe(1)
  })

  test("seeds stable instance IDs with separate definitions and owners", () => {
    const state = fresh()
    expect(state.cards.map((card) => card.instanceId)).toEqual(["card-1", "card-2", "card-3", "card-4", "card-5"])
    expect(state.cards[0]).toEqual({
      instanceId: "card-1", definitionId: "forest", ownerId: "alice", controllerId: "alice",
      zone: "library", zoneOwnerId: "alice",
    })
    expect(state.cards[3]).toMatchObject({ ownerId: "bob", controllerId: "bob", zoneOwnerId: "bob" })
    expect(state.nextCardInstanceNumber).toBe(6)
  })

  test("library seed order is independent of user input order", () => {
    const state = seedEngineLibraries(createEngineState("alice", "bob"), [
      { playerId: "bob", cardDefinitionIds: ["island"] },
      { playerId: "alice", cardDefinitionIds: ["forest"] },
    ])
    expect(state.cards.map((card) => card.definitionId)).toEqual(["forest", "island"])
  })

  test("rejects malformed or repeated seeds", () => {
    const initial = createEngineState("alice", "bob")
    expect(() => seedEngineLibraries(initial, [
      { playerId: "alice", cardDefinitionIds: [] },
      { playerId: "alice", cardDefinitionIds: [] },
    ])).toThrow()
    expect(() => seedEngineLibraries(initial, [
      { playerId: "alice", cardDefinitionIds: ["\n"] },
      { playerId: "bob", cardDefinitionIds: [] },
    ])).toThrow()
    expect(() => seedEngineLibraries(fresh(), [
      { playerId: "alice", cardDefinitionIds: [] },
      { playerId: "bob", cardDefinitionIds: [] },
    ])).toThrow()
    expect(initial.cards).toEqual([])
  })

  test("draws the top card into its owner's hand without allocating new IDs", () => {
    const start = fresh()
    const result = accepted(draw(start))
    expect(result.state.cards[0]).toMatchObject({ instanceId: "card-1", zone: "hand", zoneOwnerId: "alice" })
    expect(result.state.nextCardInstanceNumber).toBe(6)
    expect(result.events).toEqual([
      { type: "card_drawn", playerId: "alice" },
      { type: "priority_granted", playerId: "alice" },
    ])
    expect(start.cards[0]?.zone).toBe("library")
    const second = accepted(draw(result.state))
    expect(second.state.cards[1]).toMatchObject({ instanceId: "card-2", zone: "hand" })
    expect(second.state.cards[2]?.zone).toBe("library")
  })

  test("rejects an empty library without changing state", () => {
    let state = fresh()
    for (let i = 0; i < 3; i += 1) state = accepted(draw(state)).state
    const attempt = draw(state)
    expect(attempt).toMatchObject({ accepted: false, reason: "library_empty", events: [] })
    expect(attempt.state).toBe(state)
  })

  test("cannot draw without priority or on behalf of another player", () => {
    const state = fresh()
    expect(draw(state, "bob")).toMatchObject({ accepted: false, reason: "not_priority_holder" })
    expect(draw(state, "eve")).toMatchObject({ accepted: false, reason: "unknown_player" })
    expect(state.cards[0]?.zone).toBe("library")
  })

  test("a draw resets consecutive passes after the opponent passes", () => {
    const start = fresh()
    const first = accepted(applyEngineCommand(start, "alice", { type: "PASS_PRIORITY" }))
    const next = accepted(applyEngineCommand(first.state, "bob", { type: "PROTOTYPE_DRAW_CARD" }))
    expect(next.state.consecutivePasses).toBe(0)
    expect(next.state.priorityPlayerId).toBe("bob")
    expect(next.state.cards[3]?.zone).toBe("hand")
  })

  test("moves the same card through personal and shared zones", () => {
    const drawn = accepted(draw(fresh()))
    const onField = accepted(move(drawn.state, "alice", "card-1", "battlefield"))
    expect(onField.state.cards[0]).toMatchObject({
      instanceId: "card-1", ownerId: "alice", controllerId: "alice", zone: "battlefield", zoneOwnerId: null,
    })
    expect(onField.events).toEqual([{
      type: "prototype_card_moved", instanceId: "card-1", fromZone: "hand", toZone: "battlefield",
    }])
    const graveyard = accepted(move(onField.state, "alice", "card-1", "graveyard"))
    expect(graveyard.state.cards[0]).toMatchObject({ zone: "graveyard", zoneOwnerId: "alice" })
    const exiled = accepted(move(graveyard.state, "alice", "card-1", "exile"))
    expect(exiled.state.cards[0]).toMatchObject({ zone: "exile", zoneOwnerId: null })
    expect(exiled.state.cards).toHaveLength(5)
    expect(fresh().cards[0]?.zone).toBe("library")
  })

  test.each(["library", "unknown", "", null, 7])("rejects invalid destination %j", (zone) => {
    const start = accepted(draw(fresh())).state
    const attempt = move(start, "alice", "card-1", zone as string)
    expect(attempt).toMatchObject({ accepted: false, reason: "invalid_zone_move", events: [] })
    expect(attempt.state).toBe(start)
  })

  test("cannot move library cards, unknown cards, or opponent's cards", () => {
    const start = fresh()
    for (const instanceId of ["card-1", "card-4", "not-a-card"]) {
      const attempt = move(start, "alice", instanceId, "battlefield")
      expect(attempt).toMatchObject({ accepted: false, reason: "invalid_zone_move" })
      expect(attempt.state).toBe(start)
    }
    const alreadyDrawn = accepted(draw(start)).state
    expect(move(alreadyDrawn, "bob", "card-1", "graveyard")).toMatchObject({
      accepted: false, reason: "not_priority_holder",
    })
    expect(move(alreadyDrawn, "alice", "card-1", "hand")).toMatchObject({ accepted: false, reason: "invalid_zone_move" })
  })

  test("player view shows own hand but hides opponent hand and both libraries", () => {
    const start = fresh()
    const aliceDraw = accepted(draw(start)).state
    const pass = accepted(applyEngineCommand(aliceDraw, "alice", { type: "PASS_PRIORITY" })).state
    const bobDraw = accepted(draw(pass, "bob")).state
    const alice = projectPlayerZones(bobDraw, "alice")
    const bob = projectPlayerZones(bobDraw, "bob")
    expect(alice.visibleCards.map((card) => card.definitionId)).toEqual(["forest"])
    expect(bob.visibleCards.map((card) => card.definitionId)).toEqual(["island"])
    expect(JSON.stringify(alice)).not.toContain("island")
    expect(JSON.stringify(bob)).not.toContain("forest")
    expect(alice.hiddenZones).toEqual([
      { playerId: "alice", zone: "library", count: 2 },
      { playerId: "alice", zone: "hand", count: 1 },
      { playerId: "bob", zone: "library", count: 1 },
      { playerId: "bob", zone: "hand", count: 1 },
    ])
    expect(() => projectPlayerZones(bobDraw, "eve")).toThrow()
  })

  test("public battlefield and graveyard zones expose card definitions to both players", () => {
    const start = accepted(draw(fresh())).state
    const onField = accepted(move(start, "alice", "card-1", "battlefield")).state
    expect(projectPlayerZones(onField, "bob").visibleCards).toEqual([
      { instanceId: "card-1", definitionId: "forest", ownerId: "alice", controllerId: "alice", zone: "battlefield", zoneOwnerId: null },
    ])
  })

  test("a rejected command leaves a deeply frozen state unchanged", () => {
    const state = fresh()
    for (const card of state.cards) Object.freeze(card)
    Object.freeze(state.cards)
    Object.freeze(state)
    const rejected = move(state, "alice", "card-1", "battlefield")
    expect(rejected.accepted).toBe(false)
    expect(rejected.state).toBe(state)
    const drawn = accepted(draw(state))
    expect(state.cards[0]?.zone).toBe("library")
    expect(drawn.state.cards[0]?.zone).toBe("hand")
  })

  test("seed, draw and move transitions are deterministic JSON-safe values", () => {
    const execute = () => {
      const first = accepted(draw(fresh()))
      return accepted(move(first.state, "alice", "card-1", "battlefield"))
    }
    expect(execute()).toEqual(execute())
    expect(JSON.parse(JSON.stringify(execute()))).toEqual(execute())
  })
})
