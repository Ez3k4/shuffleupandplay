"""Stage 17 browser interaction check superseded by Stage 18 UI.

The earlier check expected an in-card token-picker button, now deliberately
removed. Keep this entry point working for existing test workflows.
"""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("stage18-browser-smoke.py")), run_name="__main__")
