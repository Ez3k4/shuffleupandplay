# Stage 11E — Three-card size tiers and mirrored opponent board

Built for the customized Shuffle Up and Play tabletop after **Stage 11D**.

## What changes

- Battlefield nonland permanents stay large for **1–6** cards, then shrink at **7, 10, 13, 16, ...**. No size change between thresholds.
- **The amount of shrinking at each tier is unchanged from Stage 11D.** The target number of side-by-side slots is still `6 + 4 × tier`. For example, 7–9 cards use the previous 10-slot size; 10–12 use the previous 14-slot size; 13–15 use the previous 18-slot size.
- On **your opponent's battlefield**, ordinary permanents are rendered vertically mirrored around the playing area's center: a card near the upper edge of its owner's view appears near the lower edge in your view (toward the center divider).
- On the **opponent side**, equipment and aura attachments fan upward rather than downward to respect the mirroring.
- Land stacks, top-edge opponent piles, commander zone, card identities, persistent coordinates, action payloads, drag handlers, and your local battlefield are unchanged.

## Install (on Fedora)

```bash
cd ~/Games/shuffleupandplay
unzip -o ~/Downloads/mtg_tabletop_stage11e_three_card_tiers_mirror.zip
python3 install_stage11e.py --status    # read-only
python3 install_stage11e.py --check     # read-only
python3 install_stage11e.py             # writes files after backing them up
```

The installer changes:

- `public/shuffle.js`
- `src/server/render/components.ts`
- `public/application.css`

Backups are saved in `stage11e-backup/`. The script does not require Node.js on the Fedora host.

Rebuild and restart:

```bash
podman stop mtg-tabletop
podman build -t mtg-tabletop .
# Start the new container using your existing podman run command and storage volume.
```

## Verify

1. Play six ordinary permanents. The size should remain large.
2. Play a seventh. It shrinks once; the eighth and ninth have the same size; the tenth shrinks again.
3. Check your friend's view of your board: a card near the **top** of your own battlefield should appear near the **bottom** of your battlefield from their perspective.
4. In your view, the opponent's creatures should be closer to the middle divider, with their lands still near the opponent's outer/top edge.
5. Test moving an attached creature and hovering over hand cards; no existing actions should change.

**Important:** This mirrors the opponent's *displayed vertical coordinates*; it does not change the saved positions. No game migration is required. Cards may appear in a different location in the opponent window immediately after installing, which is the intended correction.

## Check or undo

```bash
python3 install_stage11e.py --status
python3 install_stage11e.py --undo
```

Undo restores the exact three files backed up by this installer, provided you have not modified them since installation. Rebuild and restart afterward. If you edited the files, undo refuses rather than overwriting your changes; revert manually with Git.

## Notes

For very crowded boards on narrow screens, the existing 44px minimum can prevent all cards from fitting in a single row. The system still **resizes** cards but does not automatically rearrange their X/Y positions.

The zip includes an optional `test_stage11e.py` regression test for development; it requires Node.js and TypeScript in the test environment, **not on your Fedora host**.
