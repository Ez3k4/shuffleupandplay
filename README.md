# Stage 7 — Land classification hotfix

This hotfix preserves the current Stage 7 land-zone renderer, card stacks, CSS, custom JavaScript and game actions.

It fixes two weaknesses:
1. A basic land imported with `isLand: false` was not recognized because the renderer returned before checking its unambiguous name.
2. The importer looked only at one `typeLine` field. The fix checks additional oracle/printing type fields and known basic-land names.

## Installation

From `~/Games/shuffleupandplay`:

```bash
unzip -o ~/Downloads/mtg_tabletop_stage7_fix.zip
python3 install_stage7_fix.py --check  # Read-only compatibility check
python3 install_stage7_fix.py          # Changes two .ts files; saves backups
podman stop mtg-tabletop
podman build -t mtg-tabletop .
```

Restart with your existing `podman run` command and **the same persistent volume**.

Test with a Plains or Forest already on the battlefield (basic lands now work even for old saved decks). **Reimport your deck** for nonbasic lands; their metadata may be absent in older saved games.

## If the lane is still missing

In Firefox DevTools console with a basic land played:

```js
console.table({
  landLanes: document.querySelectorAll('.stage7-land-zone').length,
  landStacks: document.querySelectorAll('.stage7-land-stack').length,
  battlefieldCards: document.querySelectorAll('.battlefield-card').length
})
```

On Fedora, check the running container contains the compiled renderer:

```bash
podman exec mtg-tabletop sh -c 'grep -R -l "stage7-land-zone" /app/dist /app/public 2>/dev/null | head'
```

Both checks are read-only.

## Undo

```bash
python3 install_stage7_fix.py --undo
```

Undo only succeeds if these two files are unchanged since the fix. It does not undo Stage 7 itself.
