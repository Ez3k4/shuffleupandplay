#!/usr/bin/env python3
"""Copy repo-root wallpapers into public assets and generate a browser manifest.

Usage (from repository root): python3 scripts/sync_wallpapers.py
Accepts either wallpapers/ OR public/wallpapers/ containing JPG/JPEG/PNG files.
Run before podman build, and after adding/removing wallpaper images.
"""
from __future__ import annotations
import json
import shutil
import sys
from pathlib import Path

EXTENSIONS = {'.jpg', '.jpeg', '.png'}


def sync(root: Path) -> list[str]:
    src = root / 'wallpapers'
    dest = root / 'public' / 'wallpapers'
    if src.is_dir():
        dest.mkdir(parents=True, exist_ok=True)
        for item in src.iterdir():
            if item.is_file() and not item.is_symlink() and item.suffix.lower() in EXTENSIONS:
                shutil.copy2(item, dest / item.name)
    elif not dest.is_dir():
        raise FileNotFoundError('No wallpapers/ or public/wallpapers/ folder found')

    files = sorted(p.name for p in dest.iterdir()
                   if p.is_file() and not p.is_symlink() and p.suffix.lower() in EXTENSIONS)
    if not files:
        raise ValueError(f'No JPG, JPEG, or PNG images in {dest}')
    (dest / 'manifest.json').write_text(json.dumps(files, ensure_ascii=False, indent=2) + '\n')
    return files


if __name__ == '__main__':
    try:
        found = sync(Path(__file__).resolve().parent.parent)
    except (FileNotFoundError, ValueError) as exc:
        print(f'Wallpaper setup: {exc}', file=sys.stderr)
        sys.exit(1)
    print(f'Wallpaper setup: {len(found)} image(s) available under /assets/wallpapers/')
