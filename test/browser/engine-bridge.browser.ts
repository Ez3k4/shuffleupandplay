import { expect, test } from "@playwright/test"
import { joinTable, loadDeck, openTable } from "./support.ts"

test.skip(process.env.SHUFFLE_EXPERIMENTAL_ENGINE !== "1", "Enable SHUFFLE_EXPERIMENTAL_ENGINE=1 for the bridge browser test")

test("real card identity link reports a later manual draw without changing normal play", async ({ page, browser }) => {
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  try {
    const { code } = await openTable(page)
    await joinTable(guest, code, "Bob")
    await loadDeck(page, code)
    await loadDeck(guest, code)
    const hostPanel = page.locator("[data-stage28b-engine]")
    const guestPanel = guest.locator("[data-stage28b-engine]")
    await hostPanel.locator("summary").click()
    await guestPanel.locator("summary").click()
    await hostPanel.locator("[data-engine-start]").click()
    await expect(hostPanel.locator("[data-engine-cards]")).toHaveText(/\d+ cards linked/)
    await expect(guestPanel.locator("[data-engine-cards]")).toHaveText(/\d+ cards linked/, { timeout: 12_000 })

    // The old manual action still works; the engine now warns rather than silently
    // changing its own copies of the card locations.
    const manual = await page.evaluate(async (tableCode) => {
      const response = await fetch(`/api/tables/${tableCode}/actions`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: { type: "drawCard", count: 1 } }),
      })
      return response.status
    }, code)
    expect(manual).toBe(200)
    await expect(hostPanel.locator("[data-engine-cards]")).toContainText("Out of sync", { timeout: 12_000 })
    await expect(guestPanel.locator("[data-engine-cards]")).toContainText("Out of sync", { timeout: 12_000 })
    await expect(hostPanel.locator("[data-engine-pass]")).toBeEnabled()
  } finally {
    await guestContext.close()
  }
})
