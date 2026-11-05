/**
 * Stage 12 — shared pending-spell presentation.
 *
 * Every pending spell is persisted by GameRoom and rendered in its owning
 * player component. We CLONE (never relocate) those server-rendered panels
 * into one overlay centered across the two seats. The originals stay in place
 * (but visually hidden), so Solid Objects can continue morphing them on
 * WebSocket updates. Cloned Resolve buttons retain their existing delegated
 * data-game-action and original server-side ownership checks.
 *
 * Nothing in this module changes game state or the underlying MTG zones.
 */

export function syncStage12SpellOverlay(board, overlay) {
  const originals = [...board.querySelectorAll('.player-section .stage11-spell-area')]
  const panels = originals.map((original) => {
    const copy = original.cloneNode(true)
    const player = original.closest('.player-section')
    copy.classList.add('stage12-spell-copy')
    copy.dataset.playerId = player?.dataset.playerId ?? ''
    const ownerName = player?.querySelector('.zone-summary-player strong')?.textContent?.trim()
    const heading = copy.querySelector('.stage11-spell-heading')
    if (ownerName && heading) heading.textContent = `${ownerName} · on the stack`
    return copy
  })
  overlay.replaceChildren(...panels)
  overlay.hidden = panels.length === 0
  return panels.length
}

export function mountStage12SpellOverlay(game) {
  const board = game.querySelector('#players-area')
  if (!board) return () => {}
  let overlay = board.querySelector(':scope > .stage12-shared-spell-stack')
  if (overlay) return () => {}
  overlay = document.createElement('div')
  overlay.className = 'stage12-shared-spell-stack'
  overlay.setAttribute('aria-label', 'Pending spells between both battlefields')
  overlay.hidden = true
  board.append(overlay)

  let scheduled = false
  const refresh = () => syncStage12SpellOverlay(board, overlay)
  const observer = new MutationObserver((mutations) => {
    // Replacing overlay clones causes its own mutations: ignore those to
    // prevent observer loops. Only server-updated player DOM should re-sync.
    if (!mutations.some((mutation) => mutation.target !== overlay && !overlay.contains(mutation.target))) return
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      refresh()
    })
  })
  observer.observe(board, { childList: true, subtree: true, characterData: true })
  refresh()
  return () => { observer.disconnect(); overlay.remove() }
}
