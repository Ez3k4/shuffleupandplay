# Stage 9 renderer fix + Stage 8C Other Zones fix

For your existing customized Shuffle Up and Play checkout (after Stage 8C and optionally Stage 8B). The zip replaces only the installer script **until you explicitly run the scripts**.

## What failed

- The original Stage 9 installer expected exactly one `</section>` at the end of `renderPlayer`. Later customized UI layouts no longer guarantee this shape. This installer inserts the mulligan overlay directly after the existing `renderBattlefield({ player, isCurrentPlayer })` expression, retaining all surrounding markup.
- The Stage 8C popover uses `<details><summary>Move to another zone</summary>`. The existing `beginDrag()` handler ignored buttons but did not ignore `<summary>`, so clicking the group could initiate a card drag. The small fix excludes all `.card-tools` interactions from dragging. It changes no card actions or server logic.

## Safe installation (Fedora)

```bash
cd ~/Games/shuffleupandplay
unzip -o ~/Downloads/mtg_tabletop_stage9_and_zone_menu_fix.zip

python3 fix_stage8c_zone_menu.py --check
python3 install_stage9.py --check

python3 fix_stage8c_zone_menu.py
python3 install_stage9.py

podman stop mtg-tabletop
podman build -t mtg-tabletop .
```

Restart with the SAME `podman run` command and volume as before. Do not delete the volume or Firefox site data. No Node.js installation on Fedora is required.

`--check` is read-only; it does not make any changes. `--inspect` for `install_stage9.py` prints relevant renderer lines without modifying anything. Both patch scripts create backups (`stage8c-zone-menu-backup/` and `stage9-backup/`).

## Testing

1. Open a card's context menu. Select **Move to another zone**. Verify that the nested destinations expand and that selecting e.g. Graveyard actually moves the card. Check both browser sessions.
2. Open a **new** table with a deck before taking ordinary gameplay actions. Check the **Opening hand** panel, start, redraw, keep, and ordered card bottoming. Confirm the hand stays private.
3. Test land stacking, right-click Attach/Unlink, and drag-to-attach if it was previously installed.

If TypeScript compilation fails, paste the exact errors; the installer checks structure and JS syntax, but cannot validate your exact customized checkout until the Podman build runs.

## Undo

To revert everything (only if the files have not been edited since installation), undo in the reverse order:

```bash
python3 install_stage9.py --undo
python3 fix_stage8c_zone_menu.py --undo
```

Then rebuild/restart. If an undo refuses due to changed files, use Git or compare the backup instead of overwriting later work.
