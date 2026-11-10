import { describe, expect, test } from "vitest"
import { createEngineState } from "../../src/engine/reducer.ts"
import { inspectTabletopBridge, seedEngineFromTabletop } from "../../src/engine/tabletop-bridge.ts"
import { projectEngineServerView } from "../../src/engine/server-view.ts"
import { buildPlayer } from "../../src/game/player.ts"
import type { Card, Player } from "../../src/game/types.ts"

function card(instanceId: string, name = `SECRET-${instanceId}`): Card {
  return { instanceId, name, scryfallId: name, imageUrl: "", tapped: false, isManaSource: false }
}
function players(): [Player, Player] {
  const alice = { ...buildPlayer({ name: "Alice", identifier: "alice", sessionId: "A", seat: 1 }),
    library: [card("shared"), card("a-2")], hand: [card("a-hand")],
    battlefield: [{ ...card("a-board"), x: 1, y: 2, counters: [] }],
  }
  const bob = { ...buildPlayer({ name: "Bob", identifier: "bob", sessionId: "B", seat: 2 }),
    library: [card("shared"), card("b-2")], graveyard: [card("b-grave")],
  }
  return [alice, bob]
}
function setup(p = players()) { return seedEngineFromTabletop(createEngineState("alice", "bob"), p) }

describe("Stage 28C read-only manual-card identity bridge", () => {
  test("uses the actual per-player card IDs, distinguishing duplicated import IDs", () => {
    const p = players()
    const state = setup(p)
    expect(state.cards.map((c) => c.instanceId)).toEqual([
      "alice:shared", "alice:a-2", "alice:a-hand", "alice:a-board", "bob:shared", "bob:b-2", "bob:b-grave",
    ])
    expect(state.cards.map((c) => c.zone)).toEqual([
      "library", "library", "hand", "battlefield", "library", "library", "graveyard",
    ])
    expect(state.cards.find((c) => c.instanceId === "alice:a-board")?.zoneOwnerId).toBeNull()
    expect(inspectTabletopBridge(state, p).status).toBe("synced")
  })

  test("does not mutate the manually controlled card arrays", () => {
    const p = players()
    const before = structuredClone(p)
    setup(p)
    expect(p).toEqual(before)
  })

  test("flags a manual draw without silently moving engine objects", () => {
    const p = players()
    const state = setup(p)
    p[0].hand.push(p[0].library.shift()!)
    const summary = inspectTabletopBridge(state, p)
    expect(summary.status).toBe("out_of_sync")
    expect(summary.linkedCardCount).toBe(6)
    expect(state.cards.find((c) => c.instanceId === "alice:shared")?.zone).toBe("library")
  })

  test("detects a library shuffle even when the zone counts stay identical", () => {
    const p = players()
    const state = setup(p)
    p[0].library.reverse()
    const summary = inspectTabletopBridge(state, p)
    expect(summary.status).toBe("out_of_sync")
    expect(summary.linkedCardCount).toBe(summary.tabletopCardCount)
  })

  test("detects new tokens and removed cards", () => {
    const p = players()
    const state = setup(p)
    p[0].battlefield.push({ ...card("new-token"), x: 0, y: 0, counters: [], isToken: true })
    expect(inspectTabletopBridge(state, p).status).toBe("out_of_sync")
    p[0].battlefield.pop()
    p[1].graveyard.pop()
    expect(inspectTabletopBridge(state, p).status).toBe("out_of_sync")
  })

  test("refuses duplicate IDs within one player's zones and leaves original engine unchanged", () => {
    const p = players()
    p[0].hand.push(card("shared"))
    const initial = createEngineState("alice", "bob")
    expect(() => seedEngineFromTabletop(initial, p)).toThrow(/duplicated/i)
    expect(initial.cards).toEqual([])
  })

  test("rejects unsupported pending spell and command zones rather than dropping cards", () => {
    const p = players()
    p[0].pendingSpells = [card("spell")]
    expect(() => setup(p)).toThrow(/not supported/)
    p[0].pendingSpells = []
    p[1].commander = card("commander")
    expect(() => setup(p)).toThrow(/not supported/)
  })

  test("rejects invalid identifiers, seats, and oversized decks", () => {
    const p = players()
    p[0].library[0] = card("\u0001bad")
    expect(() => setup(p)).toThrow(/identity/)
    p[0].library[0] = card("shared")
    p.reverse()
    expect(() => setup(p)).toThrow(/participants/)
    p.reverse()
    p[0].library = Array.from({ length: 251 }, (_, i) => card(`a${i}`))
    expect(() => setup(p)).toThrow(/Too many/)
  })

  test("does not disclose private card identities or library order via the HTTP projection", () => {
    const p = players()
    const state = setup(p)
    const bridge = inspectTabletopBridge(state, p)
    const alice = projectEngineServerView(state, "alice", 2, bridge)
    const bob = projectEngineServerView(state, "bob", 2, bridge)
    expect(JSON.stringify(alice)).not.toContain("SECRET-b-2")
    expect(JSON.stringify(alice)).not.toContain("bob:shared")
    expect(JSON.stringify(bob)).not.toContain("SECRET-a-hand")
    expect(JSON.stringify(bob)).not.toContain("alice:a-hand")
    expect(JSON.stringify(alice)).not.toContain("SECRET-shared")
    expect(JSON.stringify(bridge)).not.toContain("SECRET-")
    expect(JSON.stringify(bridge)).not.toContain("shared")
    if (alice.status !== "active") throw new Error("Not active")
    expect(alice.bridge?.status).toBe("synced")
    expect(alice.zones.visibleCards.some((c) => c.instanceId === "alice:a-hand")).toBe(true)
  })

  test("reports unsupported manual zones as out of sync rather than throwing during a refresh", () => {
    const p = players()
    const state = setup(p)
    p[0].pendingSpells = [card("spell")]
    expect(inspectTabletopBridge(state, p).status).toBe("out_of_sync")
  })
})
