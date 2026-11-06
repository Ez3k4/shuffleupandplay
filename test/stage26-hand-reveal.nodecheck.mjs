// Stage 26: node --experimental-strip-types --test test/stage26-hand-reveal.nodecheck.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { applyPlayerAction, buildPlayer } from '../src/game/player.ts'
import { parseAction } from '../src/game/action.ts'
import { roomPayload, seatFingerprints } from '../src/game/room-snapshot.ts'
import { renderComponent } from '../src/server/render/components.ts'

const card = (id) => ({ instanceId: id, name: `Private ${id}`, imageUrl: `https://example.org/${id}.jpg`, scryfallId: `private-${id}`, tapped: false, isManaSource: false })
function setup() {
  const alice = buildPlayer({ identifier: 'alice', name: 'Alice', seat: 1, sessionId: 'one' })
  const bob = buildPlayer({ identifier: 'bob', name: 'Bob', seat: 2, sessionId: 'two' })
  alice.hand = [card('a1'), card('a2')]
  alice.library = [card('a3')]
  bob.hand = [card('b1'), card('b2')]
  return { id: 'room', code: 'ABCDE1', name: 'Table', version: 3, createdAt: 'now', updatedAt: 'now', players: [alice, bob] }
}
const project = (room, sessionId) => roomPayload({ room, sessionId })
const renderSeat = (payload, seat) => renderComponent({ name: 'player', key: String(seat), context: { payload, roomCode: 'ABCDE1', seat: payload.space.players.find(p => p.id === payload.currentPlayerId)?.seat ?? 1, shareUrl: 'http://example.com' } })

test('only a card in the owning hand can be toggled, server validates input', () => {
  const player = setup().players[0]
  assert.deepEqual(parseAction({ type: 'toggleHandReveal', instanceId: 'a1' }), { type: 'toggleHandReveal', instanceId: 'a1' })
  assert.equal(parseAction({ type: 'toggleHandReveal', instanceId: 0 }), null)
  assert.equal(parseAction({ type: 'toggleHandReveal', instanceId: '' }), null)
  assert.deepEqual(applyPlayerAction({ player, action: { type: 'toggleHandReveal', instanceId: 'a3' } }).revealedHandCardIds, undefined)
  const showing = applyPlayerAction({ player, action: { type: 'toggleHandReveal', instanceId: 'a1' } })
  assert.deepEqual(showing.revealedHandCardIds, ['a1'])
  const hiding = applyPlayerAction({ player: showing, action: { type: 'toggleHandReveal', instanceId: 'a1' } })
  assert.deepEqual(hiding.revealedHandCardIds, [])
})

test('only deliberately shown card face goes to another seated player; unknown viewer gets none', () => {
  const room = setup()
  room.players[0] = applyPlayerAction({ player: room.players[0], action: { type: 'toggleHandReveal', instanceId: 'a1' } })
  const bobView = project(room, 'two').space.players[0]
  assert.equal(bobView.hand[0].name, 'Private a1')
  assert.equal(bobView.hand[0].imageUrl, 'https://example.org/a1.jpg')
  assert.equal(bobView.hand[0].isRevealed, true)
  assert.notEqual(bobView.hand[0].instanceId, 'a1')
  assert.notEqual(bobView.hand[0].scryfallId, 'private-a1')
  assert.equal(bobView.hand[1].name, 'Hidden card')
  assert.equal(bobView.hand[1].imageUrl, '')
  assert.equal(bobView.library[0].name, 'Hidden card')
  const anonymous = JSON.stringify(project(room, 'third'))
  assert.equal(anonymous.includes('Private a1'), false)
  assert.equal(anonymous.includes('a1.jpg'), false)
  const owner = project(room, 'one').space.players[0]
  assert.equal(owner.hand[0].isRevealed, true)
  assert.equal(owner.hand[1].isRevealed, undefined)
})

test('clears reveal automatically when a card leaves hand, including if it returns later', () => {
  const room = setup()
  let player = applyPlayerAction({ player: room.players[0], action: { type: 'toggleHandReveal', instanceId: 'a1' } })
  player = applyPlayerAction({ player, action: { type: 'moveCardZone', from: 'hand', to: 'graveyard', instanceId: 'a1' } })
  assert.deepEqual(player.revealedHandCardIds, [])
  player = applyPlayerAction({ player, action: { type: 'moveCardZone', from: 'graveyard', to: 'hand', instanceId: 'a1' } })
  assert.deepEqual(player.revealedHandCardIds, [])
  room.players[0] = player
  const bobView = project(room, 'two').space.players[0]
  assert.equal(JSON.stringify(bobView.hand).includes('a1.jpg'), false)
})

test('seat invalidation changes as soon as a hand card is revealed or hidden', () => {
  const room = setup()
  const original = seatFingerprints(room)[0].revealedHandCardIds
  room.players[0] = applyPlayerAction({ player: room.players[0], action: { type: 'toggleHandReveal', instanceId: 'a1' } })
  assert.deepEqual(original, [])
  assert.deepEqual(seatFingerprints(room)[0].revealedHandCardIds, ['a1'])
})

test('opponent markup shows exactly one face and a visible hand count, not action IDs', () => {
  const room = setup()
  room.players[0] = applyPlayerAction({ player: room.players[0], action: { type: 'toggleHandReveal', instanceId: 'a1' } })
  const bobPayload = project(room, 'two')
  const html = renderSeat(bobPayload, 1)
  assert.match(html, /stage26-revealed-card/)
  assert.match(html, /Private a1/)
  assert.match(html, /\/a1\.jpg/)
  assert.match(html, /stage25-opponent-hand-strip/)
  assert.match(html, /data-zone-count="hand"[^>]*data-count="2"/)
  assert.doesNotMatch(html, /\/a2\.jpg/)
  assert.doesNotMatch(html, /data-hand-play-instance-id/)
  const aliceHtml = renderSeat(project(room, 'one'), 1)
  assert.match(aliceHtml, /data-stage26-revealed="true"/)
})

test('owner right-click menu exposes a reversible reveal action', () => {
  const js = readFileSync(new URL('../public/shuffle.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')
  assert.match(js, /data-stage26-hand-reveal/)
  assert.match(js, /Hide from opponent/)
  assert.match(js, /Show to opponent/)
  assert.match(js, /type:'toggleHandReveal'/)
  assert.match(css, /rotate\(180deg\)/)
  assert.match(css, /stage26-fan-angle/)
})
