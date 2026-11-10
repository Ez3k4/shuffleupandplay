import { describe, expect, test } from "vitest"
import { engineUiModel } from "../../public/experimental-engine.js"

const active = (bridge) => ({
  status: "active", viewerId: "alice", turnNumber: 1,
  step: "upkeep", activePlayerId: "alice", priorityPlayerId: "alice",
  stack: [], bridge,
})

describe("Stage 28C engine-panel card link", () => {
  test("reports the linked count without raw card IDs", () => {
    const model = engineUiModel(active({
      mode: "read_only", status: "synced", linkedCardCount: 120, tabletopCardCount: 120, engineCardCount: 120,
    }), "bob", 2)
    expect(model.cards).toBe("120 cards linked")
    expect(JSON.stringify(model)).not.toContain("instanceId")
  })
  test("warns on divergence but keeps priority tracker usable", () => {
    const model = engineUiModel(active({
      mode: "read_only", status: "out_of_sync", linkedCardCount: 119, tabletopCardCount: 120, engineCardCount: 120,
    }), "alice", 1)
    expect(model.cards).toContain("Out of sync")
    expect(model.message).toContain("Manual cards have changed")
    expect(model.canPass).toBe(true)
  })
  test("old saved experiments without a bridge show an explicit status", () => {
    expect(engineUiModel(active(undefined), "alice", 1).cards).toContain("Not linked")
  })
})
