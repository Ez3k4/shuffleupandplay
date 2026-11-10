import { describe, expect, test } from "vitest"
import { engineUiModel } from "../../public/experimental-engine.js"

const view = (viewerId = "alice", priorityPlayerId = "alice", count = 2, status = "synced") => ({
  status: "active", viewerId, priorityPlayerId, activePlayerId: "alice", roomVersion: 5,
  turnNumber: 1, step: "upkeep", stack: [],
  bridge: { mode: "read_only", status, linkedCardCount: 4, engineCardCount: 4, tabletopCardCount: 4 },
  zones: { hiddenZones: [
    { playerId: "alice", zone: "library", count },
    { playerId: "bob", zone: "library", count: 2 },
  ] },
})

describe("Stage 28D experimental draw button gating", () => {
  test("only player with priority, linked state, and cards can draw", () => {
    expect(engineUiModel(view(), "alice", 1).canDraw).toBe(true)
    expect(engineUiModel(view(), "bob", 2).canDraw).toBe(false)
    expect(engineUiModel(view("alice", "bob"), "alice", 1).canDraw).toBe(false)
    expect(engineUiModel(view("alice", "alice", 0), "alice", 1).canDraw).toBe(false)
    expect(engineUiModel(view("alice", "alice", 2, "out_of_sync"), "alice", 1).canDraw).toBe(false)
    expect(engineUiModel({ status: "inactive" }, "alice", 1).canDraw).toBe(false)
  })
})
