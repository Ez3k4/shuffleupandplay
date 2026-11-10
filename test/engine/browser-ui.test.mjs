import { describe, expect, test } from "vitest"
import { engineUiModel } from "../../public/experimental-engine.js"

const viewerId = "alice"
const active = {
  status: "active", viewerId,
  turnNumber: 1, step: "precombat_main", activePlayerId: "alice",
  priorityPlayerId: "alice", stack: [],
}

describe("Stage 28B view model", () => {
  test("host gets start action when experiment is inactive", () => {
    const model = engineUiModel({ status: "inactive" }, viewerId, 1)
    expect(model.canStart).toBe(true)
    expect(model.canPass).toBe(false)
  })
  test("opponent never sees start action", () => {
    expect(engineUiModel({ status: "inactive" }, "bob", 2).canStart).toBe(false)
  })
  test("priority holder can pass and sees readable step", () => {
    const model = engineUiModel(active, viewerId, 1)
    expect(model.canPass).toBe(true)
    expect(model.step).toBe("precombat main")
    expect(model.priority).toBe("You")
  })
  test("non-priority player cannot pass and does not learn raw IDs", () => {
    const model = engineUiModel(active, "bob", 2)
    expect(model.canPass).toBe(false)
    expect(model.priority).toBe("Opponent")
    expect(JSON.stringify(model)).not.toContain("alice")
  })
})
