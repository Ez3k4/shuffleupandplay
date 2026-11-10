import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { GameRoom, type GameViewer } from "../../src/actors/game-room.ts"
import { startTestRuntime, type TestRuntime } from "../support/runtime.ts"

let harness: TestRuntime
const code = "EN28C1"
const viewer = (sessionId: string): GameViewer => ({ sessionId, roomCode: code })
const actor = () => harness.runtime.ref(GameRoom, code)
const as = (sessionId: string) => actor().with({ authorizationContext: viewer(sessionId) })

beforeEach(async () => {
  harness = await startTestRuntime()
  await as("alice-session").createRoom({ code, roomName: "Bridge", playerName: "Alice", sessionId: "alice-session" })
  await as("bob-session").join({ playerName: "Bob", sessionId: "bob-session" })
  await as("alice-session").requestDeck({ deckId: "1", sessionId: "alice-session" })
  await as("bob-session").requestDeck({ deckId: "2", sessionId: "bob-session" })
  await harness.runtime.testing.drain()
})
afterEach(async () => { await harness.close() })

describe("Stage 28C actor identity bridge", () => {
  test("seeds real per-player card identities and leaves manual cards untouched", async () => {
    const before = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    expect(await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })).toBe("started")
    const after = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    expect(after.room).toEqual({ ...before.room, version: before.room!.version + 1, updatedAt: after.room!.updatedAt })
    const first = before.room!.players[0]!
    const second = before.room!.players[1]!
    const manualId = first.library[0]!.instanceId
    expect(after.experimentalEngine!.cards[0]!.instanceId).toBe(`${first.id}:${manualId}`)
    expect(after.experimentalEngine!.cards.some((card) => card.instanceId === `${second.id}:${manualId}`)).toBe(true)
    const view = await as("alice-session").experimentalEngineView({ sessionId: "alice-session" })
    expect(view.status).toBe("active")
    if (view.status !== "active") return
    expect(view.bridge?.status).toBe("synced")
    expect(view.bridge?.linkedCardCount).toBe(4)
    expect(JSON.stringify(view)).not.toContain("forest-1")
  })

  test("flags a later manual draw while keeping the original engine card locations", async () => {
    await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })
    const before = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    await as("alice-session").applyAction({ action: { type: "drawCard", count: 1 }, sessionId: "alice-session" })
    const after = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    expect(after.room!.players[0]!.hand.length).toBe(1)
    expect(after.experimentalEngine!.cards).toEqual(before.experimentalEngine!.cards)
    const view = await as("bob-session").experimentalEngineView({ sessionId: "bob-session" })
    expect(view.status).toBe("active")
    if (view.status !== "active") return
    expect(view.bridge?.status).toBe("out_of_sync")
    expect(JSON.stringify(view)).not.toContain('"forest"')
    expect(JSON.stringify(view)).not.toContain('"bear"')
  })

  test("persists bridge state across restart", async () => {
    await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })
    const before = await as("bob-session").experimentalEngineView({ sessionId: "bob-session" })
    harness = await harness.restart()
    expect(await as("bob-session").experimentalEngineView({ sessionId: "bob-session" })).toEqual(before)
  })
})
