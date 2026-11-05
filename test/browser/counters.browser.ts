import { expect, test, type Page } from '@playwright/test'
import {
  clickAction, dropCounterOn, loadDeck, openTable, seatState, settle, waitForMirror,
} from './support.ts'

// Stage 19 replaces free-positioned counter chips with fixed bottom-left badges.
// The server keeps historical x/y coordinates for compatibility, but rendering
// no longer uses those coordinates. Test the new interaction, not old dragging.
const fieldCard = (page: Page) => page.locator('.your-seat .battlefield-canvas > .battlefield-card').first()
const badges = (page: Page) => fieldCard(page).locator(':scope > .stage19-counter-rack > .counter-chip')

async function playCard(page: Page): Promise<string> {
  const seat = await openTable(page)
  await loadDeck(page, seat.code)
  await waitForMirror(page)
  await clickAction(page, '"drawCard"')
  const hand = page.locator('.your-seat .hand-strip .hand-card').first()
  await expect(hand).toBeVisible()
  await hand.dragTo(page.locator('.your-seat .battlefield-canvas').first(), {
    targetPosition: { x: 210, y: 185 },
  })
  await expect(fieldCard(page)).toBeVisible()
  return seat.code
}

async function addBadge(page: Page): Promise<void> {
  await dropCounterOn({page,card:fieldCard(page),at:{x:35,y:45}})
  await expect(badges(page)).toHaveCount(1)
  await settle(page)
}

test('counters are grouped at the bottom-left with a readable tooltip', async ({page}) => {
  await playCard(page)
  await addBadge(page)
  const card=await fieldCard(page).boundingBox()
  const chip=await badges(page).first().boundingBox()
  expect(card && chip).toBeTruthy()
  if (!card || !chip) return
  expect(chip.x).toBeGreaterThanOrEqual(card.x)
  expect(card.y+card.height-(chip.y+chip.height)).toBeLessThanOrEqual(9)
  await expect(badges(page).first()).toHaveAttribute('title',/counter: 1.*left click \+1, right click −1/)
  await expect(badges(page).first().locator('.stage19-counter-symbol')).not.toBeEmpty()
})

test('left click adds one counter; right click removes one without opening the card menu', async ({page}) => {
  const code=await playCard(page)
  await addBadge(page)
  const badge=badges(page).first()
  await badge.click()
  await expect.poll(async()=> (await seatState(page,code)).battlefield[0]?.counters[0]?.value).toBe(2)
  await badge.click({button:'right'})
  await expect.poll(async()=> (await seatState(page,code)).battlefield[0]?.counters[0]?.value).toBe(1)
  await expect(fieldCard(page)).not.toHaveClass(/card-tools-open/)
  await badge.click({button:'right'})
  await expect(badges(page)).toHaveCount(0)
})

test('counter badges remain anchored after a remote-visible redraw', async ({page}) => {
  const code=await playCard(page)
  await addBadge(page)
  await clickAction(page,'"delta":-1')
  await expect.poll(async()=> (await seatState(page,code)).battlefield[0]?.counters.length).toBe(1)
  const position=await badges(page).first().evaluate(el=>{
    const r=el.getBoundingClientRect(),p=el.closest('.battlefield-card')!.getBoundingClientRect()
    return {left:r.left-p.left,bottom:p.bottom-r.bottom}
  })
  expect(position.left).toBeGreaterThanOrEqual(0)
  expect(position.bottom).toBeLessThanOrEqual(9)
})
