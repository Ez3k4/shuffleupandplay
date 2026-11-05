/** Stage 14 smoke tests for the lobby and neutral battlefield styling. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chooseStage13Wallpaper, mountStage14LobbyWallpaper } from '../public/stage13-wallpapers.js'

const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')
const script = readFileSync(new URL('../public/shuffle.js', import.meta.url), 'utf8')

test('wallpaper list accepts both JPG and PNG on the lobby', () => {
  assert.equal(chooseStage13Wallpaper(['forest.jpg', 'sky.png'], new Set(), () => 0), 'forest.jpg')
  assert.equal(chooseStage13Wallpaper(['forest.jpg', 'sky.png'], new Set(), () => 0.99), 'sky.png')
})

test('lobby wallpaper is mounted only for the initial screen', () => {
  assert.match(script, /if \(lobbyPanel && !game\) mountStage14LobbyWallpaper\(lobbyPanel\)/)
})

test('battlefield wallpaper has no tinted gradient', () => {
  assert.match(css, /STAGE 14[\s\S]*?\.battlefield-canvas\[data-stage13-wallpaper\]::before \{\s*background-image: var\(--stage13-wallpaper, none\);/)
  assert.match(css, /\.battlefield-canvas\[data-stage13-wallpaper\] \{\s*background: #14161b;/)
})

test('lobby panels are partially transparent', () => {
  assert.match(css, /lobby-panel\) > \.panel \{\s*background: rgba\(13, 17, 25, 0\.57\)/)
})

test('lobby loading sets background only after a valid manifest result', async () => {
  const prior = {fetch:globalThis.fetch, document:globalThis.document}
  const properties = {}
  const classes = []
  globalThis.document = { body: {
    style: {setProperty: (key,value) => {properties[key] = value}},
    classList: {add: (value) => {classes.push(value)}},
  }}
  globalThis.fetch = async () => ({ok: true, json: async () => ['forest.jpg']})
  try {
    mountStage14LobbyWallpaper({ isConnected: true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(properties['--stage14-lobby-wallpaper'], 'url("/assets/wallpapers/forest.jpg")')
    assert.deepEqual(classes, ['stage14-lobby-background'])
  } finally {
    globalThis.fetch = prior.fetch
    globalThis.document = prior.document
  }
})
