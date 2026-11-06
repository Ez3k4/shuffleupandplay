"""Compatibility entry point: the Stage 24B browser check supersedes Stage 24.

Run: python3 test/stage24-planeswalker-browser.py
"""
from pathlib import Path
from runpy import run_path

run_path(str(Path(__file__).with_name('stage24b-browser.py')), run_name='__main__')
