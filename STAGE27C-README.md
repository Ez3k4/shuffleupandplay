# Stage 27C — Deterministic prototype effect resolution

## Scope

Stage 27C builds on the exact Stage 27B source and leaves the production
`GameRoom`, game API, database, `shuffle.js`, HTML, CSS and Podman settings alone.
The standalone rules engine now has a small, **data-only effect interpreter**.
This is **not** a working Magic card, spell-casting, damage or targeting system.

## Changes

- `src/engine/types.ts`: per-seat life totals (initially 20–20), a typed
  `PrototypeEffect` union (currently one variant, `CHANGE_LIFE`), and explicit
  `life_total_changed` / `stack_effect_resolved` events.
- `src/engine/commands.ts`: optional prototype effect on the existing
  `PROTOTYPE_ANNOUNCE_STACK_OBJECT` test command.
- `src/engine/effects.ts` (new): validate effect descriptors and apply a
  deterministic, immutable life-total change to a named player.
- `src/engine/stack.ts`: validate input before queueing; copy only recognized
  fields into the authoritative stack object (no references to caller data).
- `src/engine/priority.ts`: after both players pass, pop the top stack object;
  execute its effect if supplied; give priority to the active player again.
- `src/engine/reducer.ts`: initialize starting life totals.
- `test/engine/priority.test.ts`: update the Stage 27A initial-state fixture.
- `test/engine/effects.test.ts` (new): resolution timing, LIFO, validation,
  legacy placeholders, immutability, deterministic events and serialization.

The Stage 27B `guards.ts`, Stage 27A `turn.ts`, and Stage 27B `stack.test.ts`
remain unchanged.

## Example: life loss, *not* Magic damage

```ts
let state = createEngineState("alice", "bob")
const announced = applyEngineCommand(state, "alice", {
  type: "PROTOTYPE_ANNOUNCE_STACK_OBJECT",
  kind: "spell",
  description: "Bob loses 3 life (prototype)",
  effect: { type: "CHANGE_LIFE", playerId: "bob", delta: -3 },
})
if (!announced.accepted) throw new Error(announced.reason)
state = announced.state // lifeTotals is still [20, 20]

const alicePass = applyEngineCommand(state, "alice", { type: "PASS_PRIORITY" })
if (!alicePass.accepted) throw new Error(alicePass.reason)
const bobPass = applyEngineCommand(alicePass.state, "bob", { type: "PASS_PRIORITY" })
if (!bobPass.accepted) throw new Error(bobPass.reason)
state = bobPass.state // lifeTotals is now [20, 17]
```

Event order on successful resolution:
`priority_passed` → `stack_object_popped` → `life_total_changed` →
`stack_effect_resolved` → `priority_granted`. Unimplemented/Stage 27B
placeholders still produce `stack_effect_not_implemented`.

## Important limitations

- `CHANGE_LIFE` is *not* damage: no damage source, prevention, damage triggers,
  lifelink, deathtouch, commander damage or planeswalker/creature damage.
- Players losing at 0 or less life is **not** implemented. Life totals may go
  below zero for testing. A restricted prototype delta of ±1..1000 is accepted.
- No costs, mana, casting timing, legal targets, responses based on card data,
  triggered abilities, replacement effects, or priority exceptions.
- Initial 20 life is only a test default. Commander and other formats need
  their own starting-life configuration later.
- As in Stage 27B, synthetic commands must **never** be exposed via HTTP;
  otherwise a client could arbitrarily change anyone's life total. A real
  engine must construct validated effects from trusted card definitions.
- Never load Stage 27C state into a live game or migrate the production SQLite
  schema. Engine states are still prototype-only.

## Install on Fedora (feature branch only)

```bash
cd ~/Games/shuffleupandplay
git branch --show-current  # Expect feature/stage27-engine-foundation
git status --short         # Expect clean working tree
mkdir -p /tmp/mtg-stage27c
unzip -oq ~/Downloads/mtg-stage27c-effect-resolution.zip -d /tmp/mtg-stage27c

# READ-ONLY verification: checks SHA-256 against the exact Stage 27B files
python3 /tmp/mtg-stage27c/install-stage27c.py --repo "$PWD" --check

# CHANGES local files after successful validation
python3 /tmp/mtg-stage27c/install-stage27c.py --repo "$PWD"

git status --short
git diff -- src/engine/
```

If the installer refuses, do not overwrite files manually; it means you have
custom changes or a different stage version and we should review the diff.

## Testing

With the project's Node 24/pnpm environment:

```bash
pnpm exec vitest run test/engine
pnpm run typecheck
pnpm run build
```

Or use the user's existing local Podman build workflow:

```bash
# CHANGES local Podman image only, does not touch production
podman build --target build -t mtg-stage27c-test .

# READ-ONLY engine test mount, temporary container
podman run --rm \
  -v "$PWD/test/engine:/app/test/engine:ro,Z" \
  --entrypoint sh mtg-stage27c-test \
  -lc 'pnpm exec vitest run test/engine'
```

Review and commit on the feature branch only:

```bash
git add src/engine test/engine STAGE27C-README.md
git commit -m "Stage 27C: resolve deterministic prototype life effects"
git push -u origin feature/stage27-engine-foundation
```

This patch does **not** change the live instance on `webfant2`.
