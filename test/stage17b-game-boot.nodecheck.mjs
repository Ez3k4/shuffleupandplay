/** Regression for Stage 17's game-only Temporal Dead Zone startup failure.
 * Run: node --test test/stage17b-game-boot.nodecheck.mjs
 */
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const script = readFileSync(new URL('../public/shuffle.js', import.meta.url), 'utf8')

test('game startup runs after token catalog and other module declarations', () => {
  const initializer = script.lastIndexOf('if (game) {\n  wireStage11FourCardTiers(game)\n  start(game)')
  const tokenCatalog = script.indexOf('const STAGE17_TOKENS =')
  const mirror = script.indexOf('let mirror = null')
  const connection = script.indexOf('const CONNECTION_LABELS =')
  const stage8Hover = script.indexOf('let stage8bHover = null')
  assert.ok(initializer > 0, 'game startup must be grouped at bottom of module')
  assert.ok(tokenCatalog < initializer && mirror < initializer && connection < initializer && stage8Hover < initializer,
    'game startup must not run before module-level constants and mutable state are initialized')
  assert.equal((script.match(/^\s*start\(game\)\s*$/gm) ?? []).length, 1, 'start(game) should be called in exactly one place')
})

test('game startup does not prevent lobby wallpaper initialization', () => {
  assert.match(script, /else\s*\{[^}]*mountStage14LobbyWallpaper\(lobbyPanel\)/s)
  assert.match(script, /wireStage17TokenPicker\(actorId\)/)
  assert.match(script, /wireDeckForms\(game, actorId\)/)
  assert.match(script, /mountStage13Wallpapers\(game\)/)
  assert.match(script, /wireCopyButton\(\)/)
})
