#!/usr/bin/env python3
"""Stage 7: visual land lane with per-instance land stacks.

Apply from the project root after Stages 1-6:
    python3 install_stage7.py --check
    python3 install_stage7.py
    python3 install_stage7.py --undo

No action schema changes. The land flag is optional for backward compatibility;
old imported decks need re-importing for accurate nonbasic-land classification.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

BACKUP = Path('stage7-backup')
FILES = [
    Path('src/game/types.ts'),
    Path('src/game/player.ts'),
    Path('src/archidekt/client.ts'),
    Path('src/server/render/components.ts'),
    Path('public/shuffle.js'),
    Path('public/application.css'),
]
MARKER = '/* ===== Stage 7: fixed, stacked land lane ===== */'

STYLE = r'''/* ===== Stage 7: fixed, stacked land lane ===== */
/*
 * Lands stay as independent battlefield cards, but render in a compact,
 * position-independent row. Opponent's lands are displayed on their board,
 * with no actionable controls for the viewing player.
 *
 * Leave the existing nonland battlefield canvas and Stage 6 normalized
 * positions intact. The land zone is an overlay, not a new server zone.
 */
#players-area .battlefield-canvas {
  --stage7-land-width: 76px;
  --stage7-land-height: 107px;
}

#players-area .stage7-land-zone {
  position: absolute;
  z-index: 25;
  left: 0.55rem;
  display: flex;
  flex-direction: column;
  width: max-content;
  max-width: calc(100% - var(--tabletop-pile-reserve, 330px) - 0.8rem);
  gap: 0.2rem;
  padding: 0.3rem 0.45rem 0.4rem;
  border: 1px solid rgba(215, 195, 151, 0.36);
  border-radius: 10px;
  background: rgba(10, 31, 25, 0.80);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(3px);
}

#players-area .your-seat .stage7-land-zone {
  bottom: calc(var(--hand-peek-height, 48px) + 0.55rem);
}

/* Opponent sits opposite you: their lands are closest to their top edge. */
#players-area .opponent-seat .stage7-land-zone {
  top: 2.5rem;
}

#players-area .stage7-land-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  color: #dbe8d4;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.03em;
}

#players-area .stage7-land-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-start;
  gap: 0.38rem;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  padding: 0.2rem 0.4rem 0.3rem 0.1rem;
}

/* A stack occupies roughly one small card's width, regardless of copies. */
#players-area .stage7-land-stack {
  position: relative;
  flex: 0 0 var(--stage7-land-width);
  width: var(--stage7-land-width);
  height: var(--stage7-land-height);
  min-width: 0;
  isolation: isolate;
}

#players-area .stage7-land-stack:focus-within,
#players-area .stage7-land-stack:hover {
  z-index: 30;
}

#players-area .stage7-land-card.battlefield-card {
  position: absolute;
  top: calc(var(--stage7-stack-index) * 2px);
  left: calc(var(--stage7-stack-index) * 3px);
  width: 66px;
  height: 94px;
  border-radius: 6px;
  cursor: pointer;
  touch-action: auto;
  box-shadow: 1px 2px 0 #4b544b, 0 5px 10px rgba(0,0,0,0.4);
}

#players-area .stage7-land-card.battlefield-card img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* The tapped card remains individually identifiable within the stack. */
#players-area .stage7-land-card.battlefield-card.tapped {
  border-color: #e6be70;
  filter: brightness(0.73);
  transform: rotate(8deg);
}

/* Expand a stack horizontally on hover/focus to reach each distinct card. */
#players-area .stage7-land-stack:hover .stage7-land-card,
#players-area .stage7-land-stack:focus-within .stage7-land-card {
  left: calc(var(--stage7-stack-index) * 15px);
}

#players-area .stage7-land-count {
  position: absolute;
  z-index: 15;
  right: -0.2rem;
  bottom: 0;
  padding: 0.15rem 0.36rem;
  border: 1px solid rgba(239, 218, 167, 0.68);
  border-radius: 999px;
  background: #14281f;
  color: #f4eedb;
  font-size: 0.69rem;
  font-weight: 700;
  pointer-events: none;
  white-space: nowrap;
}

/* Right-click tools remain attached to the actual card instance. */
#players-area .stage7-land-card.card-tools-open {
  overflow: visible;
  z-index: 40;
}
#players-area .stage7-land-card.card-tools-open > .card-tools {
  display: grid;
  bottom: 100%;
  top: auto;
  left: 0;
  z-index: 45;
}

/* The land context menu lives outside the scrollable battlefield, so no
 * right-click actions are clipped by the compact lane. */
.stage7-land-menu {
  position: fixed;
  z-index: 12000;
  width: 212px;
  padding: 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: #19252a;
  box-shadow: 0 12px 34px rgba(0,0,0,0.67);
}
.stage7-land-menu[hidden] { display: none !important; }
.stage7-land-menu strong { padding: 0.25rem 0.3rem; font-size: 0.85rem; }
.stage7-land-menu label { display: grid; gap: 0.2rem; font-size: 0.75rem; color: #e5dbc8; }
.stage7-land-menu select { padding: 0.3rem; max-width: 100%; }
.stage7-land-menu button {
  display: block;
  border: 0;
  padding: 0.4rem 0.55rem;
  border-radius: 6px;
  background: transparent;
  box-shadow: none;
  color: #f1e9d6;
  text-align: left;
  font-size: 0.84rem;
}
.stage7-land-menu button:hover { background: rgba(196,156,75,0.2); }

@media (max-width: 700px) {
  #players-area .battlefield-canvas {
    --stage7-land-width: 58px;
    --stage7-land-height: 88px;
  }
  #players-area .stage7-land-zone {
    gap: 0.12rem;
    padding: 0.22rem;
    left: 0.3rem;
  }
  #players-area .stage7-land-card.battlefield-card {
    width: 49px;
    height: 69px;
  }
  #players-area .opponent-seat .stage7-land-zone {
    top: 2.15rem;
  }
}
'''

JS_ADDITIONS = r'''
// ===== Stage 7: land-stack interaction without a new rules engine =====
// The individual copies retain their original instanceIds in game state.
// Click a copy to tap/untap. Right-click a stack to select a particular
// copy for the original move/tap/counter actions. Fixed stacks do not drag.
function wireLandStackTap(actorId) {
  const menu = document.createElement('div')
  menu.className = 'stage7-land-menu'
  menu.hidden = true
  menu.innerHTML = `
    <strong class="stage7-land-menu-title">Land actions</strong>
    <label>Copy <select class="stage7-land-select"></select></label>
    <button type="button" data-land-choice="tap">Tap / Untap</button>
    <button type="button" data-land-choice="hand">Move to hand</button>
    <button type="button" data-land-choice="graveyard">Move to graveyard</button>
    <button type="button" data-land-choice="exile">Move to exile</button>
    <button type="button" data-land-choice="library">Shuffle into library</button>
    <button type="button" data-land-choice="counter">Add +1/+1 counter</button>
  `
  document.body.append(menu)
  const selected = menu.querySelector('.stage7-land-select')
  let menuOpen = false

  function closeMenu() {
    menu.hidden = true
    menuOpen = false
  }

  document.addEventListener('click', (event) => {
    if (menuOpen && !menu.contains(event.target)) closeMenu()
    const card = event.target.closest?.('.stage7-land-card')
    if (!card || event.target.closest('.card-tools, .counter-chip, button')) return
    if (card.closest('.player-section')?.dataset.currentPlayer !== 'true') return
    event.preventDefault()
    void sendAction(actorId, { type: 'toggleTap', instanceId: card.dataset.instanceId })
  })

  // Capture right-click before the generic battlefield tool handler.
  document.addEventListener('contextmenu', (event) => {
    const card = event.target.closest?.('.stage7-land-card')
    if (!card || card.closest('.player-section')?.dataset.currentPlayer !== 'true') return
    event.preventDefault()
    event.stopImmediatePropagation()
    const stack = card.closest('.stage7-land-stack')
    const copies = [...stack.querySelectorAll('.stage7-land-card')]
    selected.replaceChildren(...copies.map((copy, i) => {
      const state = copy.classList.contains('tapped') ? 'tapped' : 'untapped'
      return new Option(`Copy ${i + 1} (${state})`, copy.dataset.instanceId)
    }))
    selected.value = card.dataset.instanceId
    menu.querySelector('.stage7-land-menu-title').textContent = card.dataset.previewName ?? 'Land actions'
    menu.hidden = false
    menuOpen = true
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`
  }, true)

  menu.addEventListener('click', (event) => {
    const choice = event.target.closest?.('[data-land-choice]')?.dataset.landChoice
    if (!choice || !selected.value) return
    const instanceId = selected.value
    const action = choice === 'tap' ? { type: 'toggleTap', instanceId }
      : choice === 'library' ? { type: 'moveToDeck', instanceId, from: 'battlefield', position: 'shuffle' }
      : choice === 'counter' ? { type: 'addCounter', instanceId, x: 8, y: 8, label: '+1/+1' }
      : { type: 'moveCardZone', instanceId, from: 'battlefield', to: choice }
    closeMenu()
    void sendAction(actorId, action)
  })
  document.addEventListener('pointerdown', (event) => {
    if (menuOpen && !menu.contains(event.target) && !event.target.closest?.('.stage7-land-card')) closeMenu()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu()
  })
  window.addEventListener('scroll', closeMenu, true)
}

// Reject drops behind the floating land lane, just like Stage 3 does for piles.
function cardOverlapsLandZone(card) {
  const zone = card.closest('.player-section')?.querySelector('.stage7-land-zone')
  if (!zone) return false
  const a = card.getBoundingClientRect()
  const b = zone.getBoundingClientRect()
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}
'''

def sha(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f'{label}: expected one anchor, found {count}; nothing changed')
    return source.replace(old, new, 1)


def patch(files: dict[Path, str]) -> dict[Path, str]:
    types = files[Path('src/game/types.ts')]
    player = files[Path('src/game/player.ts')]
    client = files[Path('src/archidekt/client.ts')]
    ts = files[Path('src/server/render/components.ts')]
    js = files[Path('public/shuffle.js')]
    css = files[Path('public/application.css')]

    if MARKER in css or 'function wireLandStackTap(' in js:
        raise ValueError('Stage 7 appears installed already')
    if '/* ===== Stage 6: normalized card positions and life beside name ===== */' not in css:
        raise ValueError('Stage 6 CSS marker missing; install earlier stages first')
    if 'function tabletopLogicalPosition(' not in js:
        raise ValueError('Stage 6 JavaScript marker missing')
    if 'function renderBattlefieldCard(' not in ts:
        raise ValueError('Battlefield renderer not found')
    if 'function expandCard(' not in client:
        raise ValueError('Expected Archidekt deck importer not found')

    types = replace_once(
        types,
        '  isManaSource: boolean\n',
        '  isManaSource: boolean\n  /** Visible face is a land. Optional for saved decks created before Stage 7. */\n  isLand?: boolean\n',
        'Card land metadata',
    )

    # The original domain deliberately reconstructs card fields when cards
    # change zones; preserve isLand there or the flag disappears on play.
    player = replace_once(
        player,
        '    isManaSource: card.isManaSource,',
        '    isManaSource: card.isManaSource,\n    isLand: card.isLand,',
        'deckCard land field propagation',
    )

    client = replace_once(
        client,
        '    isManaSource: isManaSource(oracleCard),',
        '    isManaSource: isManaSource(oracleCard),\n    isLand: /\\bLand\\b/i.test(stringValue(oracleCard?.typeLine, "").split("//")[0] ?? ""),',
        'Archidekt card classification',
    )

    # Only modify the existing battlefield renderer. Cards remaining on the
    # normal canvas keep Stage 6 logical coordinate conversion unchanged.
    body_start = ts.index('function renderBattlefield(options:')
    body_end = ts.index('function renderBattlefieldCard(', body_start)
    old_body = ts[body_start:body_end]
    expected = '''  const cards = options.player.battlefield
    .map((card) => renderBattlefieldCard({ card, isCurrentPlayer: options.isCurrentPlayer }))
    .join("")

  return `<div class="battlefield"><div class="battlefield-canvas" data-battlefield-player-id="${attribute(options.player.id)}">${cards}</div></div>`'''
    replacement = '''  const cards = options.player.battlefield
    .filter((card) => !isLandCard(card))
    .map((card) => renderBattlefieldCard({ card, isCurrentPlayer: options.isCurrentPlayer }))
    .join("")
  const lands = renderLandZone(options)

  return `<div class="battlefield"><div class="battlefield-canvas" data-battlefield-player-id="${attribute(options.player.id)}">${cards}${lands}</div></div>`'''
    if old_body.count(expected) != 1:
        raise ValueError('Customized renderBattlefield() differs from upstream template')
    ts = ts[:body_start] + old_body.replace(expected, replacement, 1) + ts[body_end:]

    # A land uses the same existing per-card HTML and tools; only its physical
    # x/y style is replaced with an index used by the stack layout.
    ts = replace_once(
        ts,
        '  card: PublicBattlefieldCard\n  isCurrentPlayer: boolean\n}): string {',
        '  card: PublicBattlefieldCard\n  isCurrentPlayer: boolean\n  landStackIndex?: number\n}): string {',
        'Land renderer option',
    )
    original_inline = '  return `<div class="battlefield-card${card.tapped ? " tapped" : ""}" data-instance-id="${attribute(card.instanceId)}" ${previewAttributes(card)} style="left:calc(var(--tabletop-travel-x) * ${card.x / 1200});top:calc(var(--tabletop-travel-y) * ${card.y / 700})">'
    replacement_inline = '''  const isLandStackCard = options.landStackIndex !== undefined
  const position = isLandStackCard
    ? `--stage7-stack-index:${options.landStackIndex}`
    : `left:calc(var(--tabletop-travel-x) * ${card.x / 1200});top:calc(var(--tabletop-travel-y) * ${card.y / 700})`
  const landClass = isLandStackCard ? " stage7-land-card" : ""
  return `<div class="battlefield-card${card.tapped ? " tapped" : ""}${landClass}" data-instance-id="${attribute(card.instanceId)}" ${previewAttributes(card)} style="${position}">'''
    ts = replace_once(ts, original_inline, replacement_inline, 'Stage 6 permanent coordinate template')

    landmark = 'function renderCardTools(card: PublicBattlefieldCard): string {'
    if ts.count(landmark) != 1:
        raise ValueError('Card tools function missing or ambiguous')
    land_helpers = '''// Land is a subtype-independent card type, NOT the same as "produces mana".
// A non-land mana rock must remain on the ordinary battlefield.
function isLandCard(card: PublicBattlefieldCard): boolean {
  if (typeof card.isLand === "boolean") return card.isLand
  // Compatibility with old saved decks: basic lands are unambiguous by name.
  return /^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest|Wastes)$/i.test(card.name)
}

// Only the HTML layout is grouped. Every card keeps its instanceId, tap state,
// counters and independent move actions in the shared player.battlefield array.
function renderLandZone(options: {
  player: PublicPlayer
  isCurrentPlayer: boolean
}): string {
  const groups = new Map<string, PublicBattlefieldCard[]>()
  for (const card of options.player.battlefield) {
    if (!isLandCard(card)) continue
    const key = card.name.trim().toLocaleLowerCase("en")
    const group = groups.get(key) ?? []
    group.push(card)
    groups.set(key, group)
  }
  if (!groups.size) return ""

  const stacks = [...groups.values()].map((cards) => {
    // Render tapped copies at the back so untapped copies are easy to select.
    const sorted = [...cards].sort((a, b) => Number(b.tapped) - Number(a.tapped))
    const faces = sorted
      .map((card, index) => renderBattlefieldCard({
        card,
        isCurrentPlayer: options.isCurrentPlayer,
        landStackIndex: Math.min(index, 3),
      }))
      .join("")
    const tappedCount = cards.filter((card) => card.tapped).length
    return `<div class="stage7-land-stack" title="${attribute(cards[0]?.name ?? "Land")}" aria-label="${attribute(cards[0]?.name ?? "Land")}, ${cards.length} copies, ${tappedCount} tapped">
      ${faces}
      <span class="stage7-land-count">${tappedCount ? `${tappedCount}/` : ""}${cards.length}</span>
    </div>`
  }).join("")
  const total = [...groups.values()].reduce((sum, cards) => sum + cards.length, 0)
  return `<div class="stage7-land-zone" aria-label="Land area">
    <div class="stage7-land-title"><span>Lands</span><span>${total}</span></div>
    <div class="stage7-land-row">${stacks}</div>
  </div>`
}

'''
    ts = ts.replace(landmark, land_helpers + landmark, 1)

    js = replace_once(js, '  wireActions(game, actorId)\n', '  wireActions(game, actorId)\n  wireLandStackTap(actorId)\n', 'Land click handler startup')
    js = replace_once(
        js,
        'if (cardOverlapsPile(current.element)) {',
        'if (cardOverlapsPile(current.element) || cardOverlapsLandZone(current.element)) {',
        'Existing blocked-drop safety check',
    )
    drag_start = js.index('function beginDrag(')
    drag_end = js.index('function moveDrag(', drag_start)
    drag_func = js[drag_start:drag_end]
    if drag_func.count('function beginDrag(') != 1:
        raise ValueError('beginDrag is ambiguous')
    drag_func = drag_func.replace(
        'function beginDrag(event, game) {',
        'function beginDrag(event, game) {\n  // Land stacks are fixed UI objects; their copy is selected by clicking.\n  if (event.target.closest?.(".stage7-land-zone")) return',
        1,
    )
    js = js[:drag_start] + drag_func + js[drag_end:] + JS_ADDITIONS
    css = css.rstrip() + '\n\n' + STYLE

    return {
        Path('src/game/types.ts'): types,
        Path('src/game/player.ts'): player,
        Path('src/archidekt/client.ts'): client,
        Path('src/server/render/components.ts'): ts,
        Path('public/shuffle.js'): js,
        Path('public/application.css'): css,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true', help='Validate anchors without writing')
    modes.add_argument('--undo', action='store_true', help='Restore original files only if still unchanged')
    args = parser.parse_args()
    root = Path.cwd()
    paths = {rel: root / rel for rel in FILES}
    backup = root / BACKUP
    manifest = backup / 'manifest.json'

    if args.undo:
        if not manifest.is_file():
            sys.exit('ERROR: Stage 7 backup/manifest absent; no changes made.')
        saved = json.loads(manifest.read_text(encoding='utf-8'))
        for rel, path in paths.items():
            if not path.is_file() or sha(path.read_bytes()) != saved['installed'][str(rel)]:
                sys.exit(f'ERROR: {rel} changed since Stage 7. Refusing to overwrite; use Git or manual diff.')
        for rel, path in paths.items():
            shutil.copy2(backup / rel, path)
        print('Stage 7 restored from stage7-backup/. Rebuild your image.')
        return

    for rel, path in paths.items():
        if not path.is_file():
            sys.exit(f'ERROR: Missing {rel}. Run from ~/Games/shuffleupandplay.')
    originals = {rel: path.read_text(encoding='utf-8') for rel, path in paths.items()}
    try:
        updated = patch(originals)
    except ValueError as exc:
        sys.exit(f'ERROR: {exc}. No files changed.')

    node = shutil.which('node')
    if node:
        with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8') as output:
            output.write(updated[Path('public/shuffle.js')])
            candidate = Path(output.name)
        try:
            result = subprocess.run([node, '--check', str(candidate)], capture_output=True, text=True)
            if result.returncode:
                sys.exit('ERROR: JavaScript syntax check failed, no changes made:\n' + result.stderr)
        finally:
            candidate.unlink(missing_ok=True)

    if args.check:
        print('Stage 7 compatibility check passed. No files changed.')
        return
    if backup.exists():
        sys.exit('ERROR: stage7-backup/ already exists. Preserve it before retrying. No files changed.')
    backup.mkdir(parents=True)
    for rel, src in paths.items():
        dest = backup / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    try:
        for rel, src in paths.items():
            src.write_text(updated[rel], encoding='utf-8')
        manifest.write_text(json.dumps({
            'installed': {str(rel): sha(updated[rel].encode('utf-8')) for rel in FILES},
        }, indent=2) + '\n', encoding='utf-8')
    except Exception as exc:
        for rel, src in paths.items():
            shutil.copy2(backup / rel, src)
        sys.exit(f'ERROR: Install failed; original files restored: {exc}')

    print('Stage 7 installed. Original files saved in stage7-backup/.')
    print('Updated: game types, card copying, Archidekt import, battlefield render, client click handling, CSS.')
    print('Build: podman stop mtg-tabletop && podman build -t mtg-tabletop .')


if __name__ == '__main__':
    main()
