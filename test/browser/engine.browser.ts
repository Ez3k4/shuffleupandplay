import { expect, test } from "@playwright/test"
import { joinTable, loadDeck, openTable } from "./support.ts"

test.skip(process.env.SHUFFLE_EXPERIMENTAL_ENGINE !== "1", "Enable SHUFFLE_EXPERIMENTAL_ENGINE=1 for the experimental browser test")

test("two players start an isolated engine and pass priority without changing the manual UI", async ({ page, browser }) => {
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  try {
    const { code } = await openTable(page)
    await joinTable(guest, code, "Bob")
    await loadDeck(page, code)
    await loadDeck(guest, code)
    const hostPanel = page.locator("[data-stage28b-engine]")
    const guestPanel = guest.locator("[data-stage28b-engine]")
    await expect(hostPanel).toHaveCount(1)
    await expect(guestPanel).toHaveCount(1)
    await hostPanel.locator("summary").click()
    await guestPanel.locator("summary").click()
    await expect(hostPanel.locator("[data-engine-start]")).toBeVisible()
    await expect(guestPanel.locator("[data-engine-start]")).toBeHidden()
    await hostPanel.locator("[data-engine-start]").click()
    await expect(hostPanel.locator("[data-engine-pass]")).toBeEnabled()
    await expect(guestPanel.locator("[data-engine-pass]")).toBeDisabled()
    await hostPanel.locator("[data-engine-pass]").click()
    await expect(guestPanel.locator("[data-engine-pass]")).toBeEnabled({ timeout: 12_000 })
    await guestPanel.locator("[data-engine-pass]").click()
    await expect(hostPanel.locator("[data-engine-step]")).toHaveText("draw", { timeout: 12_000 })
    await expect(page.locator(".your-seat")).toBeVisible()
    await expect(guest.locator(".your-seat")).toBeVisible()
  } finally {
    await guestContext.close()
  }
})
