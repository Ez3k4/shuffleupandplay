# Stage 27B — Typed stack commands and events (isolated prototype)

**Scope:** Build on Stage 27A, without touching the existing tabletop UI, live
`GameRoom`, network endpoints, or SQLite schema. This is deliberately *not* an
implementation of casting spells or activating actual card abilities.

## What changed

- `src/engine/types.ts`: a typed `StackObject` with `id`, `kind`, `controllerId`,
  `description`; monotonic `nextStackObjectNumber` stored in state; explicit
  stack-related events; rejection type for invalid stack input.
- `src/engine/commands.ts`: `PROTOTYPE_ANNOUNCE_STACK_OBJECT` command for test
  spells and activated-ability placeholders; no player-triggered abilities.
- `src/engine/guards.ts`: centralizes the priority-holder authorization rule.
- `src/engine/stack.ts`: queues synthetic objects, allocates deterministic IDs,
  assigns controller from the authenticated player argument, clears prior passes.
- `src/engine/priority.ts`: after two passes, takes the top object off the
  stack, explicitly emits `stack_effect_not_implemented`, and gives priority
  to the active player. **No real card effect is applied.**
- `src/engine/reducer.ts`: dispatches the new command and sets the ID counter.
- `test/engine/priority.test.ts`: adjusts Stage 27A fixtures for the new types.
- `test/engine/stack.test.ts`: new tests for ordering, authorization, invalid
  commands, ID uniqueness, deterministic events, and unchanged input state.

Stage 27A `src/engine/turn.ts` is unchanged.

## The command/event contract

```ts
const state = createEngineState("alice", "bob")

const result = applyEngineCommand(state, "alice", {
  type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT",
  kind: "spell",
  description: "Example spell",
})

// result.accepted === true
// result.state.stack[0].id === "stack-1"
// result.events includes stack_object_added and priority_granted
```

`playerId` must eventually come from the authenticated seat, not from a
client-supplied JSON field. The prototype command is intentionally not exposed
through the existing HTTP API.

Priority behavior (for two players):

1. When Alice adds a stack placeholder, Alice retains priority and the pass
   counter resets to 0.
2. Alice passes; Bob gets priority (counter = 1).
3. Bob may add a response on top; Bob retains priority and the counter resets.
4. Bob passes, then Alice passes: Bob's response is *popped first*.
5. `stack_effect_not_implemented` makes clear that no damage, drawing, etc.
   occurred. Alice (the active player) receives priority.
6. Another pair of passes pops Alice's object. A further pair on the now-empty
   stack advances the modeled priority window.

This is a transition-result model, **not** event sourcing: current state is the
source of truth, while events describe transitions for future UI/diagnostics.

## Safety and limitations

- No mana, legality checks, targets, costs, card ownership, or spell effects.
- No triggered-ability handling; triggered abilities are reserved as a kind
  but cannot be announced by the prototype player command.
- No networking, persistence integration, animations, or production-game changes.
- The Stage 27A simplified turn/priority windows remain incomplete: untap,
  cleanup, actual draws, combat, state-based actions and other special Magic
  timing rules are not implemented.
- Stack IDs are unique **within a single EngineState's lifetime** via a
  monotonically increasing counter. This does not yet define a complete global
  card/object identity scheme.
- Future APIs must have a proper runtime command parser, authentication,
  command versioning, and legal action validation before allowing clients to
  access engine commands.

## Installation (Fedora)

Run from your already-created `feature/stage27-engine-foundation` branch. Please
commit Stage 27A before installing Stage 27B so the diff is easy to review.

```bash
cd ~/Games/shuffleupandplay
# READ-ONLY checks
git branch --show-current
git status --short

# Extract the ZIP *outside* the repository
mkdir -p /tmp/mtg-stage27b
unzip -oq ~/Downloads/mtg-stage27b-stack-model.zip -d /tmp/mtg-stage27b

# READ-ONLY: refuse changes if your Stage 27A files differ
python3 /tmp/mtg-stage27b/install-stage27b.py --repo "$PWD" --check

# WRITES files: install the patch only after the check passes
python3 /tmp/mtg-stage27b/install-stage27b.py --repo "$PWD"

git status --short
git diff --stat
git diff -- src/engine/reducer.ts src/engine/priority.ts
```

The installer checks SHA-256 against the exact Stage 27A files distributed
previously, and aborts without changing anything if it encounters edits,
missing files, or a collision with an unrelated file. It supports re-running
when all patched files already match Stage 27B. If it refuses to install,
**do not force-overwrite**; inspect the differences and merge intentionally.

## Test in your existing Podman workflow

```bash
# WRITES local image only; does not start or change production
podman build --target build -t mtg-stage27b-test .

# READ-ONLY repository mount; runs both engine test suites
podman run --rm \
  -v "$PWD/test/engine:/app/test/engine:ro,Z" \
  --entrypoint sh mtg-stage27b-test \
  -lc 'pnpm exec vitest run test/engine/priority.test.ts test/engine/stack.test.ts'
```

If you have Node.js >=24 and pnpm installed locally, instead run:

```bash
pnpm exec vitest run test/engine/priority.test.ts test/engine/stack.test.ts
pnpm run typecheck
pnpm test
pnpm run build
```

`podman build --target build` runs the project's production TypeScript build.
The complete `pnpm test` suite is best run where all repo test files are
available; the container command above mounts only the engine test directory.

## Commit and push the feature branch (not main)

```bash
git add src/engine test/engine STAGE27B-README.md
git commit -m "Stage 27B: add typed prototype stack commands and events"
git push -u origin feature/stage27-engine-foundation
```

Nothing in this ZIP changes the Podman service on `webfant2`.
