/** Stage 15: wallpapers survive player-component morphs and appear before opponent joins. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mountStage13Wallpapers } from '../public/stage13-wallpapers.js'

const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')

test('initializes both wallpapers before opponent joins; never mutates a canvas', async () => {
  const originalFetch = globalThis.fetch
  const properties = new Map()
  const attributes = new Map()
  const area = {
    style: { setProperty: (key, value) => properties.set(key, value) },
    setAttribute: (key, value) => attributes.set(key, value),
  }
  // There is just one canvas on the page at this point: the local seat.
  const initialCanvas = { attributes: new Map() }
  const game = { querySelector: (selector) => selector === '#players-area' ? area : null }
  globalThis.fetch = async () => ({ ok: true, json: async () => ['one.jpg', 'two.png'] })
  try {
    mountStage13Wallpapers(game)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(attributes.has('data-stage13-wallpapers-ready'), true)
    assert.match(properties.get('--stage13-wallpaper-own'), /one\.jpg|two\.png/)
    assert.match(properties.get('--stage13-wallpaper-opponent'), /one\.jpg|two\.png/)
    assert.notEqual(properties.get('--stage13-wallpaper-own'), properties.get('--stage13-wallpaper-opponent'))
    assert.equal(initialCanvas.attributes.size, 0)

    // A normal game update can discard/recreate the entire canvas subtree.
    const replacedCanvas = { attributes: new Map() }
    assert.notEqual(initialCanvas, replacedCanvas)
    assert.equal(properties.size, 2)
    assert.equal(attributes.has('data-stage13-wallpapers-ready'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CSS applies wallpapers by seat role to new or existing canvases', () => {
  assert.match(css, /#players-area\[data-stage13-wallpapers-ready\] \.your-seat \.battlefield-canvas::before/)
  assert.match(css, /#players-area\[data-stage13-wallpapers-ready\] \.opponent-seat \.battlefield-canvas::before/)
  assert.match(css, /background-image: var\(--stage13-wallpaper-own, none\)/)
  assert.match(css, /background-image: var\(--stage13-wallpaper-opponent, none\)/)
})

test('no observer or attributes are attached to morph-managed canvases', () => {
  const source = readFileSync(new URL('../public/stage13-wallpapers.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /new MutationObserver/)
  assert.doesNotMatch(source, /canvas\.setAttribute/)
  assert.doesNotMatch(source, /canvas\.style\.setProperty/)
})

test('missing manifest falls back to default battlefield rendering', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  const game = { querySelector: () => ({
    style: { setProperty: () => { called = true } },
    setAttribute: () => { called = true },
  }) }
  globalThis.fetch = async () => ({ ok: false })
  try {
    mountStage13Wallpapers(game)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
