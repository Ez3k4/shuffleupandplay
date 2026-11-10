# Stage 28C — Read-only tabletop card identity bridge

## Scope

Stage 28C builds on Stage 28B. **The existing manual `Room` remains the sole
source of truth for actual cards.** The experimental engine has a snapshot of
card locations with IDs based on the real imported/played card instances, but
cannot use HTTP to draw, cast, move, or shuffle cards. Its snapshot is not
written back to the manual room.

- `src/engine/tabletop-bridge.ts`: server-only, pure adapter and divergence checker.
- `src/actors/game-room.ts`: seed the engine from all five supported live zones;
  project a read-only bridge status for the authenticated seat.
- `src/engine/server-view.ts`: adds **aggregate counts only** to the already
  seat-filtered response. It never exposes opponents' hidden card names or IDs.
- `public/experimental-engine.js` and `src/server/render/pages.ts`: add a small
  `Card link` indicator to the existing engine toolbar panel.
- `test/engine/` and `test/browser/engine-bridge.browser.ts`: regression tests.

### What “linked” means

Each engine card receives a stable **player-scoped identity** constructed from
`playerId:manualCardInstanceId`. This is necessary because separate imported
decks may use the same instance IDs. The read-only engine snapshot stores only
identity, definition ID, controller/owner placeholder, and zone.

For now, ownership and control are both inferred from the manual player's zone.
Cross-player control changes and advanced visibility rules are not supported.
The bridge detects changes to identity, definition, zone or library order; it
does not automatically reconcile them. Its browser view shows only `synced` or
`out_of_sync` plus aggregate linked-card counts.

**Do not interpret “linked” as full rules-engine card automation.** This stage
explicitly does not implement draw-step rules, mana, combat, casting, effects,
replacement effects or deck shuffling.

### Preconditions and limitations

- Use a **new** local two-player table for Stage 28C browser tests. Previously
  started Stage 28A/B games use synthetic engine IDs and will show as out of sync.
- Both players must have loaded their decks.
- `pendingSpells` and `commander`/command-zone cards aren't representable by the
  five-zone prototype. The experiment **refuses to start** if those are present;
  manual tabletop play continues working.
- Manual actions after starting the engine can make the prototype snapshot
  stale. That produces an **Out of sync** warning. Nothing is changed or
  automatically replayed to the engine.
- Existing `SHUFFLE_EXPERIMENTAL_ENGINE=1` flag still gates all engine endpoints
  and controls. Leave it disabled in production.
- The bridge is an intermediate milestone. **Before enabling any engine card
  mutation we must design a single transactional card-writing authority, rather
  than mirroring mutable copies in two separate game states.**

## Install

Extract ZIP into `/tmp/mtg-stage28c`, then:

```bash
python3 /tmp/mtg-stage28c/install-stage28c.py --repo "$PWD" --check
python3 /tmp/mtg-stage28c/install-stage28c.py --repo "$PWD"
```

The guarded installer refuses unexpected modifications and does not overwrite
`shuffle.js`, `application.css`, your database or unrelated game files.

## Test on Fedora

```bash
podman build --target build -t mtg-stage28c-test .
podman run --rm \
  -v "$PWD/test:/app/test:ro,Z" \
  -v "$PWD/public:/app/public:ro,Z" \
  --entrypoint sh mtg-stage28c-test \
  -lc 'pnpm run typecheck && pnpm exec vitest run test/engine test/game-room.test.ts test/server.test.ts test/restart.test.ts'
```

Optional Playwright browser automation (requires Playwright's Chromium):

```bash
SHUFFLE_EXPERIMENTAL_ENGINE=1 pnpm exec playwright test \
  test/browser/engine.browser.ts test/browser/engine-bridge.browser.ts
```

For manual browser testing, build `mtg-tabletop:stage28c`, run it locally using
`SHUFFLE_EXPERIMENTAL_ENGINE=1` and a **new test-only storage volume**, and open
`http://127.0.0.1:3001` in separate normal/private browser sessions.
Start the engine and look for `Card link: N cards linked`. Draw a card manually;
the indicator should become `Out of sync`, and the manual card should still
move normally. Priority passing must remain functional.

Do not deploy this prototype to your production service yet.
