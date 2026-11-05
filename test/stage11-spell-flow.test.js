// @vitest-environment happy-dom
// Stage 11 regressions retained with Stage 12: no new server rules are needed
// for the centered overlay. Run with: pnpm exec vitest run test/stage1*.test.js
import { describe, expect, test } from 'vitest'
import { buildPlayer, applyPlayerAction } from '../src/game/player.ts'
import { parseAction } from '../src/game/action.ts'
import { roomPayload } from '../src/game/room-snapshot.ts'
import { renderComponent } from '../src/server/render/components.ts'

function card(instanceId, typeLine) {
  return {
    instanceId, typeLine, name: `Card ${instanceId}`,
    scryfallId: instanceId, imageUrl: `https://example.org/${instanceId}.jpg`,
    tapped: false, isManaSource: false,
  }
}

const run = (player, type, instanceId) =>
  applyPlayerAction({ player, action: parseAction({ type, instanceId }) })

function rendered(room, sessionId, seat) {
  const payload = roomPayload({ room, sessionId })
  return renderComponent({ name: 'player', key: '1', context: {
    payload, roomCode: room.code, seat, shareUrl: 'https://example.org',
  } })
}

describe('Stage 11 spell persistence remains intact', () => {
  test('an instant and sorcery wait for Resolve while a creature enters battlefield', () => {
    let player = buildPlayer({ name:'Alice', seat:1, sessionId:'s1', identifier:'p1' })
    player.deckStatus = 'loaded'
    player.hand = [card('inst','Instant'),card('sorc','Sorcery'),card('crea','Creature — Human')]
    player = run(player,'playFromHand','inst')
    player = run(player,'playFromHand','sorc')
    player = run(player,'playFromHand','crea')
    expect(player.hand).toHaveLength(0)
    expect(player.pendingSpells.map(c=>c.instanceId)).toEqual(['inst','sorc'])
    expect(player.battlefield.map(c=>c.instanceId)).toEqual(['crea'])
    expect(player.graveyard).toHaveLength(0)
    player=run(player,'resolveSpell','inst')
    expect(player.graveyard.map(c=>c.instanceId)).toEqual(['inst'])
    expect(player.pendingSpells.map(c=>c.instanceId)).toEqual(['sorc'])
    // Resolving twice must not duplicate a card.
    player=run(player,'resolveSpell','inst')
    expect(player.graveyard.map(c=>c.instanceId)).toEqual(['inst'])
  })

  test('Resolve is available only to the controller; click-to-play stays disabled', () => {
    const alice=buildPlayer({ name:'Alice',seat:1,sessionId:'s1',identifier:'p1' })
    const bob=buildPlayer({ name:'Bob',seat:2,sessionId:'s2',identifier:'p2' })
    alice.deckStatus='loaded'
    alice.hand=[card('hand','Creature')]
    alice.pendingSpells=[card('inst','Instant')]
    const room={ id:'room',code:'ABC123',name:'test',version:1,createdAt:'now',updatedAt:'now',players:[alice,bob] }
    const own=rendered(room,'s1',1)
    const other=rendered(room,'s2',2)
    const root = document.createElement('div')
    root.innerHTML = own
    const hand = root.querySelector('[data-hand-play-instance-id="hand"]')
    expect(hand).not.toBeNull()
    expect(hand.hasAttribute('data-game-action')).toBe(false)
    expect(own).toContain('resolveSpell')
    expect(other).not.toContain('resolveSpell')
    expect(other).toContain('Waiting for player')
  })
})
