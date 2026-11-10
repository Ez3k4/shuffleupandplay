# Stage 27D — Card instances, zones and private views

**Scope:** an isolated TypeScript engine prototype. Nothing here is connected to
`src/actors/game-room.ts`, network routes, SQLite, `public/shuffle.js` or CSS.
Your existing manual tabletop remains unchanged. No new browser UI is expected.

## Added concepts

- A `CardInstance` is one physical/virtual card with a stable `instanceId`, a
  separate external `definitionId`, an immutable owner, a current controller,
  its zone, and a `zoneOwnerId` for player-specific zones.
- `seedEngineLibraries()` is a **trusted setup helper**, not a client command.
  Top-of-library is the first entry for a player in the ordered card array.
  All IDs are deterministic and allocated by the engine.
- `PROTOTYPE_DRAW_CARD` moves the top of the current priority holder's library
  into their hand. It is **not** the mandatory draw-step rule. It does not
  implement losing to an empty library.
- `PROTOTYPE_MOVE_CARD` allows the current priority holder to move their own
  card among hand, battlefield, graveyard and exile. It does **not** cast a
  spell, check permissions, pay mana, or enforce Magic's normal zone-change rules.
  Moving cards *from or to* the library through this command is prohibited.
- `projectPlayerZones()` returns a separate visibility projection for each
  viewer. It exposes their hand, public face-up zones and hidden-zone counts,
  but not opponent hand identities or either library's card definitions.
  **Do not send raw `EngineState` or raw `EngineEvent` objects to clients.**

## Install on Stage 27C

From a clean `feature/stage27-engine-foundation` working tree:

```bash
cd ~/Games/shuffleupandplay
mkdir -p /tmp/mtg-stage27d
unzip -oq ~/Downloads/mtg-stage27d-card-zones.zip -d /tmp/mtg-stage27d
python3 /tmp/mtg-stage27d/install-stage27d.py --repo "$PWD" --check
python3 /tmp/mtg-stage27d/install-stage27d.py --repo "$PWD"
```

The installer verifies SHA-256 hashes of the Stage 27C engine and all patch
contents. It refuses to overwrite edited/unexpected files, checks for symlinks,
and can safely be rerun.

## Test

```bash
# Local image only. Does NOT restart the production VM/container.
podman build --target build -t mtg-stage27d-test .

# Run all engine tests using Vitest from the image.
podman run --rm \
  -v "$PWD/test/engine:/app/test/engine:ro,Z" \
  --entrypoint sh mtg-stage27d-test \
  -lc 'pnpm exec vitest run test/engine'
```

This patch adds 19 tests and retains 46 previous tests (65 total).
Also inspect `git diff` and the VS Code Source Control panel.

```bash
git add src/engine test/engine STAGE27D-README.md
git commit -m "Stage 27D: add prototype card zones and private views"
git push -u origin feature/stage27-engine-foundation
```

## When to test in the browser

**Stage 28**, once engine state is integrated with server game rooms, a separate
mode is available locally, and a player's projected state reaches the browser.
Stage 27D should be tested via TypeScript unit tests. You may still run the
existing manual tabletop locally as a regression smoke test; it will look and
behave exactly as before.

## Important non-goals

No automatic initial hand, shuffling, draw step, life/game-loss conditions,
face-down cards, library manipulation, card costs, spell casting, combat,
replacement effects, priority exceptions or ownership changes. Full hidden
information protection requires projecting **all** state and event types at
Stage 28, not merely invoking this card-zone projection.
