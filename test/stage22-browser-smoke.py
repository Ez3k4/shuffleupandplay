"""Compatibility entrypoint: Stage 22 token picker was replaced by Stage 23 global search.
Runs the current browser interaction test instead of the obsolete deck-only UI test.
"""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('stage23-browser-smoke.py')), run_name='__main__')
