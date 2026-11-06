// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { buildPlayer } from '../src/game/player.ts'
import { stampNewPendingSpells } from '../src/game/stack-order.ts'
import { roomPayload } from '../src/game/room-snapshot.ts'
import { renderComponent } from '../src/server/render/components.ts'

function card(instanceId, typeLine = 'Creature') {
  return {
    instanceId, typeLine, name: `Secret ${instanceId}`,
    imageUrl: `https://example.org/private-${instanceId}.jpg`, scryfallId: instanceId,
    tapped: false, isManaSource: false,
  }
}
function room(players) {
  return { id: 'test', code: 'TEST12', name: 'Test', version: 17,
    createdAt: 'now', updatedAt: 'now', players }
}

describe('Stage 25 opponent card backs + global stack order', () => {
  test('renders one face-down fan card per hidden hand card, never card identity', () => {
    const alice = buildPlayer({ name: 'Alice', seat: 1, sessionId: 'alice-session', identifier: 'a' })
    const bob = buildPlayer({ name: 'Bob', seat: 2, sessionId: 'bob-session', identifier: 'b' })
    bob.hand = [card('1'), card('2'), card('3')]
    const payload = roomPayload({ room: room([alice, bob]), sessionId: 'alice-session' })
    const html = renderComponent({ name: 'player', key: '2', context: {
      payload, roomCode: 'TEST12', seat: 1, shareUrl: 'https://example.org/tables/TEST12',
    } })
    const root = document.createElement('div')
    root.innerHTML = html
    const fan = root.querySelector('.stage25-opponent-hand-strip')
    expect(fan.dataset.handCount).toBe('3')
    expect(fan.querySelectorAll('.stage25-opponent-card')).toHaveLength(3)
    expect(fan.querySelectorAll('.library-back-art')).toHaveLength(3)
    expect(fan.querySelector('[data-game-action], img, [data-hand-play-instance-id]')).toBeNull()
    expect(html).not.toContain('Secret 1')
    expect(html).not.toContain('private-1.jpg')
    expect(root.querySelector('.library-zone-preview .library-back-art')).not.toBeNull()
  })

  test('stamps only newly cast spells with a shared room version', () => {
    const before = buildPlayer({ name: 'Alice', seat: 1, sessionId: 's', identifier: 'a' })
    before.pendingSpells = [{ ...card('old', 'Instant'), stackOrder: 9 }]
    const after = { ...before, pendingSpells: [...before.pendingSpells, card('new', 'Instant')] }
    const result = stampNewPendingSpells({ before, after, roomVersion: 17 })
    expect(result.pendingSpells.map(({ stackOrder }) => stackOrder)).toEqual([9, 18])
    expect(stampNewPendingSpells({ before: result, after: result, roomVersion: 18 })).toBe(result)
  })
})
