import { afterEach, describe, expect, test } from "vitest"
import { jsonRequest, startTestServer, type TestServer } from "../support/server.ts"
import type { RoomPayload } from "../../src/game/types.ts"

const servers: TestServer[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())) })

async function room(enabled: boolean) {
  const server = await startTestServer({ experimentalEngineEnabled: enabled })
  servers.push(server)
  const host = server.client()
  const payload = await host.json<RoomPayload>("/api/tables", jsonRequest({ playerName: "Alice" }))
  const code = payload.space?.code
  if (!code) throw new Error("Room creation failed")
  return { server, host, code }
}

describe("Stage 28B feature-gated browser entry", () => {
  test("regular tabletop contains no experimental engine panel or module", async () => {
    const { host, code } = await room(false)
    const page = await (await host.fetch(`/tables/${code}`, { headers: { accept: "text/html" } })).text()
    expect(page).not.toContain("data-stage28b-engine")
    expect(page).not.toMatch(/<script[^>]*src="\/assets\/experimental-engine/)
    expect(page).toContain("data-game")
  })

  test("enabled tabletop has a stamped, loadable module and accessible controls", async () => {
    const { host, code } = await room(true)
    const page = await (await host.fetch(`/tables/${code}`, { headers: { accept: "text/html" } })).text()
    expect(page).toContain("data-stage28b-engine")
    expect(page).toContain("data-engine-start")
    expect(page).toContain("data-engine-pass")
    expect(page).toContain('role="status" aria-live="polite"')
    const script = /<script type="module" src="(\/assets\/experimental-engine\.[0-9a-f]{12}\.js)"/.exec(page)?.[1]
    expect(script).toBeTruthy()
    const result = await host.fetch(script!)
    expect(result.status).toBe(200)
    expect(result.headers.get("cache-control")).toContain("immutable")
    expect(await result.text()).toContain("mountEnginePanel")
  })
})
