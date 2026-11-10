import { afterEach, describe, expect, test } from "vitest"
import { jsonRequest, startTestServer, type TestServer } from "../support/server.ts"
import type { RoomPayload } from "../../src/game/types.ts"
const servers: TestServer[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())) })

async function setup() {
  const server = await startTestServer({
    experimentalEngineEnabled: true,
    deck: async (id) => ({ name: `Deck ${id}`, cards: [
      { instanceId: "forest-1", name: "Forest", scryfallId: "forest", imageUrl: "", tapped: false, isManaSource: true,
        isLand: true, typeLine: "Basic Land — Forest" },
      { instanceId: "bear-1", name: "Bear", scryfallId: "bear", imageUrl: "", tapped: false, isManaSource: false,
        isLand: false, typeLine: "Creature — Bear" },
    ] }),
  })
  servers.push(server)
  const alice = server.client(), bob = server.client(), outsider = server.client()
  const created = await alice.json<RoomPayload>("/api/tables", jsonRequest({ playerName: "Alice" }))
  const code = created.space?.code
  if (!code) throw Error("Missing table")
  expect((await bob.fetch(`/api/tables/${code}/join`, jsonRequest({ playerName: "Bob" }))).status).toBe(200)
  await alice.fetch(`/api/tables/${code}/deck`, jsonRequest({ deckId: "11" }))
  await bob.fetch(`/api/tables/${code}/deck`, jsonRequest({ deckId: "22" }))
  await server.harness.runtime.testing.drain()
  const path = `/api/tables/${code}/engine`
  expect((await alice.fetch(`${path}/start`, jsonRequest({}))).status).toBe(200)
  return { alice, bob, outsider, code, path }
}
function cmd(key: string, instanceId: string, expectedRoomVersion: number) {
  return { ...jsonRequest({ instanceId, expectedRoomVersion }), headers: { "content-type": "application/json", "idempotency-key": key } }
}

describe("Stage 28E land HTTP boundaries", () => {
  test("rejects malformed requests, non-seated sessions, and non-main-phase land play", async () => {
    const { alice, outsider, path } = await setup()
    const view = await alice.json<{ roomVersion: number }>(path)
    expect((await alice.fetch(`${path}/land`, jsonRequest({}))).status).toBe(400)
    expect((await alice.fetch(`${path}/land`, jsonRequest({ instanceId: "forest-1", expectedRoomVersion: view.roomVersion }))).status).toBe(400)
    expect((await outsider.fetch(`${path}/land`, cmd("outsider-land-test", "forest-1", view.roomVersion))).status).toBe(403)
    expect((await alice.fetch(`${path}/land`, cmd("too-early-land-test", "forest-1", view.roomVersion))).status).toBe(422)
  })
  test("never exposes opponents' hand card options", async () => {
    const { alice, bob, path } = await setup()
    const aliceView = await alice.json<{ playableLands?: { instanceId: string; name: string }[] }>(path)
    const bobView = await bob.json<{ playableLands?: { instanceId: string; name: string }[] }>(path)
    expect(aliceView.playableLands).toEqual([])
    expect(bobView.playableLands).toEqual([])
  })
})

describe("Stage 28E atomic land HTTP", () => {
  test("after two priority windows, moves one Forest and deduplicates repeated HTTP requests", async () => {
    const { alice, bob, path, code } = await setup()
    const getVersion = async () => (await alice.json<{ roomVersion: number }>(path)).roomVersion
    const firstVersion = await getVersion()
    const draw = await alice.fetch(`${path}/draw`, cmd("land-test-draw-001", "unused", firstVersion))
    // The /draw endpoint has a different payload schema; create an explicit call.
    expect(draw.status).toBe(400)
    const drawn = await alice.fetch(`${path}/draw`, {
      ...jsonRequest({ expectedRoomVersion: firstVersion }),
      headers: { "content-type": "application/json", "idempotency-key": "land-test-draw-002" },
    })
    expect(drawn.status).toBe(200)
    for (const [client, suffix] of [[alice, "a"], [bob, "b"], [alice, "c"], [bob, "d"]] as const) {
      expect((await client.fetch(`${path}/priority`, jsonRequest({}))).status).toBe(200)
    }
    const v = await getVersion()
    const first = await alice.fetch(`${path}/land`, cmd("first-land-play", "forest-1", v))
    expect(first.status).toBe(200)
    expect((await alice.fetch(`${path}/land`, cmd("first-land-play", "forest-1", v))).status).toBe(200)
    const now = await alice.json<RoomPayload>(`/api/tables/${code}/state`)
    const self = now.space!.players.find((p) => p.id === now.currentPlayerId)!
    expect(self.battlefield.filter((c) => c.instanceId === "forest-1")).toHaveLength(1)
    expect(self.hand.filter((c) => c.instanceId === "forest-1")).toHaveLength(0)
    expect((await alice.fetch(`${path}/land`, cmd("stale-new-key", "forest-1", v))).status).toBe(409)
    const engine = await bob.json<{ bridge?: { status: string }; playableLands?: unknown[] }>(path)
    expect(engine.bridge?.status).toBe("synced")
    expect(JSON.stringify(engine.playableLands)).not.toContain("forest-1")
  })
})
