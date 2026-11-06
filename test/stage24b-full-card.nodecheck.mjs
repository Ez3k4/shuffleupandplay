// Stage 24B: Planeswalkers show printed abilities instead of cropped artwork.
// Run: node --experimental-strip-types --test test/stage24b-full-card.nodecheck.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { buildPlayer } from '../src/game/player.ts'
import { roomPayload } from '../src/game/room-snapshot.ts'
import { renderComponent } from '../src/server/render/components.ts'

function card(id, name, typeLine, props = {}) {
  return {
    instanceId: id, name, typeLine, scryfallId: 'abcdef00-0000-0000-0000-000000000000',
    imageUrl: `https://cards.scryfall.io/normal/front/a/b/${id}.jpg`,
    artCropUrl: `https://cards.scryfall.io/art_crop/front/a/b/${id}.jpg`,
    isLand: /\bLand\b/i.test(typeLine),
    isManaSource: false, isAttachment: false,
    isUtilityPermanent: /\b(?:Enchantment|Artifact)\b/i.test(typeLine),
    tapped: false, x: 200, y: 300, counters: [], ...props,
  }
}
function render(cards, owner = true) {
  const a = buildPlayer({ name: 'Alice', seat: 1, identifier: 'p1', sessionId: 's1' })
  const b = buildPlayer({ name: 'Bob', seat: 2, identifier: 'p2', sessionId: 's2' })
  a.deckStatus = 'loaded'
  a.battlefield = cards
  const room = {
    id: 'room1', code: 'ABC123', name: 'Test', version: 1,
    createdAt: '2026-11-06', updatedAt: '2026-11-06', maxPlayers: 2,
    players: [a, b],
  }
  return renderComponent({ name: 'player', key: '1', context: {
    payload: roomPayload({ room, sessionId: owner ? 's1' : 's2' }),
    roomCode: 'ABC123', seat: owner ? 1 : 2,
    shareUrl: 'https://example.test/tables/ABC123',
  } })
}
const walker = card('walker', 'Jace, the Mind Sculptor', 'Legendary Planeswalker — Jace', {
  counters: [{ id: 'loyalty-1', label: 'Loyalty', value: 3, x: 6, y: 6 }],
})
const enchantment = card('enchant', 'Rhystic Study', 'Enchantment')
const creature = card('creature', 'Llanowar Elves', 'Creature — Elf Druid', { isCreature: true })
const land = card('land', 'Forest', 'Basic Land — Forest')

for (const owner of [true, false]) {
  test(`Planeswalker has complete normal card image for ${owner ? 'owner' : 'opponent'}`, () => {
    const html = render([walker], owner)
    const lane = html.match(/<div class="stage12-planeswalker-area"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0]
    assert.ok(lane, 'Planeswalker lane was rendered')
    assert.match(lane, /stage24b-full-planeswalker/)
    assert.match(lane, /src="https:\/\/cards\.scryfall\.io\/normal\/front\/a\/b\/walker\.jpg"/)
    assert.doesNotMatch(lane, /compact-art-image|compact-card-name|art_crop/)
    assert.match(lane, /data-instance-id="walker"/)
    assert.match(lane, /data-counter-id="loyalty-1"/)
    if (owner) assert.match(lane, /data-game-action=/)
  })
}

test('creatures and utility cards retain their compact art crop; lands retain full card', () => {
  const html = render([walker, enchantment, creature, land])
  for (const id of ['enchant', 'creature']) {
    assert.match(html, new RegExp(`src="https:\\/\\/cards\\.scryfall\\.io\\/art_crop\\/front\\/a\\/b\\/${id}\\.jpg"`))
  }
  assert.match(html, /src="https:\/\/cards\.scryfall\.io\/normal\/front\/a\/b\/land\.jpg"/)
})

test('walker lane is outside the canvas and retains move/counter/attachment menus', () => {
  const html = render([walker])
  const walkerLaneIndex = html.indexOf('stage12-planeswalker-area')
  const canvasCloseIndex = html.indexOf('</div></div>', html.indexOf('class="battlefield-canvas"'))
  assert.ok(walkerLaneIndex > canvasCloseIndex)
  assert.match(html, /Create token copy of Jace/)
  assert.match(html, /Add counter/)
  assert.match(html, /Attach Jace/)
})

test('CSS uses full print aspect ratio, mirrored land clearances and contain fit', () => {
  const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')
  const styles = css.slice(css.lastIndexOf('/* ===== Stage 24:'))
  assert.match(styles, /stage24b-land-clearance/)
  assert.match(styles, /680\s*\/\s*488/)
  assert.match(styles, /\.opponent-seat > \.stage12-planeswalker-area\s*\{\s*top:\s*var/)
  assert.match(styles, /\.stage24b-full-planeswalker > img\s*\{[\s\S]*?object-fit:\s*contain/)
  assert.doesNotMatch(styles, /\.stage12-utility-area/)
})
