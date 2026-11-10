import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { GameRoom, type GameViewer } from "../../src/actors/game-room.ts"
import { startTestRuntime, type TestRuntime } from "../support/runtime.ts"

let harness: TestRuntime
const code = "EN28E1"
const viewer = (sessionId: string): GameViewer => ({ sessionId, roomCode: code })
const actor = () => harness.runtime.ref(GameRoom, code)
const as = (sessionId: string) => actor().with({ authorizationContext: viewer(sessionId) })
async function version() {
  const snapshot = await actor().snapshot({ authorizationContext: viewer("alice-session") })
  return snapshot.room!.version
}
async function pass(sessionId: string) {
  await as(sessionId).passExperimentalPriority({ sessionId })
}
async function advanceToMain() {
  await pass("alice-session"); await pass("bob-session") // upkeep -> draw
  await pass("alice-session"); await pass("bob-session") // draw -> precombat main
}
async function draw(sessionId: string) {
  return as(sessionId).drawExperimentalCard({ sessionId, expectedRoomVersion: await version() })
}

beforeEach(async () => {
  harness = await startTestRuntime({
    deck: async (id) => ({ name: `Deck ${id}`, cards: [
      { instanceId: "forest-1", name: "Forest", scryfallId: "forest", imageUrl: "", tapped: false, isManaSource: true,
        isLand: true, typeLine: "Basic Land — Forest" },
      { instanceId: "bear-1", name: "Bear", scryfallId: "bear", imageUrl: "", tapped: false, isManaSource: false,
        isLand: false, typeLine: "Creature — Bear" },
    ] }),
  })
  await as("alice-session").createRoom({ code, roomName: "Land play", playerName: "Alice", sessionId: "alice-session" })
  await as("bob-session").join({ playerName: "Bob", sessionId: "bob-session" })
  await as("alice-session").requestDeck({ deckId: "1", sessionId: "alice-session" })
  await as("bob-session").requestDeck({ deckId: "2", sessionId: "bob-session" })
  await harness.runtime.testing.drain()
  await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })
})
afterEach(async () => { await harness.close() })

describe("Stage 28E actor atomic land play", () => {
  test("rejects land play outside the active player's main phase", async () => {
    await draw("alice-session")
    const state = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    const id = state.room!.players[0]!.hand[0]!.instanceId
    await expect(as("alice-session").playExperimentalLand({ sessionId: "alice-session", instanceId: id, expectedRoomVersion: await version() }))
      .rejects.toMatchObject({ code: "engineLandIllegal" })
  })
  test("moves a real land to the battlefield, preserving identity and link", async () => {
    await draw("alice-session")
    await advanceToMain()
    const before = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    const first = before.room!.players[0]!
    const landId = first.hand[0]!.instanceId
    expect(await as("alice-session").playExperimentalLand({ sessionId: "alice-session", instanceId: landId, expectedRoomVersion: before.room!.version })).toBe("played")
    const after = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    expect(after.room!.version).toBe(before.room!.version + 1)
    expect(after.room!.players[0]!.hand).not.toContainEqual(first.hand[0])
    expect(after.room!.players[0]!.battlefield.some((c) => c.instanceId === landId)).toBe(true)
    expect(after.experimentalEngine!.cards.find((c) => c.instanceId === `${first.id}:${landId}`)?.zone).toBe("battlefield")
    const view = await as("alice-session").experimentalEngineView({ sessionId: "alice-session" })
    expect(view.status).toBe("active")
    if (view.status === "active") expect(view.bridge?.status).toBe("synced")
  })
  test("refuses stale version even when a caller supplies a different key", async () => {
    await draw("alice-session")
    await advanceToMain()
    const before = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    const id = before.room!.players[0]!.hand[0]!.instanceId
    await as("alice-session").playExperimentalLand({ sessionId: "alice-session", instanceId: id, expectedRoomVersion: before.room!.version })
    await expect(as("alice-session").playExperimentalLand({ sessionId: "alice-session", instanceId: id, expectedRoomVersion: before.room!.version }))
      .rejects.toMatchObject({ code: "engineVersionConflict" })
  })
})
