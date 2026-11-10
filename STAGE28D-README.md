# Stage 28D — First atomic experimental card draw

Stage 28D introduces a single server-authoritative **Draw 1 (engine)** button to
our existing Stage 28B/28C experimental panel. This is **still a prototype**;
normal manual gameplay and its drawing controls are unchanged.

## The key invariant

A draw is **one `GameRoom` operation**, not two independent HTTP requests:

1. Authenticate the caller using the existing signed session and `GameRoom`
   seat. Require that player to have priority in the experimental engine.
2. Check that the live manual tabletop and read-only engine snapshot are **in
   sync**. Reject if anyone has manually drawn, shuffled or moved a card since
   the experiment started, or if the unsupported zones are used.
3. Determine the next card from the *manual Room's authoritative library*.
   Cross-check its player-scoped stable instance ID with the engine top card.
4. Compute an engine `PROTOTYPE_DRAW_CARD` transition and the existing manual
   `applyPlayerAction({ type: "drawCard", count: 1 })` from the current states.
5. Validate that both changes refer to the same card, and that the resulting
   representations still agree. **Only then** persist both inside one actor
   operation, advancing the room version once.
6. Return only the existing player-specific engine projection; no raw library
   or opponent hand data is transmitted.

The new route is `POST /api/tables/:code/engine/draw`, available **only** when
`SHUFFLE_EXPERIMENTAL_ENGINE=1`. It requires a **JSON `{ "expectedRoomVersion": <version> }` body** and
`Idempotency-Key` header (8–128 allowed characters), scoped by session. The JSON body contains **only** a safe integer `expectedRoomVersion` from the last engine view. Commands with a stale version are rejected (HTTP 409). This
uses the existing Solid Objects actor idempotency mechanism used for manual
moves. A retry with the same key must not consume another card.

No card ID, deck order, or player ID is accepted in the draw request body.

## Limitations

- Still no mana, casting, targets, combat, draw-step automation or empty-library
  loss condition. Drawing is an **explicit experimental button** action, not
  a legal card effect, and requires priority. It is not restricted to the
  actual draw step yet.
- Manual Draw remains manual. If used while the engine is running, it creates
  the expected **Out of sync** warning; the experimental draw will refuse to
  proceed. Start a new table to reset your experiment.
- Commander zone, pending spells and foreign-controlled permanents remain
  outside this prototype's card model.
- The real tabletop is still authoritative for card contents and order; the
  prototype engine tracks the corresponding card zones but cannot directly
  modify cards outside this one validated actor operation.
- Keep the feature disabled on the hosted production VM.

## Installation on Fedora

From a clean `feature/stage27-engine-foundation` branch, with Stage 28C committed:

```bash
cd ~/Games/shuffleupandplay
git branch --show-current
git status --short

mkdir -p /tmp/mtg-stage28d
unzip -oq ~/Downloads/mtg-stage28d-atomic-draw.zip -d /tmp/mtg-stage28d

# READ-ONLY verification; fail closed on unexpected changes
python3 /tmp/mtg-stage28d/install-stage28d.py --repo "$PWD" --check

# WRITES only the enumerated source and test files
python3 /tmp/mtg-stage28d/install-stage28d.py --repo "$PWD"
```

This guarded, additive installer checks required Stage 28C code anchors and
refuses conflicting structural differences. It preserves unrelated local edits. It **does not** overwrite `public/application.css`,
`public/shuffle.js` or production data. If it refuses, do not force install;
provide the conflicting file to rebase the patch safely.

## Automated tests

```bash
podman build --target build -t mtg-stage28d-test .

podman run --rm \
  -v "$PWD/test:/app/test:ro,Z" \
  -v "$PWD/public:/app/public:ro,Z" \
  --entrypoint sh mtg-stage28d-test \
  -lc 'pnpm run typecheck && pnpm exec vitest run test/engine test/game-room.test.ts test/server.test.ts test/restart.test.ts'
```

New tests include the pure planner, actor persistence/authorization, HTTP
idempotency and privacy, and enabled/disabled draw button logic. The existing
Stage 28A–28C regression tests should still pass.

## Browser test in an isolated local Podman container

```bash
# Build the *runtime* image locally, not on the production VM.
podman build -t mtg-tabletop:stage28d .

# Ephemeral storage and local-only host port; production is not touched.
podman run -d --name mtg-stage28d-local \
  -p 127.0.0.1:3003:3000 \
  -e "SHUFFLE_SECRET=$(openssl rand -hex 32)" \
  -e SHUFFLE_EXPERIMENTAL_ENGINE=1 \
  mtg-tabletop:stage28d

podman logs --tail 25 mtg-stage28d-local
```

Open `http://127.0.0.1:3003` in Firefox, create a new two-player table, and
join from a **private browsing session**. Load both decks. Open **🧪 Engine**;
host starts the test. When the bridge is synced and you have priority, click
**Draw 1 (engine)**. Verify that your existing visual hand increases by one,
your library decreases by one, and both panels continue to say `cards linked`.
Pass priority to the opponent. They should be able to draw with their own
button and your hand card faces should remain hidden on their screen.

For the stale-state rejection test, manually draw one more card and confirm the
engine says **Out of sync** and disables its own Draw button. Priority passing
should remain available. Repeat from a new table to re-test a clean bridge.

Optional browser automation (Playwright Chromium required):

```bash
SHUFFLE_EXPERIMENTAL_ENGINE=1 pnpm exec playwright test test/browser/engine-draw.browser.ts
```

Stop and remove the local container:

```bash
podman stop mtg-stage28d-local
podman rm mtg-stage28d-local
```

## Commit after tests succeed

```bash
git diff --check
git status --short
# Review changes in VS Code Source Control before staging.
git add src/engine/authoritative-draw.ts src/actors/game-room.ts \
  src/server/app.ts src/server/render/pages.ts public/experimental-engine.js \
  test/game-room.test.ts test/engine/authoritative-draw*.ts \
  test/engine/draw-ui.test.mjs test/browser/engine-draw.browser.ts \
  STAGE28D-README.md

git diff --cached --check
git commit -m "Stage 28D: add atomic experimental draw through GameRoom"
git push origin feature/stage27-engine-foundation
```

**Do not deploy this experimental implementation to webfant2 yet.**
