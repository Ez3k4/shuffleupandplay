import { describe, expect, test } from "vitest"
import { createEngineState } from "../../src/engine/reducer.ts"
import { projectEngineServerView } from "../../src/engine/server-view.ts"
import { seedEngineLibraries } from "../../src/engine/zones.ts"

describe("Stage 28A redacted public engine view", () => {
  test("reports inactive engine without exposing a game state", () => {
    expect(projectEngineServerView(null, "player-1", 4)).toEqual({ status: "inactive", roomVersion: 4 })
  })

  test("hides library identities and opponents' hands", () => {
    const original = seedEngineLibraries(createEngineState("player-1", "player-2"), [
      { playerId: "player-1", cardDefinitionIds: ["SECRET_A", "SECRET_B"] },
      { playerId: "player-2", cardDefinitionIds: ["SECRET_C", "SECRET_D"] },
    ])
    const state = {
      ...original,
      cards: original.cards.map((card) =>
        card.definitionId === "SECRET_C" ? { ...card, zone: "hand" as const } : card,
      ),
    }
    const one = projectEngineServerView(state, "player-1", 7)
    const two = projectEngineServerView(state, "player-2", 7)
    expect(JSON.stringify(one)).not.toContain("SECRET_")
    expect(JSON.stringify(two)).not.toContain("SECRET_A")
    expect(JSON.stringify(two)).toContain("SECRET_C")
    if (one.status !== "active") throw new Error("Expected active engine")
    expect(one.zones.hiddenZones.find((zone) => zone.playerId === "player-2" && zone.zone === "hand")?.count).toBe(1)
  })

  test("refuses a non-participant", () => {
    expect(() => projectEngineServerView(createEngineState("player-1", "player-2"), "spectator", 1)).toThrow()
  })

  test("does not expose stack effects or descriptions", () => {
    const state = {
      ...createEngineState("alice", "bob"),
      stack: [{
        id: "stack-1", kind: "spell" as const, controllerId: "alice",
        description: "PRIVATE_DESCRIPTION", effect: { type: "CHANGE_LIFE" as const, playerId: "bob", delta: -300 },
      }],
    }
    const view = projectEngineServerView(state, "alice", 2)
    expect(JSON.stringify(view)).not.toContain("PRIVATE_DESCRIPTION")
    expect(JSON.stringify(view)).not.toContain("CHANGE_LIFE")
    expect(JSON.stringify(view)).not.toContain("-300")
  })
})
