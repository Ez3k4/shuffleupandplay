/** Stage 13 drag targets, Node built-in test runner (no browser deps). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findStage13DropTarget } from '../public/stage13-drop-target.js'

function fixture() {
  const board = {
    hidden: false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
    contains: (element) => element === overlay,
  }
  const overlay = { hidden: false }
  const field = { kind: 'battlefield' }
  const game = {
    contains: (element) => element === field,
    querySelector: (selector) => selector === '#players-area' ? board : null,
  }
  return { board, overlay, field, game }
}

test('either player battlefield is a valid hand drop target', () => {
  const { game, field } = fixture()
  assert.equal(findStage13DropTarget(game, 20, 20, {
    closest: (selector) => selector === '.player-section .battlefield' ? field : null,
  }), field)
})

test('existing shared spell overlay accepts cards', () => {
  const { game, overlay } = fixture()
  assert.equal(findStage13DropTarget(game, 500, 300, {
    closest: (selector) => selector === '.stage12-shared-spell-stack' ? overlay : null,
  }), overlay)
})

test('empty center spell area accepts cards; off-board cancels', () => {
  const { game, board } = fixture()
  const hit = { closest: () => null }
  assert.equal(findStage13DropTarget(game, 500, 300, hit), board)
  assert.equal(findStage13DropTarget(game, 900, 580, hit), null)
})

test('a special-lane overlay covering a battlefield is a valid drop', () => {
  const { game, field } = fixture()
  field.getBoundingClientRect = () => ({left: 0, top: 0, right: 1000, bottom: 600})
  const seat = { querySelector: () => field }
  assert.equal(findStage13DropTarget(game, 900, 250, {
    closest: selector => selector === '.player-section' ? seat : null,
  }), field)
})

test('off-game battlegrounds are not accepted', () => {
  const { game } = fixture()
  const outside = {}
  assert.equal(findStage13DropTarget(game, 15, 20, {
    closest: selector => selector === '.player-section .battlefield' ? outside : null,
  }), null)
})
