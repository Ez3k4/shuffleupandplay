# MTG Tabletop — Customized Shuffle Up and Play

A self-hostable, two-player **Magic: The Gathering** tabletop based on [Shuffle Up and Play](https://github.com/cardmagic/shuffleupandplay). It is designed for playing real games remotely with a shared board, Archidekt decks and mostly manual card interactions—without requiring a full MTG rules engine.

This repository is a customized version of the original application. The features below describe the tabletop after the incremental local modifications through **Stage 11E**. Some installations may differ if an optional patch (such as drag-to-attach) was not applied.

> **Project status:** Personal / experimental. Tested primarily on Fedora with rootless Podman and Firefox. Not yet hardened as a public internet service.

## Features

### Multiplayer and decks

- Two-player tables with shareable invitation links and live synchronization.
- Separate player seats; an opponent's hand and library contents remain private.
- Import decks through the public **Archidekt** API, with card information and art from **Scryfall**.
- Persistent game state backed by SQLite on the server.

### Tabletop and card interactions

- Vertically stacked, mirrored battlefields with the opponent above and the current player below.
- Responsive battlefield coordinates and a reserved area for card piles; cards cannot normally be dropped behind these controls.
- **Arena-style hand:** only the upper portion of cards is visible until hover; cards rise to reveal their artwork.
- **Adaptive nonland card sizing:** large for 1–6 ordinary permanents, then smaller at 7, 10, 13, 16, etc. Cards resize by tier, not after every draw.
- Drag to position cards, tap/untap them, add counters and use right-click card actions.
- Compact, floating context menu with **Move to another zone** actions.
- Enlarged card preview on hover, including in searchable zone dialogs.
- Life counter beside each player's name; **Untap All** available on your battlefield.

### Library, hand and other zones

- **Left-click Library:** draw a card.
- **Right-click Library:** access actions such as looking at the top X cards, searching and shuffling.
- Separate, compact **Library**, **Graveyard** and **Exile** piles.
- Searchable Graveyard/Exile inspectors and a read-only top-of-library peek; owners can move selected cards using available actions.
- Card counts and zone changes synchronize between players.

### Lands and attachments

- Dedicated land area, positioned separately from ordinary battlefield permanents.
- Identical lands are **stacked visually**, but each copy retains its own identity and tapped status.
- Individual lands in a stack can be tapped, untapped or moved to other zones.
- Equipment/Auras can be **attached or unlinked** using the right-click menu; multiple attachments are staggered behind the host and follow it when it moves.
- **Optional Stage 8B:** drag an Equipment/Aura onto a valid permanent, hold briefly, then release to attach; Shift-drag is a fallback for older imported cards. Availability depends on which local patches were applied.

### Opening hand and Commander

- Opening-hand workflow with **London mulligans**, a selectable free-first-mulligan option, and ordered bottom-of-library selection.
- One manually selected **Commander** per player in a dedicated command-zone slot.
- Play the Commander from its zone, return it there, or **change the selected Commander** before continuing (after returning it to the command zone if necessary).
- Opponent's command-zone slot is positioned away from their Library/Graveyard/Exile piles.

## What is **not** automated

This is intentionally a **manual tabletop**, not a comprehensive MTG rules engine.

- No full legality checks, priority system, triggered-ability resolution or automatic combat/damage resolution.
- **No automatic mana pool, colored-mana selection or spell payment** yet.
- No automatic commander tax, partner/background support or commander eligibility validation.
- Equipment/Aura attachment legality is not fully validated; the initial attachment workflow primarily supports permanents you control.
- Cards resize automatically but are **not automatically rearranged** into rows when the board gets crowded.
- The browser-side SQLite OPFS SAH pool may report a capacity warning after many tables. We have deferred that issue while ordinary online gameplay remains functional.

## Requirements

- A Linux computer with [Podman](https://podman.io/) (tested using **rootless Podman on Fedora**).
- Git to manage the source (optional when already checked out).
- A browser such as Firefox.
- Internet access for Archidekt imports and Scryfall card images.
- For direct development without Podman: **Node.js 24** and `pnpm` (see the original project's setup instructions).

The image build installs the JavaScript dependencies inside the container; **Node.js does not have to be installed on the Fedora host**.

## Local run with Podman

The following commands use the existing checkout at `~/Games/shuffleupandplay`. The image is called `mtg-tabletop`, the container is called `mtg-tabletop`, and the persistent volume is called `mtg-tabletop-data`.

### 1. Build the image

```bash
cd ~/Games/shuffleupandplay
podman build -t mtg-tabletop .
```

This compiles the TypeScript server and packages the application. It does **not** start a container or delete saved games.

### 2. Create a persistent session secret (once)

```bash
mkdir -p "$HOME/.config/mtg-tabletop"
chmod 700 "$HOME/.config/mtg-tabletop"

# Run only once. Keep this file across container rebuilds.
umask 077
printf 'SHUFFLE_SECRET=%s\nNODE_ENV=development\nPORT=3000\n' \
  "$(openssl rand -hex 32)" \
  > "$HOME/.config/mtg-tabletop/container.env"
```

`SHUFFLE_SECRET` signs the browser session cookie. Keep it **stable**: regenerating it invalidates existing signed sessions. The file is stored outside the repository so that the secret is not accidentally committed to Git. `NODE_ENV=development` is suitable for local HTTP testing; use `production` only with correctly configured HTTPS.

If you already use a stable `SHUFFLE_SECRET`, retain it instead of generating a new one.

### 3. Create the storage volume and start

```bash
podman volume create mtg-tabletop-data

podman run -d \
  --name mtg-tabletop \
  -p 127.0.0.1:3000:3000 \
  --env-file "$HOME/.config/mtg-tabletop/container.env" \
  -v mtg-tabletop-data:/app/storage:Z \
  mtg-tabletop
```

- `-d` runs the container in the background.
- `127.0.0.1:3000:3000` exposes the app **only on the Fedora host** (not on the LAN or internet).
- `--env-file` loads the same session secret every time.
- `-v ...:/app/storage:Z` stores SQLite data in a persistent Podman volume and labels the mount for SELinux.

Open **http://localhost:3000**. Create a table and open its invitation link in another Firefox profile/private window to test the second player seat. Each seat uses its own signed browser session.

### 4. Inspect and manage the container

```bash
podman ps                         # running containers
podman logs -f mtg-tabletop       # follow application logs
podman stop mtg-tabletop          # stop; data remains on the volume
podman start mtg-tabletop         # restart the existing stopped container
```

The server also exposes a health-check endpoint: `http://localhost:3000/up`.

### 5. Rebuild after changing the source

```bash
cd ~/Games/shuffleupandplay

podman stop mtg-tabletop
podman rm mtg-tabletop
podman build -t mtg-tabletop .

podman run -d \
  --name mtg-tabletop \
  -p 127.0.0.1:3000:3000 \
  --env-file "$HOME/.config/mtg-tabletop/container.env" \
  -v mtg-tabletop-data:/app/storage:Z \
  mtg-tabletop
```

Removing the **container** does not remove the named **volume**. Do **not** delete `mtg-tabletop-data` unless you intentionally want to discard the stored server data. Back up the volume before changing the database schema or deploying an experimental patch. Always use the same volume name and session secret when recreating the container.

If you previously ran the container with `--rm`, it may already have been removed when stopped; in that case, skip `podman rm` if Podman reports it does not exist.

## Playing with another person

1. Start the application and create a table.
2. Share the table invitation URL.
3. The other player opens the link in their own browser/session and chooses the second seat.
4. Both players load their decks, choose commanders if appropriate, complete opening hands and play manually.

**Localhost is not remotely accessible.** To play with someone outside your computer, deploy on a server (for example `webfant`) and expose it through an HTTPS reverse proxy or private Tailscale Serve endpoint with WebSocket support. Do not expose the application publicly without reviewing access control, secrets, transport security and backups.

## Project structure

```text
src/
  actors/             Game state and live synchronization
  archidekt/          Deck search/import
  game/               Card actions, player state, rules helpers
  server/render/      Server-rendered tabletop components
public/
  shuffle.js          Browser interactions, dragging, dialogs
  application.css     Responsive UI, card/zone styling
test/                  Upstream tests
Dockerfile             Container image build
MIT-LICENSE            Original software license
```

The customization was developed through incremental patch stages. Some historical installer scripts and `stage*-backup/` folders may exist in a development checkout; these are not needed to run the finished container. Review and consolidate changes before publishing or making a production release.

## Licensing and attribution

This project is derived from **[Shuffle Up and Play](https://github.com/cardmagic/shuffleupandplay)**, originally created by **Lucas Carlson**. The original software is distributed under the **MIT License**. Preserve its copyright notice and `MIT-LICENSE` file when redistributing this modified software.

**Magic: The Gathering** and related card artwork and trademarks belong to Wizards of the Coast. This is an unofficial fan project, not affiliated with or endorsed by Wizards of the Coast. Card images are supplied through Scryfall; deck import uses Archidekt's public API. The original software license does **not** grant rights to third-party card art or trademarks. Review the relevant fan-content and image-usage policies before public hosting.

## Acknowledgments

- [Shuffle Up and Play](https://github.com/cardmagic/shuffleupandplay) — original tabletop and multiplayer engine.
- [Archidekt](https://archidekt.com/) — deck data and imports.
- [Scryfall](https://scryfall.com/) — card information and artwork.

