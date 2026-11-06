"""Stage 24C: real Chromium layout and native rules panel interaction.

Run: python3 test/stage24c-browser.py
Requires Python Playwright + Chromium. No server or downloads needed.
"""
import re
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
css = (ROOT / 'public/application.css').read_text()
page_src = (ROOT / 'src/server/render/pages.ts').read_text()
# Read the actual guide HTML from the TypeScript page template.
match = re.search(r'(<details class="stage24c-rules"[\s\S]*?</details>)', page_src)
assert match, 'Missing Rules panel'
rules = match.group(1)


def seat(kind):
    return f'''<section class="player-section {kind}">
      <div class="zone-summary"><div class="zone-summary-player">Alice</div></div>
      <div class="battlefield"><div class="battlefield-canvas">
        <div class="compact-special-lanes"><div class="stage7-land-zone"><div class="stage7-land-row">
          <div class="stage7-land-stack"><div class="battlefield-card stage7-land-card land">Land</div></div>
        </div></div></div></div></div>
      <div class="stage12-planeswalker-area"><span class="stage12-planeswalker-label">Planeswalkers</span>
       <div class="stage7-land-zone"><div class="stage7-land-row"><div class="stage7-land-stack">
         <div class="battlefield-card stage7-land-card stage24b-full-planeswalker walker"><img alt="Planeswalker" /></div>
       </div></div></div></div>
    </section>'''


def html(styles):
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{styles}
      body{{margin:0;background:#0c1115}}
      main.layout{{width:100vw;height:100dvh;max-width:none;padding:4px;box-sizing:border-box}}
      main.layout > .board-layout{{height:calc(100dvh - 65px);min-height:0}}
      main.layout .main-table{{height:100%;padding:0}}
      #players-area[data-stage16-players]{{height:100%;width:100%;display:grid;grid-template-rows:repeat(2,minmax(0,1fr));position:relative}}
      #players-area > .stage16-opponent-panel,#players-area > .local-component{{height:100%;min-height:0}}
      #players-area > .stage16-opponent-panel > .player-section,#players-area > .local-component > .player-section{{height:100%;min-height:0}}
      </style></head><body>
      <main class="layout" data-game="true">
       <div class="compact-tabletop-toolbar" data-compact-toolbar-shell>
        <details class="compact-toolbar-details"><summary>Table tools</summary><div class="compact-toolbar-content">Tools</div></details>
        <div id="component-opponentRoster"><div class="stage16-opponent-roster">
         <button class="stage16-opponent-choice stage16-active" data-stage16-select-seat="2">Bob 40 ♥</button>
         <button class="stage16-opponent-choice" data-stage16-select-seat="3">Carol 40 ♥</button>
        </div></div>
        {rules}
       </div>
       <div class="board-layout"><section class="main-table"><div id="players-area" data-stage16-players>
       <div class="stage16-opponent-panel">{seat('opponent-seat')}</div>
       <div class="local-component">{seat('your-seat')}</div>
       </div></section></div>
      </main></body></html>'''


def bounds(page, selector):
    return page.locator(selector).first.bounding_box()


def overlap(a, b):
    return a['x'] < b['x'] + b['width'] and b['x'] < a['x'] + a['width'] and a['y'] < b['y'] + b['height'] and b['y'] < a['y'] + a['height']


with sync_playwright() as p:
    executable = shutil.which('chromium')
    browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
    try:
        for width, height in [(1280, 800), (860, 700), (390, 720)]:
            tab = browser.new_page(viewport={'width': width, 'height': height})
            tab.set_content(html(css), wait_until='domcontentloaded')
            roster = bounds(tab, '#component-opponentRoster')
            button = bounds(tab, '.stage24c-rules > summary')
            assert button['width'] < 100, ('Rules button not compact', width, button)
            assert abs((roster['y'] + roster['height']/2)-(button['y']+button['height']/2)) < 40, ('Rules not beside names', width, roster, button)
            assert not overlap(roster, button), ('Rules overlaps roster', width)
            tab.locator('.stage24c-rules > summary').click()
            assert tab.locator('.stage24c-rules').evaluate('(e) => e.open'), ('Rules did not open', width)
            panel = bounds(tab, '.stage24c-rules-panel')
            assert panel['x'] >= -1 and panel['x'] + panel['width'] <= width + 1, ('Rules clipped horizontally', width, panel)
            assert panel['height'] < height, ('Rules too tall', width, panel)
            tab.locator('.stage24c-rules > summary').click()
            assert not tab.locator('.stage24c-rules').evaluate('(e) => e.open')
            for role in ('opponent-seat', 'your-seat'):
                walker = bounds(tab, f'.{role} .walker')
                land = bounds(tab, f'.{role} .land')
                assert not overlap(walker,land), ('Walker overlaps land', width, role, walker, land)
                assert tab.locator(f'.{role} .walker img').evaluate('(e) => getComputedStyle(e).objectFit') == 'contain'
            # Compare actual computed width against Stage24B CSS; all three
            # clamp branches must be 20% smaller, not merely the max width.
            older = browser.new_page(viewport={'width': width, 'height': height})
            older.set_content(html(css.split('/* ===== Stage 24C:')[0]),wait_until='domcontentloaded')
            neww = bounds(tab, '.your-seat .walker')['width']
            oldw = bounds(older, '.your-seat .walker')['width']
            assert abs(neww / oldw - .8) < .025, ('Walker scale mismatch', width, neww, oldw)
            print(f'PASS {width}x{height}: rules popup, mirrored land clearance, walker {oldw:.0f}→{neww:.0f}px')
            older.close()
            tab.close()
    finally:
        browser.close()
