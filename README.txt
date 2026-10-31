Shuffle Up and Play — Stage 3 library interactions and protected piles

This is a safe patch installer, NOT a replacement for your customized shuffle.js.
It updates the existing files in place:
    public/shuffle.js
    public/application.css

Requirements:
- Your local app already has the Stage 2 library peek feature (wireLibraryPeek).
- Run from the root of your repo, e.g. ~/Games/shuffleupandplay.
- Python 3; Node.js optional for the pre-write syntax check.

Steps:
    cd ~/Games/shuffleupandplay
    git status
    python3 install_stage3.py
    podman stop mtg-tabletop
    podman build -t mtg-tabletop .
    # Run with your previous podman run command.

The installer:
- refuses changes if the expected source patterns are missing
- backs up the exact originals to stage3-backup/
- never changes saved games, database files or backend game logic

Features:
- left-click own library: draw one card
- right-click own library: Look at top X, Search library, Shuffle library
- existing graveyard/exile searches are unchanged
- prevents battlefield card placements overlapping the three zone piles
- dragging cards draw above the piles while in motion

Note: "Look at top X" is read-only. Full Scry X (reordering/top/bottom)
requires server-side library-order actions and is not part of this patch.

If the script refuses to patch, share your current public/shuffle.js for a
source-specific adjustment. Do not overwrite your customized file with upstream.
