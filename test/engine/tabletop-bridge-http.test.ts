import { afterEach, describe, expect, test } from "vitest"
import { jsonRequest, startTestServer, type TestServer } from "../support/server.ts"
import type { RoomPayload } from "../../src/game/types.ts"

const servers: TestServer[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())) })

describe("Stage 28C HTTP bridge projection", () => {
  test("only seated clients see aggregate links; manual changes are reported", async () => {
    const server = await startTestServer({ experimentalEngineEnabled: true })
    servers.push(server)
    const alice = server.client(), bob = server.client(), outsider = server.client()
    const created = await alice.json<RoomPayload>("/api/tables", jsonRequest({ playerName: "Alice" }))
    const code = created.space?.code
    if (!code) throw new Error("Missing room")
    expect((await bob.fetch(`/api/tables/${code}/join`, jsonRequest({ playerName: "Bob" }))).status).toBe(200)
    expect((await alice.fetch(`/api/tables/${code}/deck`, jsonRequest({ deckId: "11" }))).status).toBe(202)
    expect((await bob.fetch(`/api/tables/${code}/deck`, jsonRequest({ deckId: "22" }))).status).toBe(202)
    await server.harness.runtime.testing.drain()

    expect((await alice.fetch(`/api/tables/${code}/engine/start`, jsonRequest({}))).status).toBe(200)
    const view = await bob.json<{ status: string; bridge?: { status: string; linkedCardCount: number } }>(
      `/api/tables/${code}/engine`,
    )
    expect(view.status).toBe("active")
    expect(view.bridge?.status).toBe("synced")
    expect(view.bridge?.linkedCardCount).toBe(4)
    expect(JSON.stringify(view)).not.toContain("forest-1")
    expect(JSON.stringify(view)).not.toContain("bear-1")
    expect((await outsider.fetch(`/api/tables/${code}/engine`)).status).toBe(403)

    expect((await alice.fetch(`/api/tables/${code}/actions`, jsonRequest({ action: { type: "drawCard", count: 1 } }))).status).toBe(200)
    const stale = await bob.json<{ bridge?: { status: string } }>(`/api/tables/${code}/engine`)
    expect(stale.bridge?.status).toBe("out_of_sync")
  })
})
