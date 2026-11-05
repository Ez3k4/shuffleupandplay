/** Stage 16C — guard against a roster consuming a battlefield grid row.
 * Run: node --test test/stage16-roster-grid.nodecheck.mjs
 * This source-level test needs no browser or third-party dependencies.
 */
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/server/render/pages.ts', import.meta.url), 'utf8')
const opponentScript = readFileSync(new URL('../public/stage16-opponents.js', import.meta.url), 'utf8')

test('roster sits in the toolbar, above two equal battlefield rows', () => {
  assert.match(css, /#players-area\[data-stage16-players\]\s*\{[^}]*grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(css, /\.compact-tabletop-toolbar\s*>\s*#component-opponentRoster\s*\{[^}]*grid-column:\s*2/s)
  assert.match(css, /\.compact-tabletop-toolbar\s*>\s*\.compact-toolbar-details\s*\{/s)
})

test('opponent placeholders occupy one row and own board occupies another', () => {
  assert.match(css, />\s*\.stage16-opponent-panel\s*\{[^}]*grid-row:\s*1/s)
  assert.match(css, />\s*\[id\^="component-player-"\]\s*\{[^}]*grid-row:\s*2/s)
  assert.match(css, /\.stage16-opponent-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/s)
})

test('table contains one owned player slot and three reusable opponent placeholders', () => {
  assert.match(page, /opponentSeats\.map\(\(seat\)/)
  assert.match(page, /<div class="compact-tabletop-toolbar"/)
  assert.ok(page.indexOf('name: "opponentRoster", context') < page.indexOf('<div id="players-area"'))
  assert.match(opponentScript, /game\.querySelector\('#component-opponentRoster'\)/)
  assert.match(page, /data-stage16-opponent-panel/)
  assert.match(page, /componentSlot\(\{\s*name:\s*"player",\s*key:\s*options\.seat/s)
  assert.match(opponentScript, /selectedSeat\s*=\s*button\.dataset\.stage16SelectSeat/)
})
