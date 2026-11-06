// Stage 24C: read-only source checks for a self-contained, always-visible rules guide.
// Run: node --test test/stage24c-rules-layout.nodecheck.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/server/render/pages.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')
const stage = css.slice(css.indexOf('/* ===== Stage 24C:'))

test('rules button is directly beside the live opponent roster, not inside collapsible settings', () => {
  const rosterIndex = page.indexOf('${componentSlot({ name: "opponentRoster", context })}')
  const rulesIndex = page.indexOf('<details class="stage24c-rules"')
  const settingsCloseIndex = page.indexOf('</details>')
  assert.ok(rosterIndex > settingsCloseIndex)
  assert.ok(rulesIndex > rosterIndex)
  assert.ok(page.indexOf('data-stage24c-rules', rulesIndex) > rulesIndex)
  assert.match(page.slice(rulesIndex), /<summary[^>]*>📖 Rules<\/summary>/)
})

test('guide stays short and contains the five phases and core mechanics', () => {
  const panel = page.split('<section class="stage24c-rules-panel"')[1].split('</section>')[0]
  for (const word of ['Untap', 'upkeep', 'draw', 'Main 1', 'Combat', 'Main 2', 'Ending', 'land', 'Instants', 'stack', 'Commander']) {
    assert.ok(panel.includes(word), `missing ${word}`)
  }
  assert.match(panel, /magic\.wizards\.com\/en\/how-to-play/)
})

test('walker sizes are reduced 20 percent in all constraint branches', () => {
  assert.match(stage, /clamp\(65\.6px,\s*min\(calc\(var\(--tabletop-card-width\) \* 0\.96\)/)
  assert.match(stage, /calc\(\(27dvh - 55px\) \* 0\.8\)/)
  assert.match(stage, /142\.4px/)
  assert.match(stage, /680\s*\/\s*488/)
})

test('walker clearances move away from each side’s lands without changing card actions', () => {
  assert.match(stage, /bottom:\s*calc\(var\(--stage24b-land-clearance, 107px\) \+ 2\.1rem\)/)
  assert.match(stage, /\.opponent-seat > \.stage12-planeswalker-area\s*\{\s*top:\s*calc\(var\(--stage24b-land-clearance, 107px\) \+ 1\.1rem\)/)
  assert.doesNotMatch(stage, /data-game-action|createToken|updateCounterValue/)
})

test('rules panel opens outside the document flow with responsive placement', () => {
  assert.match(stage, /\.stage24c-rules-panel\s*\{[\s\S]*?position:\s*absolute/)
  assert.match(stage, /grid-column:\s*3/)
  assert.match(stage, /@media \(max-width: 680px\)/)
})
