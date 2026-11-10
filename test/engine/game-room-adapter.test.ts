import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { GameRoom, type GameViewer } from "../../src/actors/game-room.ts"
import { startTestRuntime, type TestRuntime } from "../support/runtime.ts"

let harness: TestRuntime
const roomCode = "EN28A1"
const viewer = (sessionId: string): GameViewer => ({ sessionId, roomCode })
const room = () => harness.runtime.ref(GameRoom, roomCode)
const as = (sessionId: string) => room().with({ authorizationContext: viewer(sessionId) })

beforeEach(async () => {
  harness = await startTestRuntime({
    deck: async (deckId) => ({
      name: `Deck ${deckId}`,
      cards: [{
        instanceId: `card-${deckId}`, name: `secret-${deckId}`,
        scryfallId: `secret-${deckId}`, imageUrl: "https://example.com/card.jpg",
        tapped: false, isManaSource: false,
      }],
    }),
  })
  await as("alice-session").createRoom({
    code: roomCode, roomName: "Engine Test", playerName: "Alice", sessionId: "alice-session",
  })
  await as("bob-session").join({ playerName: "Bob", sessionId: "bob-session" })
})
afterEach(async () => { await harness.close() })

async function loadBoth() {
  await as("alice-session").requestDeck({ deckId: "ALICE", sessionId: "alice-session" })
  await as("bob-session").requestDeck({ deckId: "BOB", sessionId: "bob-session" })
  await harness.runtime.testing.drain()
}

describe("Stage 28A actor integration", () => {
  test("requires both decks and host to start", async () => {
    await expect(as("alice-session").startExperimentalEngine({ sessionId: "alice-session" }))
      .rejects.toMatchObject({ code: "engineNeedsDecks" })
    await loadBoth()
    await expect(as("bob-session").startExperimentalEngine({ sessionId: "bob-session" }))
      .rejects.toMatchObject({ code: "engineHostOnly" })
    expect(await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })).toBe("started")
    expect(await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })).toBe("alreadyStarted")
  })

  test("binds priority to session seat and preserves manual game state", async () => {
    await loadBoth()
    await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })
    const before = await room().snapshot({ authorizationContext: viewer("alice-session") })
    await expect(as("bob-session").passExperimentalPriority({ sessionId: "bob-session" }))
      .rejects.toMatchObject({ code: "engineIllegalCommand" })
    await as("alice-session").passExperimentalPriority({ sessionId: "alice-session" })
    const after = await room().snapshot({ authorizationContext: viewer("alice-session") })
    expect(after.room?.players.map((p) => p.library)).toEqual(before.room?.players.map((p) => p.library))
    const view = await as("bob-session").experimentalEngineView({ sessionId: "bob-session" })
    expect(view.status).toBe("active")
    if (view.status === "active") expect(view.priorityPlayerId).toBe(before.room?.players[1]?.id)
  })

  test("provides only redacted seat-specific views", async () => {
    await loadBoth()
    await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })
    const aliceView = await as("alice-session").experimentalEngineView({ sessionId: "alice-session" })
    const bobView = await as("bob-session").experimentalEngineView({ sessionId: "bob-session" })
    expect(JSON.stringify(aliceView)).not.toContain("secret-ALICE")
    expect(JSON.stringify(bobView)).not.toContain("secret-BOB")
    expect(JSON.stringify(aliceView)).not.toContain("secret-BOB")
    await expect(as("spectator-session").experimentalEngineView({ sessionId: "spectator-session" }))
      .rejects.toMatchObject({ code: "notAPlayer" })
  })

  test("persists separate state across actor runtime restart", async () => {
    await loadBoth()
    await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })
    await as("alice-session").passExperimentalPriority({ sessionId: "alice-session" })
    const before = await as("bob-session").experimentalEngineView({ sessionId: "bob-session" })
    harness = await harness.restart()
    const after = await as("bob-session").experimentalEngineView({ sessionId: "bob-session" })
    expect(after).toEqual(before)
  })
})
