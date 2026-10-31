#!/usr/bin/env python3
"""Stage 8A: manual, persistent attachment of one of your battlefield cards to another.

Run from the customized project root:
  python3 install_stage8.py --check
  python3 install_stage8.py
  python3 install_stage8.py --undo

The installer checks specific anchors, creates backups, and writes all files only
when every check passes. It does not touch server storage or previous stages.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

FILES = [Path(p) for p in (
    'src/game/types.ts', 'src/game/action.ts', 'src/game/player.ts',
    'src/game/room-snapshot.ts', 'src/server/render/components.ts',
    'public/shuffle.js', 'public/application.css',
)]
BACKUP = Path('stage8-backup')
MARKER = '/* ===== Stage 8A: persistent manual attachments ===== */'

CSS = '''/* ===== Stage 8A: persistent manual attachments ===== */
/* Auras and Equipment remain real battlefield cards with independent IDs.
 * Their displayed position is offset from the host; detach keeps their most
 * recent host coordinates, so the permanent remains on the battlefield. */
#players-area .battlefield-canvas > .battlefield-card.stage8-attached {
  margin-left: 23px;
  margin-top: 31px;
  z-index: 2;
  border-color: #d6b477;
}
#players-area .battlefield-canvas > .battlefield-card.stage8-attachment-host {
  z-index: 3;
}
/* Do not hide normal moving permanents behind overlapping battlefield cards. */
#players-area .battlefield-canvas > .battlefield-card.is-dragging:not(.stage8-attached) {
  z-index: 1000 !important;
}
#players-area .battlefield-canvas > .battlefield-card.stage8-attached.is-dragging {
  z-index: 2 !important;
}
/* A selected attachment stays under its host while clicking to select its
 * target. Stage 8B will introduce a dedicated drag-and-hold attach gesture. */
#players-area .battlefield-canvas > .battlefield-card.stage8-attached:not(.is-dragging) {
  z-index: 2;
}
#players-area .stage8-attach-target {
  outline: 3px solid #d9bb79;
  outline-offset: 2px;
}
#players-area .stage8-attach-source {
  outline: 3px dashed #9fdaae;
  outline-offset: 3px;
}
#players-area .card-tools .stage8-tool {
  border-color: rgba(213, 188, 133, 0.7);
}
'''

JS = '''
// ===== Stage 8A: persistent attachment selection =====
// This is manual tabletop assistance rather than MTG targeting validation.
// Only cards you control can be targets in this first version.
function wireStage8Attachments(actorId) {
  let sourceId = null
  let sourceSeat = null

  function clearSelection() {
    sourceId = null
    sourceSeat = null
    document.querySelectorAll('.stage8-attach-source, .stage8-attach-target')
      .forEach((card) => card.classList.remove('stage8-attach-source', 'stage8-attach-target'))
  }

  document.addEventListener('click', (event) => {
    const start = event.target.closest?.('[data-stage8-attach-start]')
    if (start) {
      event.preventDefault()
      event.stopImmediatePropagation()
      clearSelection()
      const card = start.closest('.battlefield-card')
      if (!card || card.closest('.player-section')?.dataset.currentPlayer !== 'true') return
      sourceId = card.dataset.instanceId
      sourceSeat = card.closest('.player-section')
      card.classList.add('stage8-attach-source')
      sourceSeat.querySelectorAll('.battlefield-canvas > .battlefield-card')
        .forEach((candidate) => {
          if (candidate.dataset.instanceId !== sourceId &&
              !candidate.classList.contains('stage8-attached')) {
            candidate.classList.add('stage8-attach-target')
          }
        })
      showToast('Choose a permanent on your battlefield to attach to (Esc cancels).')
      return
    }

    const detach = event.target.closest?.('[data-stage8-detach]')
    if (detach) {
      event.preventDefault()
      event.stopImmediatePropagation()
      const card = detach.closest('.battlefield-card')
      if (card?.dataset.instanceId) {
        void sendAction(actorId, {
          type: 'setAttachment', instanceId: card.dataset.instanceId, targetInstanceId: null,
        })
      }
      clearSelection()
      return
    }

    if (!sourceId) return
    const target = event.target.closest?.('.battlefield-canvas > .battlefield-card')
    if (!target || !sourceSeat?.contains(target) || target.dataset.instanceId === sourceId) {
      // Outside click exits select-target mode, but allows other controls to work.
      if (!event.target.closest?.('.card-tools')) clearSelection()
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (target.classList.contains('stage8-attached')) return
    const targetInstanceId = target.dataset.instanceId
    const instanceId = sourceId
    clearSelection()
    void sendAction(actorId, { type: 'setAttachment', instanceId, targetInstanceId })
  }, true)

  // Suppress the ordinary tap-on-pointerup behavior while a target is picked.
  document.addEventListener('pointerdown', (event) => {
    if (!sourceId) return
    const target = event.target.closest?.('.battlefield-canvas > .battlefield-card')
    if (target && sourceSeat?.contains(target) && !event.target.closest('button')) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)
  document.addEventListener('keydown', (event) => {
    if (sourceId && event.key === 'Escape') clearSelection()
  })
}
'''


def replace_once(txt: str, old: str, new: str, what: str) -> str:
    count = txt.count(old)
    if count != 1:
        raise ValueError(f'{what}: expected exactly one anchor, found {count}')
    return txt.replace(old, new, 1)


def patch(items: dict[Path,str]) -> dict[Path,str]:
    t = items[Path('src/game/types.ts')]
    a = items[Path('src/game/action.ts')]
    p = items[Path('src/game/player.ts')]
    s = items[Path('src/game/room-snapshot.ts')]
    r = items[Path('src/server/render/components.ts')]
    j = items[Path('public/shuffle.js')]
    c = items[Path('public/application.css')]
    if MARKER in c or 'type: "setAttachment"' in a:
        raise ValueError('Stage 8 already present')
    if 'function renderLandZone(' not in r or 'function wireLandStackTap(' not in j:
        raise ValueError('Stage 7 land zone not found')
    if 'function tabletopLogicalPosition(' not in j:
        raise ValueError('Stage 6 normalized drag logic not found')

    # Store only on battlefield permanents, not on library/hand cards.
    t = replace_once(t, 'export type BattlefieldCard = Card & {',
        'export type BattlefieldCard = Card & {\n  attachedTo?: string', 'types: BattlefieldCard')
    t = replace_once(t, 'export type PublicBattlefieldCard = PublicCard & {',
        'export type PublicBattlefieldCard = PublicCard & {\n  attachedTo?: string', 'types: PublicBattlefieldCard')
    t = replace_once(t, 'export type CardFingerprint = {',
        'export type CardFingerprint = {\n  attachedTo?: string | null', 'types: CardFingerprint')

    a = replace_once(a, '  | { type: "toggleTap"; instanceId: string }',
        '  | { type: "toggleTap"; instanceId: string }\n  | { type: "setAttachment"; instanceId: string; targetInstanceId: string | null }',
        'action union')
    action_builder = '''  setAttachment: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    const targetInstanceId = attributes.targetInstanceId === null
      ? null : textIdentifier(attributes.targetInstanceId)
    if (!instanceId || (attributes.targetInstanceId !== null && !targetInstanceId)) return null
    return { type: "setAttachment", instanceId, targetInstanceId }
  },
'''
    a = replace_once(a, '  toggleTap: (attributes) => {', action_builder + '  toggleTap: (attributes) => {', 'action parser')

    p = replace_once(p,
        '    case "toggleTap":\n      return toggleTap({ player, instanceId: action.instanceId })',
        '    case "toggleTap":\n      return toggleTap({ player, instanceId: action.instanceId })\n    case "setAttachment":\n      return setAttachment({ player, instanceId: action.instanceId, targetInstanceId: action.targetInstanceId })',
        'player action switch')

    attachment_fn = '''// An attachment is a presentation relationship, not a separate zone.
// Only one player's own battlefield is supported in this first stage.
// Do not allow cycles, attachment-to-attachment, or attaching a card which
// already has something attached to it; those cases need deeper layout logic.
function setAttachment(options: {
  player: Player
  instanceId: string
  targetInstanceId: string | null
}): Player {
  const { player, instanceId, targetInstanceId } = options
  const source = player.battlefield.find((card) => card.instanceId === instanceId)
  if (!source) return player
  if (targetInstanceId === null) {
    return {
      ...player,
      battlefield: player.battlefield.map((card) => {
        if (card.instanceId !== instanceId) return card
        const { attachedTo: _attachedTo, ...detached } = card
        return detached
      }),
    }
  }
  const target = player.battlefield.find((card) => card.instanceId === targetInstanceId)
  if (!target || target.instanceId === source.instanceId || target.attachedTo ||
      player.battlefield.some((card) => card.attachedTo === source.instanceId)) return player
  return {
    ...player,
    battlefield: player.battlefield.map((card) => card.instanceId === instanceId
      ? { ...card, attachedTo: targetInstanceId, x: target.x, y: target.y } : card),
  }
}

'''
    p = replace_once(p, 'function toggleTap(options:', attachment_fn+'function toggleTap(options:', 'player attachment reducer')

    # For a drag, detach the dragged attachment. Moving a host carries its
    # attached cards because their saved normalized positions are synchronized.
    old_move = '''  const { player, instanceId } = options
  return {
    ...player,
    battlefield: player.battlefield.map((card) =>
      card.instanceId === instanceId
        ? { ...card, x: clamp(options.x, TABLE_RANGE.x), y: clamp(options.y, TABLE_RANGE.y) }
        : card,
    ),
  }
}'''
    new_move = '''  const { player, instanceId } = options
  const x = clamp(options.x, TABLE_RANGE.x)
  const y = clamp(options.y, TABLE_RANGE.y)
  return {
    ...player,
    battlefield: player.battlefield.map((card) => {
      if (card.instanceId === instanceId) {
        const { attachedTo: _attachedTo, ...detached } = card
        return { ...detached, x, y }
      }
      return card.attachedTo === instanceId ? { ...card, x, y } : card
    }),
  }
}'''
    start = p.index('function moveBattlefieldCard(')
    end = p.index('function moveCardBetweenZones(', start)
    chunk = p[start:end]
    if old_move not in chunk:
        raise ValueError('moveBattlefieldCard changed since base app; refusing to alter movement logic')
    p = p[:start] + chunk.replace(old_move,new_move,1) + p[end:]

    # Remove links when the host card leaves the battlefield, irrespective of
    # whether it enters the hand, library, graveyard, or exile.
    p = replace_once(p,
        '''    remainder: { ...player, [zone]: withoutCard({ cards: player[zone], instanceId }) },''',
        '''    remainder: {
      ...player,
      [zone]: withoutCard({ cards: player[zone], instanceId }),
      ...(zone === "battlefield" ? {
        battlefield: player.battlefield
          .filter((candidate) => candidate.instanceId !== instanceId)
          .map((candidate) => {
            if (candidate.attachedTo !== instanceId) return candidate
            const { attachedTo: _attachedTo, ...detached } = candidate
            return detached
          }),
      } : {}),
    },''',
        'player removeCard')

    s = replace_once(s,
        '        instanceId: card.instanceId,\n        tapped: card.tapped,',
        '        instanceId: card.instanceId,\n        attachedTo: card.attachedTo ?? null,\n        tapped: card.tapped,',
        'broadcast attachment fingerprint')

    # Add server-rendered card classes for the attachment and host. Stage 7
    # already renders every battlefield card with its unique instance ID.
    r = replace_once(r,
        '''    .map((card) => renderBattlefieldCard({ card, isCurrentPlayer: options.isCurrentPlayer }))''',
        '''    .map((card) => renderBattlefieldCard({
      card,
      isCurrentPlayer: options.isCurrentPlayer,
      hasAttachments: options.player.battlefield.some((candidate) => candidate.attachedTo === card.instanceId),
    }))''', 'main battlefield card mapping')
    r = replace_once(r,
        '  landStackIndex?: number\n}): string {',
        '  landStackIndex?: number\n  hasAttachments?: boolean\n}): string {', 'renderer options')
    r = replace_once(r,
        '''class="battlefield-card${card.tapped ? " tapped" : ""}${landClass}"''',
        '''class="battlefield-card${card.tapped ? " tapped" : ""}${landClass}${card.attachedTo ? " stage8-attached" : ""}${options.hasAttachments ? " stage8-attachment-host" : ""}"''',
        'card host/attachment classes')

    # Use normal right-click card tool menu, so one needs no new modal or state
    # maintenance. Non-Aura/Equipment cards can still be manually attached as a
    # physical tabletop would allow; no Magic rules are enforced.
    tools_anchor = 'function renderCardTools(card: PublicBattlefieldCard): string {'
    if r.count(tools_anchor) != 1: raise ValueError('renderCardTools anchor missing')
    # The earlier installer assumed the exact first two lines of the card-tools
    # function. Later customizations can change that code. Instead append the
    # new control to the EXISTING result of renderCardTools(card), leaving the
    # original implementation, order, and styles untouched.
    stage8_tool = '''function renderStage8AttachmentTool(card: PublicBattlefieldCard): string {
  const name = attribute(card.name)
  return card.attachedTo
    ? `<button type="button" class="card-tool stage8-tool" data-stage8-detach="true" title="Detach ${name}">Unlink</button>`
    : `<button type="button" class="card-tool stage8-tool" data-stage8-attach-start="true" title="Attach ${name} to another card">Attach</button>`
}

'''
    r = replace_once(r, tools_anchor, stage8_tool + tools_anchor, 'card-tools helper placement')
    r = replace_once(r,
        'renderCardTools(card)',
        'renderCardTools(card) + renderStage8AttachmentTool(card)',
        'right-click menu attach invocation')

    j = replace_once(j,
        '  wireLandStackTap(actorId)\n',
        '  wireLandStackTap(actorId)\n  wireStage8Attachments(actorId)\n',
        'Stage 7 startup')
    j = j.rstrip() + '\n' + JS
    c = c.rstrip() + '\n\n' + CSS

    return dict(zip(FILES, (t,a,p,s,r,j,c)))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    arg = argparse.ArgumentParser(description=__doc__)
    modes = arg.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--undo', action='store_true')
    modes.add_argument('--status', action='store_true')
    args = arg.parse_args()
    root = Path.cwd()
    paths = {p: root/p for p in FILES}
    manifest = root/BACKUP/'manifest.json'
    if args.status:
        renderer = paths[Path('src/server/render/components.ts')]
        client = paths[Path('public/shuffle.js')]
        style = paths[Path('public/application.css')]
        if not renderer.is_file() or not client.is_file() or not style.is_file():
            sys.exit('ERROR: run this from your shuffleupandplay project directory')
        html = renderer.read_text(encoding='utf-8')
        js = client.read_text(encoding='utf-8')
        css = style.read_text(encoding='utf-8')
        checks = {
            'Renderer defines attachment button': 'function renderStage8AttachmentTool(' in html,
            'Renderer includes attachment button in card tools':
                'renderCardTools(card) + renderStage8AttachmentTool(card)' in html,
            'Browser initializes attach handler': 'wireStage8Attachments(actorId)' in js,
            'Browser has attach handler': 'function wireStage8Attachments(' in js,
            'Attachment CSS included': MARKER in css,
            'Stage 8 backup manifest exists': manifest.is_file(),
        }
        for label, present in checks.items():
            print(f'{"YES" if present else "NO ":3}  {label}')
        if not all(checks.values()):
            print('Stage 8 is not fully present in these sources; do not assume it is deployed.')
        else:
            print('Stage 8 appears in the Fedora sources. Rebuild/restart and inspect browser HTML.')
        return
    if args.undo:
        if not manifest.is_file(): sys.exit('ERROR: backup not found; no changes made')
        saved = json.loads(manifest.read_text())
        for p,f in paths.items():
            if not f.is_file() or digest(f.read_bytes()) != saved['installed'][str(p)]:
                sys.exit(f'ERROR: {p} changed since Stage 8; refusing destructive undo')
        for p,f in paths.items(): shutil.copy2(root/BACKUP/p, f)
        print('Stage 8A reverted. Rebuild and restart to activate the old version.')
        return
    for p,f in paths.items():
        if not f.is_file(): sys.exit(f'ERROR: missing {p}; run from project root')
    originals = {p:f.read_text(encoding='utf-8') for p,f in paths.items()}
    try: updated = patch(originals)
    except (ValueError,KeyError) as e: sys.exit(f'ERROR: {e}. No files changed.')
    with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8') as out:
        out.write(updated[Path('public/shuffle.js')]); temp = Path(out.name)
    try:
        # The project normally builds with Node.js *inside* Podman. A host
        # installation of Node.js is optional, so do not fail the installer
        # when it is missing. The Podman build will still compile TypeScript.
        node = shutil.which('node')
        if node:
            result = subprocess.run([node, '--check', str(temp)], capture_output=True, text=True)
            if result.returncode:
                sys.exit('ERROR: JS syntax check failed; no files changed:\n' + result.stderr)
        else:
            print('NOTE: Node.js is not on Fedora PATH; skipping optional host JS syntax check.')
            print('      The following podman build is REQUIRED for syntax and TypeScript checks.')
    finally:
        temp.unlink(missing_ok=True)
    if args.check:
        print('Stage 8A compatibility check passed. No files changed.')
        return
    if (root/BACKUP).exists(): sys.exit('ERROR: stage8-backup already exists. Preserve it before retrying.')
    (root/BACKUP).mkdir(parents=True)
    for p,f in paths.items():
        b = root/BACKUP/p
        b.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,b)
    try:
        for p,f in paths.items(): f.write_text(updated[p], encoding='utf-8')
        manifest.write_text(json.dumps({'installed': {str(p):digest(updated[p].encode()) for p in FILES}},indent=2)+'\n')
    except Exception as e:
        for p,f in paths.items(): shutil.copy2(root/BACKUP/p,f)
        sys.exit(f'ERROR writing files; restored backups: {e}')
    print('Stage 8A installed. Backups: stage8-backup/.')
    print('Next: podman stop mtg-tabletop && podman build -t mtg-tabletop .')

if __name__=='__main__': main()
