import { expect, test } from "@playwright/test"
import { joinTable, loadDeck, openTable, seatState } from "./support.ts"

test.skip(process.env.SHUFFLE_EXPERIMENTAL_ENGINE !== "1", "Enable experimental engine for browser test")

test("play a land from hand into the real battlefield while retaining a synced engine", async ({ page, browser }) => {
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  try {
    const { code } = await openTable(page)
    await joinTable(guest, code, "Bob")
    await loadDeck(page, code)
    await loadDeck(guest, code)
    const panel = page.locator("[data-stage28b-engine]")
    await panel.locator("summary").click()
    await panel.locator("[data-engine-start]").click()
    // A random deck's top card need not be a land; draw until one is in hand.
    const engineView = async () => page.evaluate(async (roomCode) => {
      const response = await fetch(`/api/tables/${roomCode}/engine`)
      return response.json() as Promise<{ roomVersion: number; playableLands?: unknown[] }>
    }, code)
    let landAvailable = false
    for (let i = 0; i < 40; i++) {
      const current = await engineView()
      if (current.playableLands?.length) { landAvailable = true; break }
      await expect(panel.locator("[data-engine-draw]")).toBeEnabled({ timeout: 12_000 })
      await panel.locator("[data-engine-draw]").click()
      await expect.poll(async () => (await engineView()).roomVersion).toBeGreaterThan(current.roomVersion)
    }
    expect(landAvailable).toBe(true)
    for (const who of [page, guest, page, guest]) {
      const container = who.locator("[data-stage28b-engine]")
      if (who === guest) await container.locator("summary").click().catch(() => undefined)
      await expect(container.locator("[data-engine-pass]")).toBeEnabled({ timeout: 12_000 })
      await container.locator("[data-engine-pass]").click()
    }
    const before = await seatState(page, code)
    await expect(panel.locator("[data-engine-land]")).toBeEnabled({ timeout: 12_000 })
    await panel.locator("[data-engine-land]").click()
    await expect.poll(async () => (await seatState(page, code)).battlefield.length).toBe(before.battlefield.length + 1)
    await expect(panel.locator("[data-engine-cards]")).toContainText("cards linked", { timeout: 12_000 })
    await expect(panel.locator("[data-engine-land]")).toBeDisabled()
  } finally {
    await guestContext.close()
  }
})
