# Stage 28E — One server-authoritative land play per turn

This patch adds **Play land (engine)** to the experimental UI and connects it to the
existing `GameRoom` and normal tabletop battlefield rendering. Stage 28D's
atomic drawing mechanism is unchanged; manual tabletop controls still work.

## New behavior

- The active player may play **one land from their hand** per turn during
  `precombat_main` or `postcombat_main`, **with priority** and an **empty stack**.
  No mana cost is required to play a land.
- The server identifies lands from the imported card metadata (`isLand` or
  `typeLine`). A card without type information is rejected, not guessed.
  If old imported decks don't contain land metadata, **reimport the deck**.
- The user chooses a land from their own hand in the experimental panel. The
  server checks that it exists in the authenticated player's hand.
- The manual tabletop `playFromHand` handler gives the real card a battlefield
  position. The engine's `PROTOTYPE_MOVE_CARD` updates the same linked card ID.
  Both changes are prepared and checked before being persisted by one actor
  operation. The room version increments exactly once.
- A persisted optional engine field `landPlayedTurnByPlayer` records the turn
  on which a land was played. There is **no separate editable client counter**.
- Each POST requires a valid session, `Idempotency-Key`, and
  `expectedRoomVersion`, reusing Stage 28D's duplicate-request safeguards.
- Opponents never receive the list of cards available to play from your hand.
- If a manual action changed the deck, zones or card identity since the
  experiment began, the server refuses the automated action.

**This is not yet a full Magic rules engine.** Additional land plays granted
by abilities, replacement effects, face-down cards, and unusual type-changing
cards aren't supported. The experimental engine starts with loaded decks and
an empty hand: use the Stage 28D Draw 1 button to put a land in hand, then pass
priority through upkeep and draw to the precombat main phase.

## Install (Fedora)

Work on `feature/stage27-engine-foundation`, with Stage 28D already committed:

```bash
cd ~/Games/shuffleupandplay
git status --short
mkdir -p /tmp/mtg-stage28e
unzip -oq ~/Downloads/mtg-stage28e-atomic-land-play.zip -d /tmp/mtg-stage28e
python3 /tmp/mtg-stage28e/install-stage28e.py --repo "$PWD" --check  # READ-ONLY
python3 /tmp/mtg-stage28e/install-stage28e.py --repo "$PWD"          # WRITES PATCH
```

The guarded installer checks source anchors and a Stage 28D dependency hash;
any mismatch causes refusal before file writes. It does not replace
`public/application.css`, `public/shuffle.js` or database files.

## Run tests

```bash
podman build --target build -t mtg-stage28e-test .
podman run --rm \
  -v "$PWD/test:/app/test:ro,Z" \
  -v "$PWD/public:/app/public:ro,Z" \
  --entrypoint sh mtg-stage28e-test \
  -lc 'pnpm run typecheck && pnpm exec vitest run test/engine test/game-room.test.ts test/server.test.ts test/restart.test.ts'
```

The tests cover card identification, timing, stack, priority, per-turn limit,
retries, stale room versions, privacy and keeping the card bridge synchronized.

## Test in two browsers locally

```bash
podman build -t mtg-tabletop:stage28e .
podman run -d --name mtg-stage28e-local \
  -p 127.0.0.1:3004:3000 \
  -e "SHUFFLE_SECRET=$(openssl rand -hex 32)" \
  -e SHUFFLE_EXPERIMENTAL_ENGINE=1 \
  mtg-tabletop:stage28e
podman logs --tail 25 mtg-stage28e-local
```

Open `http://127.0.0.1:3004`. Use a normal and private browser session to
create and join a **new two-player table**. Load decks that include lands and
proper `isLand`/`typeLine` metadata.

1. Start the engine. Click **Draw 1 (engine)** until a land is in hand.
2. While in upkeep or draw step, **Play land (engine)** must be disabled.
3. Pass priority with both players through upkeep and draw to **Precombat main**.
4. The active player selects a land and clicks **Play land (engine)**.
5. Verify the real battlefield gains exactly that land; the hand loses it;
   **Card link** still reads `N cards linked` on both screens.
6. **Play land (engine)** must now be disabled for that player through the
   remainder of the turn, including second main phase.
7. The opponent must not see the active player's private hand or land options.
8. A manual card move should still cause the bridge's **Out of sync** warning,
   and the automated land play must then refuse to proceed.

Optional Playwright Chromium test:

```bash
SHUFFLE_EXPERIMENTAL_ENGINE=1 pnpm exec playwright test test/browser/engine-land.browser.ts
```

When finished:

```bash
podman stop mtg-stage28e-local
podman rm mtg-stage28e-local
```

## Commit after all tests pass

```bash
git diff --check
git add src/actors/game-room.ts src/server/app.ts src/server/render/pages.ts \
  public/experimental-engine.js test/game-room.test.ts \
  src/engine/authoritative-land.ts test/engine/authoritative-land*.ts \
  test/engine/land-ui.test.mjs test/browser/engine-land.browser.ts \
  STAGE28E-README.md
git diff --cached --stat
git commit -m "Stage 28E: add atomic once-per-turn experimental land play"
git push origin feature/stage27-engine-foundation
```

Leave `SHUFFLE_EXPERIMENTAL_ENGINE` disabled on the production server. Stage
28F can begin connecting mana generation, but should first add rules and
regressions for reliable land tapping and mana pools.
