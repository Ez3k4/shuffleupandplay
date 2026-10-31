#!/usr/bin/env python3
"""Repair Stage 7 land classification without touching layout/game actions.

From the project root:
    python3 install_stage7_fix.py --check
    python3 install_stage7_fix.py
    python3 install_stage7_fix.py --undo
"""
from __future__ import annotations

import argparse
import difflib
import pathlib
import shutil
import sys

RENDER = pathlib.Path('src/server/render/components.ts')
IMPORTER = pathlib.Path('src/archidekt/client.ts')
BACKUP = pathlib.Path('stage7-fix-backup')

BEFORE_RENDER = '''  if (typeof card.isLand === "boolean") return card.isLand
  // Compatibility with old saved decks: basic lands are unambiguous by name.
  return /^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest|Wastes)$/i.test(card.name)'''
AFTER_RENDER = '''  // Always recognize basic lands, including decks imported with isLand: false.
  if (/^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest|Wastes)$/i.test(card.name.trim())) return true
  // Avoid treating mana-producing nonlands (such as Sol Ring) as lands.
  return card.isLand === true'''

BEFORE_IMPORTER = '''    isLand: /\\bLand\\b/i.test(stringValue(oracleCard?.typeLine, "").split("//")[0] ?? ""),'''
AFTER_IMPORTER = '''    isLand: isLandType({ card, oracleCard, name }),'''

HELPER = '''// Archidekt can expose printed/oracle type information in different fields.
// The basic-land fallback also covers imported cards without type metadata.
function isLandType(options: {
  card: Record<string, unknown> | null
  oracleCard: Record<string, unknown> | null
  name: string
}): boolean {
  if (/^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest|Wastes)$/i.test(options.name.trim())) {
    return true
  }
  const fields: unknown[] = [
    options.oracleCard?.typeLine,
    options.oracleCard?.type_line,
    options.oracleCard?.types,
    options.card?.typeLine,
    options.card?.type_line,
    options.card?.types,
  ]
  return fields.some((field) => {
    if (Array.isArray(field)) {
      return field.some((value) => typeof value === "string" && /\\bLand\\b/i.test(value))
    }
    return typeof field === "string" && /\\bLand\\b/i.test(field.split("//")[0] ?? "")
  })
}

'''


def replace_one(s: str, old: str, new: str, file: pathlib.Path) -> str:
    n = s.count(old)
    if n != 1:
        raise ValueError(f'{file}: expected exactly one Stage 7 anchor, found {n}')
    return s.replace(old, new, 1)


def changes():
    if not (RENDER.is_file() and IMPORTER.is_file()):
        raise ValueError('Run from project root with src/server/render/components.ts')
    render = RENDER.read_text(encoding='utf-8')
    importer = IMPORTER.read_text(encoding='utf-8')
    fixed_render = replace_one(render, BEFORE_RENDER, AFTER_RENDER, RENDER)
    fixed_importer = replace_one(importer, BEFORE_IMPORTER, AFTER_IMPORTER, IMPORTER)
    fixed_importer = replace_one(fixed_importer, 'function isManaSource(', HELPER+'function isManaSource(', IMPORTER)
    return [(RENDER, render, fixed_render), (IMPORTER, importer, fixed_importer)]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    gr = ap.add_mutually_exclusive_group()
    gr.add_argument('--check', action='store_true')
    gr.add_argument('--undo', action='store_true')
    args = ap.parse_args()
    if args.undo:
        if not BACKUP.is_dir() or not (BACKUP / RENDER).is_file() or not (BACKUP / IMPORTER).is_file():
            sys.exit('No backup found. Nothing changed.')
        for path in [RENDER, IMPORTER]:
            original = BACKUP / path
            if not path.is_file():
                sys.exit(f'Missing {path}; refusing undo')
            # Refuse if further edits have been made since fix installation.
            current = path.read_text(encoding='utf-8')
            previous = original.read_text(encoding='utf-8')
            if path == RENDER:
                expected = replace_one(previous, BEFORE_RENDER, AFTER_RENDER, RENDER)
            else:
                expected = replace_one(previous, BEFORE_IMPORTER, AFTER_IMPORTER, IMPORTER)
                expected = replace_one(expected, 'function isManaSource(', HELPER+'function isManaSource(', IMPORTER)
            if current != expected:
                sys.exit(f'{path} changed since fix; refusing undo. Restore with Git or review manually.')
        for path in [RENDER, IMPORTER]:
            shutil.copy2(BACKUP / path, path)
        print('Stage 7 classification fix reverted; rebuild the image.')
        return
    try:
        items = changes()
    except ValueError as exc:
        sys.exit(f'ERROR: {exc}. No files changed.')
    if args.check:
        for path, before, after in items:
            print(f'{path}: anchor found, {len(after) - len(before)} bytes change')
        print('Compatibility check passed; no files changed.')
        return
    if BACKUP.exists():
        sys.exit('ERROR: stage7-fix-backup already exists; refusing to overwrite backups.')
    try:
        for path, before, after in items:
            dest = BACKUP / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
        for path, before, after in items:
            path.write_text(after, encoding='utf-8')
    except Exception:
        for path, before, _ in items:
            path.write_text(before, encoding='utf-8')
        raise
    print('Fixed Stage 7 land classification. Backups: stage7-fix-backup/')
    print('Build and restart your container; reimport deck for nonbasic land metadata.')


if __name__ == '__main__':
    main()
