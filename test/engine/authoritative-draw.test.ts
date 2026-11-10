import { describe, expect, test } from "vitest"
import { buildPlayer } from "../../src/game/player.ts"
import type { Card, Player } from "../../src/game/types.ts"
import { createEngineState } from "../../src/engine/reducer.ts"
import { planExperimentalDraw } from "../../src/engine/authoritative-draw.ts"
import { inspectTabletopBridge, seedEngineFromTabletop } from "../../src/engine/tabletop-bridge.ts"
import { projectEngineServerView } from "../../src/engine/server-view.ts"

const card = (id: string, name = id): Card => ({
  instanceId: id, name, scryfallId: name, imageUrl: "", tapped: false, isManaSource: false,
})

function setup(): { engine: ReturnType<typeof createEngineState>; players: Player[] } {
  const alice = { ...buildPlayer({ name: "Alice", identifier: "alice", seat: 1, sessionId: "a" }),
    deckStatus: "loaded" as const, library: [card("shared", "ALICE-PRIVATE"), card("second")], hand: [],
  }
  const bob = { ...buildPlayer({ name: "Bob", identifier: "bob", seat: 2, sessionId: "b" }),
    deckStatus: "loaded" as const, library: [card("shared", "BOB-PRIVATE"), card("fourth")], hand: [],
  }
  const players = [alice, bob]
  return { engine: seedEngineFromTabletop(createEngineState("alice", "bob"), players), players }
}

describe("Stage 28D atomic experimental draw planner", () => {
  test("moves one identical card in both copies without mutating inputs", () => {
    const original = setup()
    const frozen = JSON.stringify(original)
    const result = planExperimentalDraw({ ...original, playerId: "alice" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(original)).toBe(frozen)
    expect(result.players[0]?.library).toHaveLength(1)
    expect(result.players[0]?.hand[0]?.instanceId).toBe("shared")
    expect(result.engine.cards.find((c) => c.instanceId === "alice:shared")?.zone).toBe("hand")
    expect(result.engine.cards.find((c) => c.instanceId === "bob:shared")?.zone).toBe("library")
    expect(inspectTabletopBridge(result.engine, result.players).status).toBe("synced")
  })

  test("rejects a non-priority player without consuming any card", () => {
    const start = setup()
    const result = planExperimentalDraw({ ...start, playerId: "bob" })
    expect(result).toEqual({ ok: false, reason: "not_priority_holder" })
    expect(start.players[1]?.library).toHaveLength(2)
  })

  test("rejects a stale engine snapshot after manual drawing or shuffling", () => {
    const start = setup()
    const manuallyChanged = structuredClone(start.players)
    manuallyChanged[0]?.hand.push(manuallyChanged[0]!.library.shift()!)
    expect(planExperimentalDraw({ ...start, players: manuallyChanged, playerId: "alice" }))
      .toEqual({ ok: false, reason: "out_of_sync" })
    const shuffled = structuredClone(start.players)
    shuffled[0]?.library.reverse()
    expect(planExperimentalDraw({ ...start, players: shuffled, playerId: "alice" }))
      .toEqual({ ok: false, reason: "out_of_sync" })
  })

  test("rejects an empty library with no state mutation", () => {
    const original = setup()
    const first = planExperimentalDraw({ ...original, playerId: "alice" })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = planExperimentalDraw({ engine: first.engine, players: first.players, playerId: "alice" })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(planExperimentalDraw({ engine: second.engine, players: second.players, playerId: "alice" }))
      .toEqual({ ok: false, reason: "library_empty" })
  })

  test("privacy projection reveals only each viewer's own hand", () => {
    const start = setup()
    const result = planExperimentalDraw({ ...start, playerId: "alice" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const bobView = projectEngineServerView(result.engine, "bob", 4, inspectTabletopBridge(result.engine, result.players))
    const aliceView = projectEngineServerView(result.engine, "alice", 4, inspectTabletopBridge(result.engine, result.players))
    expect(JSON.stringify(bobView)).not.toContain("ALICE-PRIVATE")
    expect(JSON.stringify(bobView)).not.toContain("alice:shared")
    expect(JSON.stringify(aliceView)).toContain("ALICE-PRIVATE")
    expect(JSON.stringify(aliceView)).not.toContain("BOB-PRIVATE")
  })
})
