import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { GameRoom, type GameViewer } from "../../src/actors/game-room.ts"
import { startTestRuntime, type TestRuntime } from "../support/runtime.ts"

let harness: TestRuntime
const code = "EN28D1"
const viewer = (sessionId: string): GameViewer => ({ sessionId, roomCode: code })
const actor = () => harness.runtime.ref(GameRoom, code)
const as = (sessionId: string) => actor().with({ authorizationContext: viewer(sessionId) })

async function expectedRoomVersion(): Promise<number> {
  const state = await actor().snapshot({ authorizationContext: viewer("alice-session") })
  if (!state.room) throw new Error("Missing room")
  return state.room.version
}

async function draw(sessionId: string) {
  return as(sessionId).drawExperimentalCard({ sessionId, expectedRoomVersion: await expectedRoomVersion() })
}

beforeEach(async () => {
  harness = await startTestRuntime()
  await as("alice-session").createRoom({ code, roomName: "Atomic draw", playerName: "Alice", sessionId: "alice-session" })
  await as("bob-session").join({ playerName: "Bob", sessionId: "bob-session" })
  await as("alice-session").requestDeck({ deckId: "1", sessionId: "alice-session" })
  await as("bob-session").requestDeck({ deckId: "2", sessionId: "bob-session" })
  await harness.runtime.testing.drain()
  await as("alice-session").startExperimentalEngine({ sessionId: "alice-session" })
})
afterEach(async () => { await harness.close() })

describe("Stage 28D serialized GameRoom draw", () => {
  test("updates manual room and engine in one call and advances the room version once", async () => {
    const before = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    const aliceId = before.room!.players[0]!.id
    const top = before.room!.players[0]!.library[0]!.instanceId
    expect(await draw("alice-session")).toBe("drawn")
    const after = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    expect(after.room!.version).toBe(before.room!.version + 1)
    expect(after.room!.players[0]!.hand.at(-1)?.instanceId).toBe(top)
    expect(after.room!.players[0]!.library).toHaveLength(before.room!.players[0]!.library.length - 1)
    expect(after.experimentalEngine!.cards.find((c) => c.instanceId === `${aliceId}:${top}`)?.zone).toBe("hand")
    const view = await as("alice-session").experimentalEngineView({ sessionId: "alice-session" })
    expect(view.status).toBe("active")
    if (view.status !== "active") return
    expect(view.bridge?.status).toBe("synced")
  })

  test("rejects non-priority player and unseated sessions", async () => {
    await expect(draw("bob-session"))
      .rejects.toMatchObject({ code: "engineIllegalCommand" })
    await expect(draw("outsider-session"))
      .rejects.toMatchObject({ code: "notAPlayer" })
  })

  test("the second player can draw after priority is passed to them", async () => {
    await as("alice-session").passExperimentalPriority({ sessionId: "alice-session" })
    const before = await actor().snapshot({ authorizationContext: viewer("bob-session") })
    const bobId = before.room!.players[1]!.id
    const bobTop = before.room!.players[1]!.library[0]!.instanceId
    expect(await draw("bob-session")).toBe("drawn")
    const after = await actor().snapshot({ authorizationContext: viewer("bob-session") })
    expect(after.room!.players[1]!.hand[0]?.instanceId).toBe(bobTop)
    expect(after.room!.players[0]!.hand).toHaveLength(0)
    expect(after.experimentalEngine!.cards.find((card) => card.instanceId === `${bobId}:${bobTop}`)?.zone).toBe("hand")
    const aliceView = await as("alice-session").experimentalEngineView({ sessionId: "alice-session" })
    expect(aliceView.status).toBe("active")
    if (aliceView.status !== "active") return
    expect(aliceView.bridge?.status).toBe("synced")
    expect(JSON.stringify(aliceView.zones.visibleCards)).not.toContain(bobTop)
  })

  test("rejects stale engine state without advancing manual or engine versions", async () => {
    await as("alice-session").applyAction({ sessionId: "alice-session", action: { type: "drawCard", count: 1 } })
    const before = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    await expect(draw("alice-session"))
      .rejects.toMatchObject({ code: "engineOutOfSync" })
    const after = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    expect(after.room).toEqual(before.room)
    expect(after.experimentalEngine).toEqual(before.experimentalEngine)
  })

  test("rejects stale expected version even with a new command", async () => {
    const staleVersion = await expectedRoomVersion()
    await draw("alice-session")
    const before = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    await expect(as("alice-session").drawExperimentalCard({
      sessionId: "alice-session", expectedRoomVersion: staleVersion,
    })).rejects.toMatchObject({ code: "engineVersionConflict" })
    const after = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    expect(after.room).toEqual(before.room)
    expect(after.experimentalEngine).toEqual(before.experimentalEngine)
  })

  test("persists the exact same mirrored card state after runtime restart", async () => {
    await draw("alice-session")
    const before = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    harness = await harness.restart()
    const after = await actor().snapshot({ authorizationContext: viewer("alice-session") })
    expect(after.room).toEqual(before.room)
    expect(after.experimentalEngine).toEqual(before.experimentalEngine)
  })
})
