# Stage 8A installer — Fedora without Node.js

This ZIP replaces **only the installer** `install_stage8.py` in your project directory. It does not directly change the web app. The installer keeps its existing compatibility and rollback guards.

## Fix

Earlier versions called `node --check` unconditionally. Fedora need not have Node.js installed when building inside Podman. This version runs that optional syntax check if `node` exists; otherwise it explicitly warns and continues. The subsequent `podman build` is mandatory to type-check/compile the app.

## Inspect before modifying anything

```bash
cd ~/Games/shuffleupandplay
unzip -o ~/Downloads/mtg_tabletop_stage8a_no_node_fix.zip
python3 install_stage8.py --status
```

`--status` is read-only. It reports if the Stage 8 renderer helper, its invocation, the event handler, CSS and backup manifest are present.

- If **every check is YES**, the source appears installed. **Do not rerun the installer.** Rebuild and restart your app (using your existing Podman run command), then see the browser verification below.
- If Stage 8 checks are all NO, install it as follows:

```bash
python3 install_stage8.py --check
python3 install_stage8.py
podman stop mtg-tabletop
podman build -t mtg-tabletop .
```

Use your usual `podman run` command afterward; do not delete the `mtg-tabletop-data` volume.

- If checks show a **mixture of YES and NO**, do not attempt another install: share the output and inspect the current files before further changes.

## Verify on the running page

In Firefox F12 -> Console with a **nonland** card on your own battlefield:

```js
console.table({
  cards: document.querySelectorAll('.your-seat .battlefield-card:not(.stage7-land-card)').length,
  attachButtons: document.querySelectorAll('.your-seat .battlefield-card:not(.stage7-land-card) .card-tools [data-stage8-attach-start]').length,
  unlinkButtons: document.querySelectorAll('.your-seat .battlefield-card:not(.stage7-land-card) .card-tools [data-stage8-detach]').length
})
```

- `cards > 0` and `attachButtons > 0`: Stage 8 HTML is present; check the right-click visibility handler/CSS if no Attach option appears.
- `cards > 0` but both buttons are 0: the browser is getting old/unpatched HTML, or the renderer invocation is missing. Confirm the running image and hard-refresh Firefox.
- `cards = 0`: play a nonland permanent first.

Right-click on a creature or equipment **on your battlefield**, not a land stack or a card in hand.

## Safety

The installer still backs up the seven files it modifies in `stage8-backup/` and refuses partial installation when source anchors differ. It does not modify your saved games. Never install on top of an already-applied Stage 8 version.
