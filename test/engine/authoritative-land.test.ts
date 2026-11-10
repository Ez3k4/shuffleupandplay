import { describe, expect, test } from "vitest"
import { createEngineState, applyEngineCommand } from "../../src/engine/reducer.ts"
import { seedEngineFromTabletop, inspectTabletopBridge } from "../../src/engine/tabletop-bridge.ts"
import { isLandCard, landAllowance, planExperimentalLandPlay } from "../../src/engine/authoritative-land.ts"
import { buildPlayer } from "../../src/game/player.ts"
import type { Card, Player } from "../../src/game/types.ts"

const card = (instanceId: string, typeLine: string): Card => ({
  instanceId, name: instanceId, scryfallId: instanceId, imageUrl: "", tapped: false,
  isManaSource: /Land/.test(typeLine), typeLine, isLand: /Land/.test(typeLine),
})
function players(): [Player, Player] {
  const a = buildPlayer({ name: "Alice", identifier: "alice", sessionId: "a", seat: 1 })
  const b = buildPlayer({ name: "Bob", identifier: "bob", sessionId: "b", seat: 2 })
  return [
    { ...a, deckStatus: "loaded", hand: [card("forest", "Basic Land — Forest"), card("bear", "Creature — Bear")], library: [card("island", "Basic Land — Island")] },
    { ...b, deckStatus: "loaded", hand: [card("mountain", "Basic Land — Mountain")] },
  ]
}
function setup() {
  const p = players()
  const state = seedEngineFromTabletop(createEngineState("alice", "bob"), p)
  // Two priority passes from upkeep to draw; two more into precombat main.
  const pass = (s: typeof state, id: string) => {
    const result = applyEngineCommand(s, id, { type: "PASS_PRIORITY" })
    if (!result.accepted) throw Error(result.reason)
    return result.state
  }
  const first = pass(state, "alice")
  const draw = pass(first, "bob")
  const second = pass(draw, "alice")
  return { players: p, state: pass(second, "bob") }
}

describe("Stage 28E server-authoritative land play", () => {
  test("only identifiable lands are eligible", () => {
    expect(isLandCard(card("forest", "Basic Land — Forest"))).toBe(true)
    expect(isLandCard(card("bear", "Creature — Bear"))).toBe(false)
    expect(isLandCard({ isLand: false })).toBe(false)  })
  test("moves exactly one existing land to the battlefield without mutating inputs", () => {
    const { players: p, state } = setup()
    expect(state.step).toBe("precombat_main")
    const original = structuredClone(p)
    const result = planExperimentalLandPlay({ engine: state, players: p, playerId: "alice", instanceId: "forest" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(p).toEqual(original)
    expect(result.players[0]!.hand.map((c) => c.instanceId)).toEqual(["bear"])
    expect(result.players[0]!.battlefield.map((c) => c.instanceId)).toEqual(["forest"])
    expect(result.engine.cards.find((c) => c.instanceId === "alice:forest")?.zone).toBe("battlefield")
    expect(result.engine.landPlayedTurnByPlayer?.alice).toBe(state.turnNumber)
    expect(inspectTabletopBridge(result.engine, result.players).status).toBe("synced")
  })
  test("one land per turn, including across both main phases", () => {
    const { players: p, state } = setup()
    const p2 = { ...p[0], hand: [...p[0].hand, card("plains", "Basic Land — Plains")] }
    const ps = [p2, p[1]]
    const seeded = seedEngineFromTabletop(createEngineState("alice", "bob"), ps)
    const main = { ...state, cards: seeded.cards }
    const first = planExperimentalLandPlay({ engine: main, players: ps, playerId: "alice", instanceId: "forest" })
    if (!first.ok) throw Error(first.reason)
    expect(landAllowance(first.engine, "alice")).toBe(0)
    const next = planExperimentalLandPlay({ engine: first.engine, players: first.players, playerId: "alice", instanceId: "plains" })
    expect(next).toEqual({ ok: false, reason: "land_limit" })
    expect(landAllowance({ ...first.engine, step: "postcombat_main" }, "alice")).toBe(0)
    expect(landAllowance({ ...first.engine, turnNumber: main.turnNumber + 2 }, "alice")).toBe(1)
  })
  test("rejects nonlands, missing cards and nonactive opponents", () => {
    const { players: p, state } = setup()
    const go = (id: string, instanceId: string) => planExperimentalLandPlay({ engine: state, players: p, playerId: id, instanceId })
    expect(go("alice", "bear")).toEqual({ ok: false, reason: "not_land" })
    expect(go("alice", "missing")).toEqual({ ok: false, reason: "not_in_hand" })
    expect(go("bob", "mountain")).toEqual({ ok: false, reason: "not_active_player" })
  })
  test("rejects outside main phase and with nonempty stack", () => {
    const { players: p, state } = setup()
    const go = (s: typeof state) => planExperimentalLandPlay({ engine: s, players: p, playerId: "alice", instanceId: "forest" })
    expect(go({ ...state, step: "upkeep" })).toEqual({ ok: false, reason: "wrong_step" })
    expect(go({ ...state, stack: [{ id: "stack-1", kind: "spell", controllerId: "alice", description: "test" }] })).toEqual({ ok: false, reason: "stack_not_empty" })
  })
  test("detects divergence and rejects rather than mutating either representation", () => {
    const { players: p, state } = setup()
    p[0].hand.reverse()
    // Hand order alone is not significant; moving a card to another zone is.
    p[0].graveyard.push(p[0].hand.pop()!)
    expect(planExperimentalLandPlay({ engine: state, players: p, playerId: "alice", instanceId: "forest" }))
      .toEqual({ ok: false, reason: "out_of_sync" })
  })
})
