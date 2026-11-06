"""Browser geometry regression for full-image Planeswalkers beside land stacks.

Run: python3 test/stage24b-browser.py
Needs Python Playwright with Chromium. No server/network/image download required.
"""
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
css = (ROOT / 'public/application.css').read_text()


def seat(kind: str, name: str) -> str:
    return f'''<section class="player-section {kind}">
      <div class="zone-summary">
        <div class="zone-summary-player"><strong>{name}</strong></div>
        <div class="zone-summary-life"><span>40</span></div>
      </div>
      <div class="battlefield"><div class="battlefield-canvas">
        <div class="battlefield-card compact-art-card normal" style="left:42%;top:24%">Normal creature</div>
        <div class="compact-special-lanes"><div class="stage7-land-zone"><div class="stage7-land-row">
          <div class="stage7-land-stack"><div class="battlefield-card stage7-land-card land"><img alt="Forest"></div></div>
        </div></div></div>
      </div></div>
      <div class="stage12-planeswalker-area"><span class="stage12-planeswalker-label">Planeswalkers</span>
        <div class="stage7-land-zone stage12-planeswalker-zone"><div class="stage7-land-row">
          <div class="stage7-land-stack"><div class="battlefield-card stage7-land-card stage24b-full-planeswalker walker">
            <img alt="Jace" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='488' height='680'%3E%3Crect width='488' height='680' fill='%23333'/%3E%3C/svg%3E">
          </div></div>
        </div></div></div>
    </section>'''

html = f'''<!doctype html><html><head><meta charset="utf-8"><style>{css}
body{{margin:0;background:#111}}
main.layout{{width:100vw;height:100dvh;padding:0.25rem;max-width:none}}
main.layout .board-layout{{height:calc(100dvh - 30px);min-height:0}}
main.layout .main-table{{height:100%;padding:0}}
#players-area[data-stage16-players]{{height:100%;width:100%;display:grid;grid-template-rows:repeat(2,minmax(0,1fr));position:relative}}
#players-area > .stage16-opponent-panel,#players-area > .local-component{{height:100%;min-height:0}}
#players-area > .stage16-opponent-panel > .player-section,#players-area > .local-component > .player-section{{height:100%;min-height:0}}
</style></head><body><main class="layout" data-game="true">
<div class="board-layout"><section class="main-table"><div id="players-area" data-stage16-players>
<div class="stage16-opponent-panel" data-stage16-opponent-panel="2">{seat('opponent-seat','Friend')}</div>
<div class="local-component">{seat('your-seat','You')}</div>
</div></section></div></main></body></html>'''


def intersects(a, b, gap=0):
    return (a['left'] < b['right'] + gap and a['right'] > b['left'] - gap
            and a['top'] < b['bottom'] + gap and a['bottom'] > b['top'] - gap)

with sync_playwright() as p:
    path = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    browser = p.chromium.launch(headless=True, **({'executable_path': path} if path else {}))
    try:
        for width, height in [(1280, 800), (860, 700), (390, 720)]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.set_content(html, wait_until='domcontentloaded')
            for name in ('opponent-seat', 'your-seat'):
                rects = page.evaluate('''role => {
                    const section = document.querySelector('#players-area .' + role);
                    const box = cls => section.querySelector(cls).getBoundingClientRect().toJSON();
                    return {
                        walker: box('.stage24b-full-planeswalker'),
                        land: box('.land'),
                        normal: box('.normal'),
                        identity: box('.zone-summary-player'),
                        lane: box('.stage12-planeswalker-area'),
                        seat: section.getBoundingClientRect().toJSON(),
                        fit: getComputedStyle(section.querySelector('.stage24b-full-planeswalker img')).objectFit,
                    };
                }''', name)
                walker, land, seat = (rects[x] for x in ('walker', 'land', 'seat'))
                assert not intersects(walker, land), (width, name, 'walker overlaps land', rects)
                assert walker['top'] >= seat['top'] - 1, (width, name, 'walker above seat', rects)
                assert walker['bottom'] <= seat['bottom'] + 1, (width, name, 'walker below seat', rects)
                assert rects['lane']['left'] - seat['left'] < 18, (width, name, 'walker not at left', rects)
                assert rects['fit'] == 'contain', (width, name, 'printed artwork cropped', rects)
                if name == 'opponent-seat':
                    assert not intersects(walker, rects['identity']), (width, 'opponent identity overlap', rects)
                print(f'PASS {width}x{height}: {name}, walker {walker["width"]:.0f}×{walker["height"]:.0f}')
            page.close()
    finally:
        browser.close()
