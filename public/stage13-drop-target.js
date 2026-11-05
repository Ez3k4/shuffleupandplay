/**
 * Stage 13 — determine where a hand card can be dropped.
 * This only checks the destination. playFromHand remains server-authoritative;
 * dropping on an opponent's board never transfers control of the card.
 */
export function findStage13DropTarget(game, x, y, hit = document.elementFromPoint(x, y)) {
  const battlefield = hit?.closest?.('.player-section .battlefield')
  if (battlefield && game.contains(battlefield)) return battlefield

  // Fixed utility/Commander/Planeswalker overlays may cover the battlefield
  // while living outside its DOM subtree. Accept the same physical rectangle.
  const seat = hit?.closest?.('.player-section')
  const seatField = seat?.querySelector?.('.battlefield')
  if (seatField && game.contains(seatField)) {
    const r = seatField.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return seatField
  }

  const board = game.querySelector('#players-area')
  if (!board) return null
  const spellOverlay = hit?.closest?.('.stage12-shared-spell-stack')
  if (spellOverlay && board.contains(spellOverlay) && !spellOverlay.hidden) return spellOverlay

  // The spell overlay is hidden before the first spell is cast. Accept drops
  // in the same central region even when it contains no pending spell.
  const r = board.getBoundingClientRect()
  const halfWidth = Math.min(r.width * 0.42, 350)
  const halfHeight = Math.min(r.height * 0.08, 90)
  const centerX = r.left + r.width / 2
  const centerY = r.top + r.height / 2
  if (x >= centerX - halfWidth && x <= centerX + halfWidth &&
      y >= centerY - halfHeight && y <= centerY + halfHeight) return board
  return null
}
