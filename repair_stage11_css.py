#!/usr/bin/env python3
"""Restore only missing Stage 11 CSS rules, preserving current source logic.

Requires an already-installed Stage 11E JS implementation and renderer.
Uses CSS text from original Stage 11/11C/11E patch installers.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import sys

CSS_FILE = Path("public/application.css")
JS_FILE = Path("public/shuffle.js")
RENDER_FILE = Path("src/server/render/components.ts")
BACKUP = Path("stage11-css-recovery-backup")
CSS_SECTIONS = [('Stage 11: responsive battlefield card sizing', "/* ===== Stage 11: responsive battlefield card sizing ===== */\n/* All sizes are derived from the window WITHOUT scaling the whole canvas.\n * Normalized card coordinates and pointer/drop coordinates therefore still\n * use the same untransformed battlefield element.\n *\n * The minimum prevents cards from becoming unreadably small. The maximum\n * prevents large monitors from producing oversized cards. We consider both\n * viewport width and HEIGHT: each player's board gets roughly half the page.\n */\n#players-area .player-section {\n  --tabletop-card-width: clamp(72px, min(9vw, 15dvh), 136px);\n  --tabletop-card-height: calc(var(--tabletop-card-width) * 162 / 116);\n\n  /* Keep the two players' three piles aligned with the card travel limit.\n   * This MUST match the visual pile widths for tabletopLogicalPosition(). */\n  --stage11-pile-width: clamp(55px, min(6.6vw, 11dvh), 98px);\n  --stage11-pile-gap: clamp(0.25rem, 0.42vw, 0.45rem);\n  --tabletop-pile-card-width: var(--stage11-pile-width);\n  --tabletop-pile-gap: var(--stage11-pile-gap);\n  --tabletop-pile-reserve: calc(3 * var(--stage11-pile-width) + 2 * var(--stage11-pile-gap) + 16px);\n\n  /* The land lane scales separately, slightly smaller than permanents. */\n  --stage11-land-width: clamp(48px, calc(var(--tabletop-card-width) * 0.655), 88px);\n  --stage11-attachment-scale: 1;\n}\n\n/* The card box and its aspect ratio change; x/y coordinates do not.\n * Exclude Stage 7's independent, smaller land cards. */\n#players-area .battlefield-canvas > .battlefield-card:not(.stage7-land-card) {\n  width: var(--tabletop-card-width);\n  height: var(--tabletop-card-height);\n}\n\n/* Both seats use one shared pile size, including the existing Library,\n * Graveyard and Exile previews, while keeping their current positions. */\n#players-area .player-section .player-zones {\n  --zone-card-width: var(--stage11-pile-width);\n}\n#players-area .opponent-seat {\n  --zone-card-width: var(--stage11-pile-width);\n  --opponent-pile-gap: var(--stage11-pile-gap);\n}\n#players-area .your-seat .player-zones .zone-lanes,\n#players-area .opponent-seat .player-zones .zone-lanes {\n  gap: var(--stage11-pile-gap);\n}\n\n/* The Arena-style hand continues to reveal the entire card on hover.\n * Deriving rise from card width prevents a gap or a cropped title on resize. */\n#players-area .your-seat .player-zones {\n  --hand-peek-height: clamp(28px, calc(var(--stage11-pile-width) * 0.49), 48px);\n  --hand-rise: calc(var(--hand-peek-height) - var(--stage11-pile-width) * 680 / 488 - 4px);\n}\n\n/* Stage 7 land groups and the individual cards inside them scale together.\n * The original stack offset and tap/click behavior remain in effect. */\n#players-area .battlefield-canvas {\n  --stage7-land-width: var(--stage11-land-width);\n  --stage7-land-height: calc(var(--stage7-land-width) * 107 / 76);\n}\n#players-area .stage7-land-card.battlefield-card {\n  width: calc(var(--stage7-land-width) * 66 / 76);\n  height: calc(var(--stage7-land-height) * 94 / 107);\n}\n#players-area .stage7-land-stack:hover .stage7-land-card,\n#players-area .stage7-land-stack:focus-within .stage7-land-card {\n  left: calc(var(--stage7-stack-index) * clamp(9px, 1.1vw, 15px));\n}\n\n/* Stage 8C still assigns each equipment/aura an individual pixel offset.\n * At smaller screen widths reduce that offset to keep the fan compact.\n * We don't touch the saved attachment state, or use transform: scale(). */\n#players-area .battlefield-canvas > .battlefield-card.stage8-attached {\n  margin-left: calc(var(--stage8c-attach-x, 23px) * var(--stage11-attachment-scale));\n  margin-top: calc(var(--stage8c-attach-y, 31px) * var(--stage11-attachment-scale));\n}\n@media (max-width: 1450px) {\n  #players-area .player-section { --stage11-attachment-scale: 0.9; }\n}\n@media (max-width: 1100px) {\n  #players-area .player-section { --stage11-attachment-scale: 0.75; }\n}\n@media (max-width: 700px) {\n  #players-area .player-section { --stage11-attachment-scale: 0.65; }\n}\n\n/* Commander slots remain on their respective right-hand edges. Resize the\n * preview, but preserve Stage 10B's lower placement for the opponent. */\n#players-area .stage10-command-zone .stage10-card {\n  width: min(calc(var(--tabletop-card-width) * 0.69), 100%);\n}\n#players-area .opponent-seat .stage10-command-zone .stage10-card {\n  width: min(clamp(44px, calc(var(--tabletop-card-width) * 0.52), 70px), 100%);\n}\n\n/* Respect the original no-animation option in the site's stylesheet. */\n"), ('Stage 11C: stable battlefield card-size tiers', "/* ===== Stage 11C: stable battlefield card-size tiers ===== */\n/* Each player has a different root variable. The page root survives the\n * server's partial player-section replacements, eliminating size flashes.\n * This overrides Stage 11's viewport default without changing card x/y. */\n#players-area .player-section.your-seat {\n  --tabletop-card-width: var(--stage11c-you-width, clamp(72px, min(12vw, 21dvh), 176px));\n}\n#players-area .player-section.opponent-seat {\n  --tabletop-card-width: var(--stage11c-opponent-width, clamp(72px, min(12vw, 21dvh), 176px));\n}\n#players-area .player-section {\n  --tabletop-card-height: calc(var(--tabletop-card-width) * 162 / 116);\n  /* Land-stack dimensions remain stable when nonland counts change. */\n  --stage11-land-width: clamp(48px, min(6.2vw, 10dvh), 88px);\n}\n#players-area .battlefield-canvas > .battlefield-card:not(.stage7-land-card) {\n  width: var(--tabletop-card-width);\n  height: var(--tabletop-card-height);\n}\n"), ('Stage 11E: mirrored opponent permanents and attachment fan', "/* ===== Stage 11E: mirrored opponent permanents and attachment fan ===== */\n/* Stage 6 keeps logical card positions identical for all clients. The server\n * renderer now reverses ONLY the opponent's displayed vertical coordinate,\n * bringing their front-row creatures toward the middle divider. Their lands\n * and other fixed UI zones keep their established positions. */\n\n/* An attachment's relative fan must face away from the middle divider on the\n * opponent side. Stage 11 supplies the responsive scale factor; for builds\n * without it, the fallback is 1. The horizontal staggering stays unchanged. */\n#players-area .opponent-seat .battlefield-canvas > .battlefield-card.stage8-attached {\n  margin-top: calc(-1 * var(--stage8c-attach-y, 31px) * var(--stage11-attachment-scale, 1));\n}\n")]
JS_MARKER = "Stage 11E: resize after every three additional nonland permanents"
RENDER_MARKER = "(options.isCurrentPlayer ? card.y : 700 - card.y)"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Read-only compatibility check")
    parser.add_argument("--status", action="store_true", help="Read-only CSS/JS status")
    parser.add_argument("--undo", action="store_true", help="Restore original stylesheet only if unchanged")
    args = parser.parse_args()
    for file in (CSS_FILE, JS_FILE, RENDER_FILE):
        if not file.is_file():
            sys.exit(f"ERROR: missing {file}. Run from the project's root directory.")
    css = CSS_FILE.read_text()
    js = JS_FILE.read_text()
    render = RENDER_FILE.read_text()
    missing = [(label, chunk) for label, chunk in CSS_SECTIONS if label not in css]
    if args.status:
        print("Stage 11E client resize logic:", "YES" if JS_MARKER in js else "NO")
        print("Stage 11E mirrored renderer:", "YES" if RENDER_MARKER in render else "NO")
        for label, chunk in CSS_SECTIONS:
            print(("YES" if label in css else "NO ") + "  CSS " + label)
        return
    if args.undo:
        old = BACKUP / 'application.css'
        saved_hash = BACKUP / 'installed.sha256'
        if not old.is_file() or not saved_hash.is_file():
            sys.exit("ERROR: CSS recovery backup missing; no files changed")
        if sha(CSS_FILE.read_bytes()) != saved_hash.read_text().strip():
            sys.exit("ERROR: CSS changed since recovery; refusing to overwrite")
        CSS_FILE.write_bytes(old.read_bytes())
        print("Recovered stylesheet rolled back. Backup retained.")
        return
    if JS_MARKER not in js or RENDER_MARKER not in render:
        sys.exit("ERROR: Stage 11E JS or renderer not detected. CSS-only repair is not appropriate. No files changed.")
    if not missing:
        print("All three Stage 11 CSS sections already present. No change needed.")
        return
    if BACKUP.exists():
        sys.exit("ERROR: recovery backup folder exists; refusing to overwrite. No files changed.")
    print("Missing CSS sections:")
    for label, _ in missing:
        print(" -", label)
    if args.check:
        print("CSS-only recovery compatibility check passed. No files changed.")
        return
    addition = "\n\n".join(chunk.strip() for _, chunk in missing)
    new_css = css.rstrip() + "\n\n" + addition + "\n"
    BACKUP.mkdir()
    (BACKUP / 'application.css').write_bytes(CSS_FILE.read_bytes())
    (BACKUP / 'installed.sha256').write_text(sha(new_css.encode())+'\n')
    CSS_FILE.write_text(new_css)
    print("Restored missing Stage 11 CSS sections only.")
    print("Backup:", BACKUP / 'application.css')

if __name__ == "__main__":
    main()
