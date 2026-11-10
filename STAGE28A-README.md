# Stage 28A — Server adapter for the experimental rules engine

This patch is a **local-testing milestone, not a production feature**. It integrates
Stage 27D with the existing `GameRoom` actor and HTTP server without replacing
any of the manual tabletop UI, state, or browser logic.

## Stage 26C compatibility correction

This corrected release is built against the **actual four server files** exported
from the user's `feature/stage27-engine-foundation` checkout after Stage 26C.
The prior Stage 28A archive must not be used. Its `GameRoom` baseline lacked
`stampNewPendingSpells`, so the guarded installer correctly refused to apply it.

The corrected `GameRoom` keeps both existing lines unchanged:

- `import { stampNewPendingSpells } from "../game/stack-order.ts"`
- The `stampNewPendingSpells({ before: player, after: updated, roomVersion: room.version })`
  call and its `sequenced` result used in `applyAction()`.

The other three modified files (`app.ts`, `main.ts`, `test/support/server.ts`)
exactly matched the original Stage 28A baseline. No other manual-tabletop
files are patched. The installer additionally verifies the Stage 27D engine
module hashes, and refuses to overwrite anything unexpected.

Use the corrected archive `mtg-stage28a-server-integration-26c-fix.zip` and
extract it into a new `/tmp/mtg-stage28a-fixed/` directory. Follow the test
commands below, not the stale archive's install location.

## Scope

- New `GameRoom.experimentalEngine` actor state (migrated from actor schema 7 to 8),
  persisted alongside the *independent* manual room.
- Two-player experimental engine initialization by **seat 1 only**, after **both
  decks are loaded**. The engine seeds libraries from trusted server-side deck
  data, and never trusts card definitions submitted from the browser.
- Seat-checked `PASS_PRIORITY` command only. **Prototype draw, zone-move,
  stack-object creation, and arbitrary life effects are deliberately NOT
  accessible over HTTP.** They are not proper Magic rules yet.
- Redacted player-specific view: no raw `EngineState`, internal events,
  unplayed stack effects, opponent hand identities, or library identities.
- Explicit opt-in feature flag: `SHUFFLE_EXPERIMENTAL_ENGINE=1`. OFF by default.
- HTTP tests, actor tests (including restart persistence), and view tests.
- The manual `GET /api/tables/:code/state` and all manual actions remain intact.

## API (only when feature flag is enabled)

| Method | Path | Result |
|---|---|---|
| GET | `/api/tables/:code/engine` | Redacted inactive/active view for seated player |
| POST | `/api/tables/:code/engine/start` | Initialize once; only room host; requires both decks |
| POST | `/api/tables/:code/engine/priority` | Pass priority; only current priority holder |

POST requests require `Content-Type: application/json` and **empty `{}` body**.
Experimental endpoints are not available unless the flag is enabled. These
requests use the existing session cookie and room membership model.

**No experimental browser UI yet.** Stage 28B will add a minimal interface to
create and interact with this mode using the existing tabletop UI.

## Installation

Run from a clean checkout on `feature/stage27-engine-foundation` with Stage 27D
already committed. First download/extract the ZIP outside the repository:

```bash
cd ~/Games/shuffleupandplay
mkdir -p /tmp/mtg-stage28a-fixed
unzip -oq ~/Downloads/mtg-stage28a-server-integration-26c-fix.zip -d /tmp/mtg-stage28a-fixed
python3 /tmp/mtg-stage28a-fixed/install-stage28a.py --repo "$PWD" --check
python3 /tmp/mtg-stage28a-fixed/install-stage28a.py --repo "$PWD"
```

Installer checks SHA-256 baselines of every modified file and every Stage 27D
engine dependency. It refuses to clobber unrelated edits, unexpected files,
or symlink destinations. Re-running it is safe.

## Tests on Fedora (Podman)

```bash
# Local build/test image only; never touches webfant2.
podman build --target build -t mtg-stage28a-test .

# Build stage intentionally lacks the source test/public trees; mount read-only.
podman run --rm \
  -v "$PWD/test:/app/test:ro,Z" \
  -v "$PWD/public:/app/public:ro,Z" \
  --entrypoint sh mtg-stage28a-test \
  -lc 'pnpm exec vitest run test/engine test/game-room.test.ts test/server.test.ts test/restart.test.ts'

# Check project TypeScript with the test tree mounted too.
podman run --rm \
  -v "$PWD/test:/app/test:ro,Z" \
  -v "$PWD/public:/app/public:ro,Z" \
  --entrypoint sh mtg-stage28a-test \
  -lc 'pnpm run typecheck'
```

If the build stage has no `public/`, the second mount ensures the existing app's
browser asset tests can find it. If the complete suite fails on unrelated
legacy tests, record which file/case failed before changing code.

## Optional: isolated local API exercise

By default, even a running server will return 404 for `/engine`. To opt in for
local tests only, start a separate container that sets
`SHUFFLE_EXPERIMENTAL_ENGINE=1` and uses **its own test database/volume**.
Do **not** add this flag to your production `container.env` yet.

In two browser sessions, create a two-player table and load both decks using
normal controls. Once both decks are loaded, open the host's browser console:

```js
const code = location.pathname.split('/').pop()
await (await fetch(`/api/tables/${code}/engine`, { credentials: 'same-origin' })).json()
await (await fetch(`/api/tables/${code}/engine/start`, {
  method: 'POST', credentials: 'same-origin',
  headers: { 'content-type': 'application/json' }, body: '{}'
})).json()
await (await fetch(`/api/tables/${code}/engine/priority`, {
  method: 'POST', credentials: 'same-origin',
  headers: { 'content-type': 'application/json' }, body: '{}'
})).json()
```

The opponent can open the same GET endpoint in their own session to see the
opposite redacted view. Priority passes should be reflected in both GETs.
These actions **do not tap, move, or draw cards in the existing manual UI**.

## Review / commit

```bash
git status --short
git diff --check
git add src/actors/game-room.ts src/server/app.ts src/main.ts src/engine/server-view.ts \
  test/support/server.ts test/engine/server-view.test.ts \
  test/engine/game-room-adapter.test.ts test/engine/experimental-http.test.ts \
  STAGE28A-README.md
git commit -m "Stage 28A: persist isolated experimental engine behind protected API"
git push -u origin feature/stage27-engine-foundation
```

## Known limitations

- Only the basic 27A turn/priority prototype works. The prototype does **not**
  implement untap, draw-step rules, combat, casting, costs, or real card effects.
- Loading a new deck later or manually moving cards does not change the separate
  experimental engine state. The library is a snapshot taken at initialization.
- Hidden-info projection assumes that battlefield/graveyard/exile objects are
  face-up; advanced visibility and actor raw-snapshot access must be audited
  before adding face-down cards or sharing live matches more widely.
- Opening hands are not dealt automatically. No way to reset the experiment
  without creating a new room yet.
- No production deployment is recommended at this stage.

## Verification note

The engine modules and the new restricted view passed TypeScript compilation
and 69 checks in a minimal local assertion harness. The full project requires
Solid Objects, SQLite WASM, Vitest, and Node.js 24; those dependencies are not
available in the patch-creation environment. **The Podman integration tests
above must pass on your Fedora machine before you commit or deploy.**
