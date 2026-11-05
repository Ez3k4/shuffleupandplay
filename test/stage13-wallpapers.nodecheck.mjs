/** Stage 13 wallpaper selection: mixed extensions, distinct per seat. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseStage13Wallpaper } from '../public/stage13-wallpapers.js'

test('accepts JPG and PNG but rejects non-image and unsafe names', () => {
  const names = ['one.jpg', 'two.png', 'three.JPEG', 'bad.svg', '../escape.jpg']
  assert.equal(chooseStage13Wallpaper(names, new Set(), () => 0), 'one.jpg')
  assert.equal(chooseStage13Wallpaper(names, new Set(['one.jpg']), () => 0), 'two.png')
})

test('prefers unused image for second battlefield when multiple exist', () => {
  const files = ['one.jpg', 'two.png']
  const first = chooseStage13Wallpaper(files, new Set(), () => 0)
  const second = chooseStage13Wallpaper(files, new Set([first]), () => 0)
  assert.notEqual(first, second)
})

test('uses available image when there is just one, empty manifest is safe', () => {
  assert.equal(chooseStage13Wallpaper(['only.png'], new Set(['only.png'])), 'only.png')
  assert.equal(chooseStage13Wallpaper([]), null)
})
