# Stage 28B — First browser interface for the experimental Magic engine

**Development-only browser milestone.** This patch does not alter the existing manual gameplay, card drag-and-drop, SQLite room model or `public/shuffle.js`.

## What it does

- Conditionally renders a compact **🧪 Engine** toolbar panel when `SHUFFLE_EXPERIMENTAL_ENGINE=1`.
- Loads a separately fingerprinted module (`public/experimental-engine.js`) only when enabled.
- On first load, fetches the redacted room-specific `/api/tables/:code/engine` view.
- Host (seat 1) can **Start engine test** after two players have loaded their decks.
- Current priority holder sees an enabled **Pass priority** button; the other player's button is disabled.
- Displays turn, current priority window, active player, current priority holder and stack length.
- Polls the player-specific view every 2.5 seconds while the page is visible, with a manual Refresh button. This simple initial polling will be replaced with event-driven updates in a later stage.
- Never requests raw engine state or exposes prototype draw/zone/life-effect commands.

**Important:** The experimental engine is still a parallel test tracker. Manual cards, hands and life totals are not driven by it. Stage 28B is NOT an automated playable Magic mode.

## Install

You must be on `feature/stage27-engine-foundation` with **Stage 28A** and the preceding **Stage 28A test compatibility fix** installed. Stage 28A may still be uncommitted on your branch. Commit those server changes first, then install Stage 28B. Start Stage 28B from a clean Git working tree.

```bash
cd ~/Games/shuffleupandplay
git status --short
git branch --show-current

mkdir -p /tmp/mtg-stage28b
unzip -oq ~/Downloads/mtg-stage28b-browser-engine-ui-26c-fix.zip -d /tmp/mtg-stage28b

# READ-ONLY checks source file hashes and new file destinations.
python3 /tmp/mtg-stage28b/install-stage28b.py --repo "$PWD" --check

# WRITES ONLY the files enumerated in the manifest.
python3 /tmp/mtg-stage28b/install-stage28b.py --repo "$PWD"
```

The installer applies strictly guarded, small text edits to the server-rendered page, HTTP route and browser-test helper. It APPENDS Stage 28B CSS to your current stylesheet rather than replacing it, preserving later Stage 25/26C styling. It still refuses unknown structural changes, missing dependencies, or existing files that would be overwritten.

## Test via Podman (Fedora)

```bash
# Builds an isolated local test image; does not touch webfant2.
podman build --target build -t mtg-stage28b-test .

# The build stage lacks test/public sources, so mount them read-only.
podman run --rm \
  -v "$PWD/test:/app/test:ro,Z" \
  -v "$PWD/public:/app/public:ro,Z" \
  --entrypoint sh mtg-stage28b-test \
  -lc 'pnpm run typecheck && pnpm exec vitest run test/engine test/game-room.test.ts test/server.test.ts test/restart.test.ts'
```

The new Vitest checks cover feature gating, stamped module loading and UI permission labels. The existing Stage 28A HTTP tests still cover real session authorization.

### First two-browser manual test

```bash
# Build actual runtime image, without touching production.
podman build -t mtg-tabletop:stage28b .

# Starts a separate LOCAL test container on localhost:3001.
# No production volume is mounted. Test data is discarded when container is removed.
podman run -d --name mtg-stage28b-local \
  -p 127.0.0.1:3001:3000 \
  -e "SHUFFLE_SECRET=$(openssl rand -hex 32)" \
  -e SHUFFLE_EXPERIMENTAL_ENGINE=1 \
  mtg-tabletop:stage28b

podman logs mtg-stage28b-local --tail=30
```

Open **http://127.0.0.1:3001** in your normal Firefox session. Create a **2-player** table. Open a different browser or an isolated private session to join that table as player two, and import a deck for each player.

Open **🧪 Engine** on both screens. Host clicks **Start engine test**. Both should now display turn 1, upkeep, and priority with the host. Host clicks **Pass priority**; shortly afterward the opponent's button should enable. Opponent passes; both should advance to the draw priority window. The underlying manual cards must remain unchanged.

If the Host gets an error saying both decks must be loaded, check the existing deck import status and retry. If the second browser joins a 3- or 4-seat table, the test is intentionally rejected.

Stop the temporary server afterward:

```bash
podman stop mtg-stage28b-local
podman rm mtg-stage28b-local
```

Optional automated end-to-end browser test (needs Playwright Chromium locally/in the image):

```bash
# Run from an environment with dependencies and Playwright Chromium installed:
SHUFFLE_EXPERIMENTAL_ENGINE=1 pnpm exec playwright test test/browser/engine.browser.ts
```

`test/browser-server.ts` now accepts the test-only environment flag and uses a separate temporary database. Ordinary Playwright runs remain unaffected.

## Inspect / commit

```bash
git diff --check
git status --short
git diff --stat

git add src/server/app.ts src/server/render/pages.ts \
  public/application.css public/experimental-engine.js \
  test/browser-server.ts test/engine/experimental-ui-http.test.ts \
  test/engine/browser-ui.test.mjs test/browser/engine.browser.ts \
  STAGE28B-README.md

git commit -m "Stage 28B: add opt-in experimental engine browser controls"
git push origin feature/stage27-engine-foundation
```

**Do not merge to main or deploy to webfant2 yet.** No production settings should contain `SHUFFLE_EXPERIMENTAL_ENGINE=1` until the engine is ready and separately reviewed.

## Limitations and follow-up

- Refresh currently polls every 2.5 seconds when visible; priority changes are not instantaneous for the other browser.
- No automatic draws, mana, spell casting, cost validation, combat, or stack resolutions in browser mode yet.
- Experimental engine libraries snapshot the loaded decks at initialization; changing manual decks later does not change experimental state.
- The experimental state is persisted by the Stage 28A actor, independent of the manual tabletop.
- Future work: use engine-specific actor notifications rather than polling; reconcile engine card identity with the existing UI before any automated card moves.
