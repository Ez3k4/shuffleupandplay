// @vitest-environment happy-dom
// Stage 12 regression tests: run with `pnpm exec vitest run test/stage12-*.test.js`.
// No network or real card artwork is needed. These assertions cover DOM
// placement and the action data that the existing delegated handlers use.
import { describe, expect, test } from 'vitest'
import { buildPlayer } from '../src/game/player.ts'
import { roomPayload } from '../src/game/room-snapshot.ts'
import { renderComponent } from '../src/server/render/components.ts'

function createCard(id, name, typeLine, options = {}) {
  return {
    instanceId: id, name, typeLine, scryfallId: id,
    imageUrl: `https://example.org/${id}.jpg`,
    tapped: false, isManaSource: false,
    isLand: /\bLand\b/i.test(typeLine),
    isUtilityPermanent: /\b(?:Artifact|Enchantment)\b/i.test(typeLine) &&
      !/\b(?:Aura|Equipment|Creature|Planeswalker)\b/i.test(typeLine),
    isAttachment: /\b(?:Aura|Equipment)\b/i.test(typeLine),
    x: 200, y: 160, counters: [], ...options,
  }
}

function playerMarkup({ cards = [], exile = [], spells = [], isOwner = true }) {
  const a = buildPlayer({ name: 'Alice', seat: 1, identifier: 'p1', sessionId: 's1' })
  const b = buildPlayer({ name: 'Bob', seat: 2, identifier: 'p2', sessionId: 's2' })
  a.deckStatus = 'loaded'
  a.battlefield = cards
  a.exile = exile
  a.pendingSpells = spells
  const room = {
    id: 'room1', code: 'ABC123', name: 'Table', version: 1,
    createdAt: '2026-11-05', updatedAt: '2026-11-05', players: [a, b],
  }
  const payload = roomPayload({ room, sessionId: isOwner ? 's1' : 's2' })
  const markup = renderComponent({ name: 'player', key: '1', context: {
    payload, roomCode: 'ABC123', seat: isOwner ? 1 : 2,
    shareUrl: 'https://example.org/tables/ABC123',
  } })
  const root = document.createElement('div')
  root.innerHTML = markup
  return root
}

const idList = (node) => [...node?.querySelectorAll('.battlefield-card[data-instance-id]') ?? []]
  .map((card) => card.dataset.instanceId)

const land = createCard('land', 'Island', 'Basic Land — Island')
const artifact = createCard('artifact', 'Sol Ring', 'Artifact')
const enchantment = createCard('enchant', 'Rhystic Study', 'Enchantment')
const equipment = createCard('equip', 'Swiftfoot Boots', 'Artifact — Equipment')
const aura = createCard('aura', 'Pacifism', 'Enchantment — Aura')
const creature = createCard('creature', 'Llanowar Elves', 'Creature — Elf Druid')
const walker = createCard('walker', 'Jace', 'Legendary Planeswalker — Jace')
const spell = createCard('instant', 'Lightning Bolt', 'Instant')

describe('Stage 12 battlefield placement', () => {
  test('lands stay left; utilities move beside library; walkers go next to Commander', () => {
    const root = playerMarkup({ cards: [land, artifact, enchantment, equipment, aura, creature, walker] })
    const canvas = root.querySelector('.battlefield-canvas')
    expect(idList(canvas.querySelector('.compact-special-lanes'))).toEqual(['land'])
    expect(idList(root.querySelector('.stage12-utility-area'))).toEqual(['artifact', 'enchant'])
    expect(idList(root.querySelector('.stage12-planeswalker-area'))).toEqual(['walker'])
    expect(root.querySelector('.stage10-command-zone')).not.toBeNull()
    expect(idList(canvas).filter((id) => !['land'].includes(id)))
      .toEqual(expect.arrayContaining(['equip','aura','creature']))
    // Utility and walker overlays must be siblings of the battlefield,
    // not inside its scrolling canvas.
    expect(root.querySelector('.stage12-utility-area').parentElement.classList.contains('player-section')).toBe(true)
    expect(root.querySelector('.stage12-planeswalker-area').parentElement.classList.contains('player-section')).toBe(true)
  })

  test('empty fixed areas are not rendered', () => {
    const root = playerMarkup({ cards: [creature] })
    expect(root.querySelector('.compact-special-lanes')).toBeNull()
    expect(root.querySelector('.stage12-utility-area')).toBeNull()
    expect(root.querySelector('.stage12-planeswalker-area')).toBeNull()
  })

  test('a planeswalker with an attached Aura stays on main board', () => {
    const attachedAura = createCard('auraOnWalker', 'Oath', 'Enchantment — Aura', { attachedTo: 'walker' })
    const root = playerMarkup({ cards: [walker, attachedAura] })
    expect(root.querySelector('.stage12-planeswalker-area')).toBeNull()
    expect(idList(root.querySelector('.battlefield-canvas'))).toEqual(['walker', 'auraOnWalker'])
  })

  test('owner and opponent can open the small Exile button and see the search source', () => {
    for (const isOwner of [true, false]) {
      const root = playerMarkup({ exile: [createCard('banished', 'Banished Card', 'Instant')], isOwner })
      const button = root.querySelector('.stage12-exile-button[data-open-zone="exile"]')
      expect(button).not.toBeNull()
      expect(button.querySelector('.stage12-exile-count').textContent).toBe('Exile 1')
      expect(button.querySelector('img')).toBeNull()
      expect(root.querySelector('.stage12-exile-lane .zone-source').children).toHaveLength(1)
      expect(root.querySelector('.zone-lane[data-zone="graveyard"] .zone-preview')).not.toBeNull()
      expect(root.querySelector('.library-zone-preview')).not.toBeNull()
    }
  })

  test('both seats see pending spells; only the owner receives Resolve', () => {
    const own = playerMarkup({ spells: [spell], isOwner: true })
    const other = playerMarkup({ spells: [spell], isOwner: false })
    expect(own.querySelector('.stage11-spell-area')).not.toBeNull()
    expect(other.querySelector('.stage11-spell-area')).not.toBeNull()
    expect(own.querySelector('[data-game-action*="resolveSpell"]')).not.toBeNull()
    expect(other.querySelector('[data-game-action*="resolveSpell"]')).toBeNull()
    expect(own.querySelector('.stage11-spell-card img').getAttribute('alt')).toBe('Lightning Bolt')
  })
})
