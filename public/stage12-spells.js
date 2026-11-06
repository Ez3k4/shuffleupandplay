/**
 * Stage 25 — shared, order-aware pending-spell visualization.
 *
 * Originals remain inside server-rendered player components (hidden via CSS).
 * The overlay CLONES their cards and existing delegated Resolve buttons.
 * A cast's global room version persists in Card.stackOrder so the last cast
 * spell really is marked TOP, even after a browser refresh or reconnect.
 * Older pending spells without an order are shown before ordered spells; if
 * none has ordering, the UI makes no unsupported claim about the top card.
 */

export function syncStage12SpellOverlay(board, overlay) {
  const existing = new Set([...overlay.querySelectorAll('.stage25-stack-entry')]
    .map((item) => `${item.dataset.stackOwner}:${item.dataset.instanceId}`))
  const entries = [...board.querySelectorAll('.player-section .stage11-spell-area')]
    .flatMap((original) => {
      const owner = original.closest('.player-section')
      const playerId = owner?.dataset.playerId ?? ''
      const ownerName = owner?.querySelector('.zone-summary-player strong')?.textContent?.trim() ?? 'Player'
      return [...original.querySelectorAll('.stage11-spell-card')].map((card, index) => {
        const orderValue = Number(card.dataset.stackOrder)
        const knownOrder = card.hasAttribute('data-stack-order') && Number.isSafeInteger(orderValue)
        return { card, playerId, ownerName, knownOrder, order: knownOrder ? orderValue : 0, index }
      })
    })
  // The server assigns a unique room-version order to new casts. A stable
  // fallback preserves legacy cards (pre-Stage25); cross-seat legacy order
  // cannot be reliably inferred, and is explicitly labelled unknown.
  entries.sort((a, b) =>
    Number(a.knownOrder) - Number(b.knownOrder) ||
    (a.knownOrder ? a.order - b.order : 0))

  if (entries.length === 0) {
    overlay.replaceChildren()
    overlay.hidden = true
    return 0
  }

  const heading = document.createElement('div')
  heading.className = 'stage25-stack-heading'
  const title = document.createElement('strong')
  title.textContent = `THE STACK · ${entries.length} spell${entries.length === 1 ? '' : 's'}`
  const explanation = document.createElement('span')
  const hasLegacy = entries.some((entry) => !entry.knownOrder)
  explanation.textContent = hasLegacy
    ? 'Older spells have unknown cross-player order · resolve manually'
    : 'Last cast on top · resolve top first'
  heading.append(title, explanation)

  const track = document.createElement('div')
  track.className = 'stage25-stack-track'
  track.setAttribute('aria-label', 'Pending spells, ordered from bottom to top')
  const topIsKnown = entries.at(-1)?.knownOrder === true
  entries.forEach((entry, index) => {
    const shell = document.createElement('div')
    shell.className = 'stage25-stack-entry'
    shell.dataset.stackOwner = entry.playerId
    shell.dataset.instanceId = entry.card.dataset.instanceId ?? ''
    shell.style.setProperty('--stage25-stack-index', String(index))
    if (!existing.has(`${entry.playerId}:${shell.dataset.instanceId}`)) {
      shell.classList.add('stage25-stack-entering')
    }
    const top = index === entries.length - 1 && topIsKnown
    const tag = document.createElement('span')
    tag.className = 'stage25-stack-position'
    tag.textContent = top ? 'TOP · resolve next' : entry.knownOrder ? `#${index + 1} · below` : 'Order unknown'
    if (top) {
      shell.classList.add('stage25-stack-top')
      shell.setAttribute('aria-label', `${entry.ownerName}'s ${entry.card.querySelector('.stage11-spell-name')?.textContent ?? 'spell'} is on top of the stack`)
    }
    const owner = document.createElement('span')
    owner.className = 'stage25-stack-owner'
    owner.textContent = entry.ownerName
    const spell = entry.card.cloneNode(true)
    shell.append(tag, spell, owner)
    track.append(shell)
  })
  overlay.replaceChildren(heading, track)
  overlay.hidden = false
  return entries.length
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
    // Replacing clones causes its own mutations. Observe server originals only.
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
