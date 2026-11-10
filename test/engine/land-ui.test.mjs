import { describe, expect, test } from "vitest"
import { engineUiModel } from "../../public/experimental-engine.js"
const base = {
  status: "active", roomVersion: 8, turnNumber: 1, step: "precombat_main",
  viewerId: "alice", activePlayerId: "alice", priorityPlayerId: "alice", stack: [],
  bridge: { status: "synced", mode: "read_only", linkedCardCount: 2, tabletopCardCount: 2, engineCardCount: 2 },
  zones: { visibleCards: [], hiddenZones: [] }, playableLands: [{ instanceId: "forest", name: "Forest" }], landPlaysRemaining: 1,
}
describe("Stage 28E browser availability", () => {
  test("active player gets land-play control in their main phase", () => {
    const model = engineUiModel(base, "alice", 1)
    expect(model.canLand).toBe(true)
    expect(model.landOptions).toEqual([{ instanceId: "forest", name: "Forest" }])
  })
  test("only active player can play; one per turn", () => {
    expect(engineUiModel(base, "bob", 2).canLand).toBe(false)
    expect(engineUiModel({ ...base, priorityPlayerId: "bob" }, "alice", 1).canLand).toBe(false)
    expect(engineUiModel({ ...base, landPlaysRemaining: 0 }, "alice", 1).canLand).toBe(false)
  })
  test("not in upkeep, when stack isn't empty, or bridge is stale", () => {
    expect(engineUiModel({ ...base, step: "upkeep" }, "alice", 1).canLand).toBe(false)
    expect(engineUiModel({ ...base, stack: [{}] }, "alice", 1).canLand).toBe(false)
    expect(engineUiModel({ ...base, bridge: { status: "out_of_sync" } }, "alice", 1).canLand).toBe(false)
  })
})
