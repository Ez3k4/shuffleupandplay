import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { jsonRequest, startTestServer, type TestClient, type TestServer } from "../support/server.ts"
import type { RoomPayload } from "../../src/game/types.ts"

let server: TestServer
beforeEach(async () => { server = await startTestServer({ experimentalEngineEnabled: true }) })
afterEach(async () => { await server.close() })

async function pair() {
  const alice = server.client()
  const bob = server.client()
  const payload = await alice.json<RoomPayload>(
    "/api/tables", jsonRequest({ playerName: "Alice", tableName: "Experiment" }),
  )
  const code = payload.space?.code
  if (!code) throw new Error("Missing room code")
  expect((await bob.fetch(`/api/tables/${code}/join`, jsonRequest({ playerName: "Bob" }))).status).toBe(200)
  return { alice, bob, code }
}
async function decks(alice: TestClient, bob: TestClient, code: string) {
  await alice.fetch(`/api/tables/${code}/deck`, jsonRequest({ deckId: "11" }))
  await bob.fetch(`/api/tables/${code}/deck`, jsonRequest({ deckId: "22" }))
  await server.harness.runtime.testing.drain()
}

describe("Stage 28A experimental HTTP API", () => {
  test("is disabled by default on an ordinary server", async () => {
    const regular = await startTestServer()
    try {
      const code = (await regular.client().json<RoomPayload>(
        "/api/tables", jsonRequest({ playerName: "Alice" }),
      )).space?.code
      const response = await regular.client().fetch(`/api/tables/${code}/engine`)
      expect(response.status).toBe(404)
    } finally { await regular.close() }
  })

  test("shows inactive status to seated players; rejects spectators", async () => {
    const { alice, code } = await pair()
    const view = await alice.json<{ status: string }>(`/api/tables/${code}/engine`)
    expect(view.status).toBe("inactive")
    const outsider = await server.client().fetch(`/api/tables/${code}/engine`)
    expect(outsider.status).toBe(403)
  })

  test("starts for host, advances priority, cannot change manual state", async () => {
    const { alice, bob, code } = await pair()
    await decks(alice, bob, code)
    const before = await alice.json<RoomPayload>(`/api/tables/${code}/state`)
    const started = await alice.fetch(`/api/tables/${code}/engine/start`, jsonRequest({}))
    expect(started.status).toBe(200)
    const aliceView = await alice.json<{ status: string; priorityPlayerId: string }>(`/api/tables/${code}/engine`)
    expect(aliceView.status).toBe("active")
    const premature = await bob.fetch(`/api/tables/${code}/engine/priority`, jsonRequest({}))
    expect(premature.status).toBe(422)
    const passed = await alice.fetch(`/api/tables/${code}/engine/priority`, jsonRequest({}))
    expect(passed.status).toBe(200)
    const bobView = await bob.json<{ priorityPlayerId: string }>(`/api/tables/${code}/engine`)
    expect(bobView.priorityPlayerId).not.toBe(aliceView.priorityPlayerId)
    const after = await alice.json<RoomPayload>(`/api/tables/${code}/state`)
    expect(after.space?.players.map((p) => p.library)).toEqual(before.space?.players.map((p) => p.library))
    // The ordinary game-state endpoint must never include raw engine state.
    expect(JSON.stringify(after)).not.toContain('"experimentalEngine"')
  })

  test("does not expose unchecked prototype commands or permit cross-origin requests", async () => {
    const { alice, bob, code } = await pair()
    await decks(alice, bob, code)
    expect((await bob.fetch(`/api/tables/${code}/engine/start`, jsonRequest({}))).status).toBe(403)
    expect((await alice.fetch(`/api/tables/${code}/engine/start`, jsonRequest({}))).status).toBe(200)
    expect((await alice.fetch(`/api/tables/${code}/engine/priority`,
      jsonRequest({ type: "PROTOTYPE_MOVE_CARD", instanceId: "card-1", toZone: "hand" }))).status).toBe(400)
    expect((await alice.fetch(`/api/tables/${code}/engine/priority`, {
      ...jsonRequest({}), headers: { "content-type": "application/json", origin: "https://malicious.example" },
    })).status).toBe(403)
    expect((await alice.fetch(`/api/tables/${code}/engine/priority`, {
      method: "POST", body: "", headers: { "content-type": "application/x-www-form-urlencoded" },
    })).status).toBe(415)
    expect((await alice.fetch(`/api/tables/${code}/engine/priority`, jsonRequest({}))).status).toBe(200)
  })
})
