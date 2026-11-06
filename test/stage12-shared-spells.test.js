// @vitest-environment happy-dom
// The overlay is a view over the persisted, globally ordered pending spells.
import { afterEach, describe, expect, test } from 'vitest'
import { mountStage12SpellOverlay, syncStage12SpellOverlay } from '../public/stage12-spells.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
let cleanup = () => {}
afterEach(() => { cleanup(); cleanup = () => {}; document.body.innerHTML = '' })

function setup() {
  document.body.innerHTML = `<main data-game><div id="players-area">
    <section class="player-section" data-player-id="p1">
      <div class="zone-summary-player"><strong>Alice</strong></div>
      <aside class="stage11-spell-area"><div class="stage11-spell-heading">On the stack</div>
        <div class="stage11-spell-cards"><div class="stage11-spell-card" data-instance-id="bolt" data-stack-order="25">
          <img alt="Bolt"><span class="stage11-spell-name">Bolt</span><button data-game-action='{"type":"resolveSpell","instanceId":"bolt"}'>Resolve</button>
        </div></div>
      </aside>
    </section>
    <section class="player-section" data-player-id="p2">
      <div class="zone-summary-player"><strong>Bob</strong></div>
      <aside class="stage11-spell-area"><div class="stage11-spell-heading">On the stack</div>
        <div class="stage11-spell-cards"><div class="stage11-spell-card" data-instance-id="counterspell" data-stack-order="28">
          <img alt="Counterspell"><span class="stage11-spell-name">Counterspell</span><span class="stage11-awaiting">Waiting for player</span>
        </div></div>
      </aside>
    </section>
  </div></main>`
  const game = document.querySelector('[data-game]')
  const board = game.querySelector('#players-area')
  return { game, board }
}

const entries = (root) => [...root.querySelectorAll('.stage25-stack-entry')]

describe('Stage 25 shared stack DOM overlay', () => {
  test('sorts across both seats; newest spell is TOP, old originals stay intact', () => {
    const { game, board } = setup()
    cleanup = mountStage12SpellOverlay(game)
    const overlay = board.querySelector(':scope > .stage12-shared-spell-stack')
    expect(overlay.hidden).toBe(false)
    expect(entries(overlay).map((entry) => entry.dataset.instanceId)).toEqual(['bolt', 'counterspell'])
    expect(overlay.querySelector('.stage25-stack-top').dataset.instanceId).toBe('counterspell')
    expect(overlay.textContent).toContain('Last cast on top')
    expect(board.querySelectorAll('.player-section .stage11-spell-area')).toHaveLength(2)
    expect(overlay.querySelectorAll('[data-game-action]')).toHaveLength(1)
  })

  test('keeps delegated action on cloned Resolve buttons', () => {
    const { game } = setup()
    cleanup = mountStage12SpellOverlay(game)
    let received = null
    game.addEventListener('click', (event) => {
      const button = event.target.closest('[data-game-action]')
      if (button) received = JSON.parse(button.dataset.gameAction)
    })
    game.querySelector('.stage12-shared-spell-stack [data-game-action]').click()
    expect(received).toEqual({ type: 'resolveSpell', instanceId: 'bolt' })
  })

  test('preserves existing card animation state after unrelated refresh', () => {
    const { game, board } = setup()
    cleanup = mountStage12SpellOverlay(game)
    const overlay = board.querySelector('.stage12-shared-spell-stack')
    expect(overlay.querySelectorAll('.stage25-stack-entering')).toHaveLength(2)
    expect(syncStage12SpellOverlay(board, overlay)).toBe(2)
    expect(overlay.querySelectorAll('.stage25-stack-entering')).toHaveLength(0)
  })

  test('falls back explicitly for legacy saved spells without a known order', () => {
    const { game, board } = setup()
    for (const spell of board.querySelectorAll('.stage11-spell-card')) spell.removeAttribute('data-stack-order')
    cleanup = mountStage12SpellOverlay(game)
    const overlay = board.querySelector('.stage12-shared-spell-stack')
    expect(overlay.textContent).toContain('unknown cross-player order')
    expect(overlay.querySelector('.stage25-stack-top')).toBeNull()
  })

  test('rebuilds after server refresh and hides when all spells resolve', async () => {
    const { game, board } = setup()
    cleanup = mountStage12SpellOverlay(game)
    for (const original of board.querySelectorAll('.player-section .stage11-spell-area')) original.remove()
    await tick()
    const overlay = board.querySelector('.stage12-shared-spell-stack')
    expect(overlay.hidden).toBe(true)
    expect(overlay.children).toHaveLength(0)
    const alice = board.querySelector('[data-player-id="p1"]')
    alice.insertAdjacentHTML('beforeend', `<aside class="stage11-spell-area"><div class="stage11-spell-heading">On the stack</div><div class="stage11-spell-card" data-instance-id="new" data-stack-order="30"><span class="stage11-spell-name">New spell</span></div></aside>`)
    await tick()
    expect(overlay.hidden).toBe(false)
    expect(overlay.textContent).toContain('New spell')
    expect(syncStage12SpellOverlay(board, overlay)).toBe(1)
    expect(overlay.querySelector('.stage25-stack-top').dataset.instanceId).toBe('new')
  })
})
