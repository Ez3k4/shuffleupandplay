// Stage 24 + 24B: the Planeswalker lane must clear land stacks on both seats.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')
const block = css.slice(css.lastIndexOf('/* ===== Stage 24:'))

test('walker lane stays along the left edge and clears land stacks', () => {
  assert.match(block, /\.opponent-seat > \.stage12-planeswalker-area\s*\{/)
  assert.match(block, /left:\s*clamp\(/)
  assert.match(block, /right:\s*auto/)
  assert.match(block, /bottom:\s*calc\(var\(--stage24b-land-clearance/)
  assert.match(block, /top:\s*var\(--stage24b-land-clearance/)
  assert.doesNotMatch(block, /transform:\s*translateY\(-50%\)/)
})

test('walkers use full-card aspect ratio and enlarge according to available height', () => {
  assert.match(block, /--stage7-land-width:\s*clamp\(82px, min\(calc\(var\(--tabletop-card-width\) \* 1\.2\)/)
  assert.match(block, /--stage7-land-height:\s*calc\(var\(--stage7-land-width\) \* 680 \/ 488\)/)
  assert.match(block, /\.stage12-planeswalker-area \.stage7-land-card\.battlefield-card\s*\{\s*width:\s*var\(--stage7-land-width\);\s*height:\s*var\(--stage7-land-height\)/)
})

test('land, utility and Commander zone definitions remain unchanged', () => {
  assert.doesNotMatch(block, /\.stage12-utility-area/)
  assert.doesNotMatch(block, /\.stage10-command-zone/)
  assert.doesNotMatch(block, /\.compact-special-lanes/)
})
