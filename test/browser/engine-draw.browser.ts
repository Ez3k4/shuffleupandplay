import { expect, test } from "@playwright/test"
import { joinTable, loadDeck, openTable, seatState } from "./support.ts"

test.skip(process.env.SHUFFLE_EXPERIMENTAL_ENGINE !== "1", "Enable experimental engine for browser test")

test("one experimental draw updates the existing tabletop hand without divergence", async ({ page, browser }) => {
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
    await expect(panel.locator("[data-engine-cards]")).toContainText("cards linked", { timeout: 12000 })
    const before = await seatState(page, code)
    await expect(panel.locator("[data-engine-draw]")).toBeEnabled()
    await panel.locator("[data-engine-draw]").click()
    await expect.poll(async () => (await seatState(page, code)).hand.length).toBe(before.hand.length + 1)
    await expect(panel.locator("[data-engine-cards]")).toContainText("cards linked", { timeout: 12000 })
    await expect(panel.locator("[data-engine-pass]")).toBeEnabled()
    await expect(guest.locator("[data-stage28b-engine]")).toHaveCount(1)
  } finally {
    await guestContext.close()
  }
})
