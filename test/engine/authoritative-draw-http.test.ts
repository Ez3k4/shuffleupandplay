import { afterEach, describe, expect, test } from "vitest"
import { jsonRequest, startTestServer, type TestServer } from "../support/server.ts"
import type { RoomPayload } from "../../src/game/types.ts"

const servers: TestServer[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())) })

async function setup() {
  const server = await startTestServer({ experimentalEngineEnabled: true })
  servers.push(server)
  const alice = server.client()
  const bob = server.client()
  const outsider = server.client()
  const created = await alice.json<RoomPayload>("/api/tables", jsonRequest({ playerName: "Alice" }))
  const code = created.space?.code
  if (!code) throw new Error("Could not create a table")
  expect((await bob.fetch(`/api/tables/${code}/join`, jsonRequest({ playerName: "Bob" }))).status).toBe(200)
  expect((await alice.fetch(`/api/tables/${code}/deck`, jsonRequest({ deckId: "11" }))).status).toBe(202)
  expect((await bob.fetch(`/api/tables/${code}/deck`, jsonRequest({ deckId: "22" }))).status).toBe(202)
  await server.harness.runtime.testing.drain()
  const path = `/api/tables/${code}/engine`
  expect((await alice.fetch(`${path}/start`, jsonRequest({}))).status).toBe(200)
  return { server, alice, bob, outsider, path, code }
}

const withKey = (key: string, expectedRoomVersion: number) => ({
  ...jsonRequest({ expectedRoomVersion }),
  headers: { "content-type": "application/json", "idempotency-key": key },
})

async function version(client: Awaited<ReturnType<typeof setup>>["alice"], path: string): Promise<number> {
  const response = await client.json<{ roomVersion: number }>(path)
  return response.roomVersion
}

async function counts(client: Awaited<ReturnType<typeof setup>>["alice"], code: string) {
  const response = await client.json<RoomPayload>(`/api/tables/${code}/state`)
  const own = response.space?.players.find((p) => p.id === response.currentPlayerId)
  if (!own) throw new Error("Missing own player")
  return { library: own.library.length, hand: own.hand.length, handNames: own.hand.map((c) => c.name) }
}

describe("Stage 28D single-authority experimental draw HTTP", () => {
  test("requires seated player and priority, and a valid idempotency key", async () => {
    const { alice, bob, outsider, path, code } = await setup()
    const currentVersion = await version(alice, path)
    expect((await outsider.fetch(`${path}/draw`, withKey("outsider-draw-1", currentVersion))).status).toBe(403)
    expect((await bob.fetch(`${path}/draw`, withKey("bob-no-priority", currentVersion))).status).toBe(422)
    expect((await alice.fetch(`${path}/draw`, jsonRequest({}))).status).toBe(400)
    expect((await alice.fetch(`${path}/draw`, jsonRequest({ expectedRoomVersion: currentVersion }))).status).toBe(400)
    expect((await alice.fetch(`${path}/draw`, jsonRequest({ instanceId: "forest-1" }))).status).toBe(400)
    expect((await alice.fetch(`${path}/draw`, withKey("alice-draw-001", currentVersion))).status).toBe(200)
    expect((await counts(alice, code)).hand).toBe(1)
  })

  test("a retried request with the same key draws only one card", async () => {
    const { alice, bob, path, code } = await setup()
    const before = await counts(alice, code)
    const currentVersion = await version(alice, path)
    const first = await alice.fetch(`${path}/draw`, withKey("same-draw-retry-1", currentVersion))
    expect(first.status).toBe(200)
    const duplicate = await alice.fetch(`${path}/draw`, withKey("same-draw-retry-1", currentVersion))
    expect(duplicate.status).toBe(200)
    const after = await counts(alice, code)
    expect(after.hand).toBe(before.hand + 1)
    expect(after.library).toBe(before.library - 1)
    const engine = await bob.json<{ bridge?: { status: string } }>(path)
    expect(engine.bridge?.status).toBe("synced")
    expect(JSON.stringify(engine)).not.toContain('"name":"Forest"')
  })


  test("rejects a new key with an old room version after uncertain delivery", async () => {
    const { alice, path, code } = await setup()
    const before = await counts(alice, code)
    const oldVersion = await version(alice, path)
    expect((await alice.fetch(`${path}/draw`, withKey("first-uncertain-delivery", oldVersion))).status).toBe(200)
    expect((await alice.fetch(`${path}/draw`, withKey("new-key-but-old-version", oldVersion))).status).toBe(409)
    expect((await counts(alice, code)).hand).toBe(before.hand + 1)
    expect((await alice.fetch(`${path}/draw`, withKey("second-independent-draw", await version(alice, path)))).status).toBe(200)
    expect((await counts(alice, code)).hand).toBe(before.hand + 2)
  })

  test("rejects stale state after a normal manual draw without consuming another card", async () => {
    const { alice, path, code } = await setup()
    expect((await alice.fetch(`/api/tables/${code}/actions`, jsonRequest({ action: { type: "drawCard", count: 1 } }))).status).toBe(200)
    const before = await counts(alice, code)
    expect((await alice.fetch(`${path}/draw`, withKey("stale-snapshot-1", await version(alice, path)))).status).toBe(409)
    expect(await counts(alice, code)).toEqual(before)
    const view = await alice.json<{ bridge?: { status: string } }>(path)
    expect(view.bridge?.status).toBe("out_of_sync")
  })

  test("cannot draw beyond an empty library, and keeps the engine synchronized", async () => {
    const { alice, path, code } = await setup()
    const initial = await counts(alice, code)
    for (let i = 0; i < initial.library; i++) {
      expect((await alice.fetch(`${path}/draw`, withKey(`all-cards-${i}-unique`, await version(alice, path)))).status).toBe(200)
    }
    expect((await alice.fetch(`${path}/draw`, withKey("nothing-to-draw", await version(alice, path)))).status).toBe(409)
    const now = await counts(alice, code)
    expect(now.library).toBe(0)
    expect(now.hand).toBe(initial.hand + initial.library)
    const view = await alice.json<{ bridge?: { status: string } }>(path)
    expect(view.bridge?.status).toBe("synced")
  })
})
