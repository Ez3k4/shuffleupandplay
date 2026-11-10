# Stage 27A — Engine foundation (isolated prototype)

This patch adds only `src/engine/` and `test/engine/` plus this note.
No existing files are overwritten. It does **not** change the running tabletop,
networking, persistence, CSS, or UI. It is not a complete Magic rules engine.

## Contents

- `types.ts` — minimal two-player engine state, priority windows and stack placeholders
- `commands.ts` — player intention: `PASS_PRIORITY`
- `turn.ts` — progression through modeled priority windows
- `priority.ts` — pass validation, hand-off and two-pass behavior
- `reducer.ts` — deterministic state initialization and command entrypoint
- `test/engine/priority.test.ts` — unit tests

## Limitations intentionally left for later stages

- The first modeled window is upkeep; untap and cleanup are not implemented.
- Passing through the draw step does not actually draw a card.
- Passing through combat steps does not declare attackers/blockers or deal damage.
- For now, two passes on a stack entry only **remove a test placeholder**;
  there is no spell resolution or effect execution.
- No first-turn draw exception, triggers, state-based actions, casting,
  priority granted by spell casting, or multiplayer beyond two players.
- There is no connection to `GameRoom`; the existing manual gameplay is untouched.

## Install (Fedora, from your feature branch)

```bash
cd ~/Games/shuffleupandplay
git status --short
# Ensure you are on feature/stage27-engine-foundation and working tree is clean.
unzip -n ~/Downloads/mtg-stage27a-engine-foundation.zip -d .
git status --short
```

`unzip -n` never overwrites existing files. If any Stage 27A paths existed
already, stop and inspect before proceeding.

## Run tests (Node.js 24 + pnpm)

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm exec vitest run test/engine/priority.test.ts
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

You can instead run the commands inside your existing containerized development
environment if Node/pnpm is not installed on Fedora. A fresh Podman image build
(`podman build -t mtg-tabletop:stage27a .`) checks packaging, but does **not**
run the unit test suite by itself.

## Commit after testing

```bash
git add src/engine test/engine STAGE27A-README.md
git commit -m "Stage 27A: add isolated turn and priority engine prototype"
git push -u origin feature/stage27-engine-foundation
```

Keep `main` and the deployed `webfant2` image unchanged until the larger engine
milestone has passed review.
