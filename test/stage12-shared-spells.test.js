// @vitest-environment happy-dom
// Verifies the shared display is only a DOM portal and never changes actions
// or reveals an opponent-only Resolve button.
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
        <div class="stage11-spell-cards"><div class="stage11-spell-card">
          <img alt="Bolt"><button data-game-action='{"type":"resolveSpell","instanceId":"bolt"}'>Resolve</button>
        </div></div>
      </aside>
    </section>
    <section class="player-section" data-player-id="p2">
      <div class="zone-summary-player"><strong>Bob</strong></div>
      <aside class="stage11-spell-area"><div class="stage11-spell-heading">On the stack</div>
        <div class="stage11-spell-cards"><div class="stage11-spell-card">
          <img alt="Counterspell"><span class="stage11-awaiting">Waiting for player</span>
        </div></div>
      </aside>
    </section>
  </div></main>`
  const game = document.querySelector('[data-game]')
  const board = game.querySelector('#players-area')
  return { game, board }
}

describe('Stage 12 shared stack DOM overlay', () => {
  test('clones both seats at the divider while preserving original server markup', () => {
    const { game, board } = setup()
    cleanup = mountStage12SpellOverlay(game)
    const overlay = board.querySelector(':scope > .stage12-shared-spell-stack')
    expect(overlay.hidden).toBe(false)
    expect(overlay.querySelectorAll('.stage12-spell-copy')).toHaveLength(2)
    expect(board.querySelectorAll('.player-section .stage11-spell-area')).toHaveLength(2)
    expect(overlay.textContent).toContain('Alice · on the stack')
    expect(overlay.textContent).toContain('Bob · on the stack')
    expect(overlay.querySelectorAll('[data-game-action]')).toHaveLength(1)
  })

  test('keeps the existing delegated action on cloned Resolve buttons', () => {
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

  test('rebuilds after server-side player refresh and hides when all spells resolve', async () => {
    const { game, board } = setup()
    cleanup = mountStage12SpellOverlay(game)
    for (const original of board.querySelectorAll('.player-section .stage11-spell-area')) original.remove()
    await tick()
    const overlay = board.querySelector('.stage12-shared-spell-stack')
    expect(overlay.hidden).toBe(true)
    expect(overlay.children).toHaveLength(0)
    const alice = board.querySelector('[data-player-id="p1"]')
    alice.insertAdjacentHTML('beforeend', `<aside class="stage11-spell-area"><div class="stage11-spell-heading">On the stack</div><span>New spell</span></aside>`)
    await tick()
    expect(overlay.hidden).toBe(false)
    expect(overlay.textContent).toContain('New spell')
    expect(syncStage12SpellOverlay(board, overlay)).toBe(1)
  })
})
