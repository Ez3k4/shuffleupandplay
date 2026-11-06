"""Stage 26 visual and hand-menu smoke test; no game server required.

Run: CHROMIUM_PATH=/usr/bin/chromium python3 test/stage26-browser-smoke.py
"""
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
css = (ROOT / 'public/application.css').read_text()
src = (ROOT / 'public/shuffle.js').read_text()
hover_js = src[src.index('function wireStage25OpponentHandHover(game) {'):src.index('// ===== Stage 17: one reusable token picker')]
menu_js = src[src.index('function wireStage18HandMenu() {'):src.index('// ===== Stage 08: bring last touched')]

cards = ''
for i in range(7):
    revealed = i == 3
    content = '<img alt="Sample Revealed" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'300\'%3E%3Crect width=\'200\' height=\'300\' fill=\'%2397bfc0\'/%3E%3Ctext x=\'12\' y=\'48\' font-size=\'21\'%3ERevealed%3C/text%3E%3C/svg%3E"><span>Sample Revealed</span>' if revealed else '<span class="library-back-art"></span>'
    cards += (f'<span class="hand-card stage25-opponent-card {"stage26-revealed-card" if revealed else ""}" '
              f'data-stage25-hand-index="{i}" style="--stage08-hand-angle:{(i-3)*4}deg;--stage08-hand-drop:{abs(i-3)*3}px;--stage08-hand-order:{i+1}" '
              f'{"data-preview-name=\"Sample Revealed\"" if revealed else ""}>{content}</span>')

html = f'''<!doctype html><html><head><style>{css}
body {{margin:0;background:#152521}}
#players-area {{ height:100vh;position:relative; }}
.stage16-opponent-panel {{position:relative;height:50%;}}
.stage16-opponent-panel > .opponent-seat {{position:relative;height:100%;width:100%;}}
</style></head><body><main class="layout" data-game="true" style="padding:0;max-width:100vw;">
<div id="players-area" data-stage16-players>
<div class="stage16-opponent-panel"><section class="player-section opponent-seat">
<div class="zone-summary"><div class="zone-summary-player"><div class="player-header-name"><strong>Bob</strong></div></div><div class="zone-summary-life"><div class="life-controls"><span class="life-value">20</span></div></div><div class="zone-summary-info"><span data-zone-count="library" data-count="45">Library 45</span><span data-zone-count="hand" data-count="7">Hand 7</span></div></div>
<div class="player-zones"><div class="hand-zone"><div class="hand-strip stage25-opponent-hand-strip" data-hand-count="7">{cards}</div></div></div>
</section></div>
<div class="stage16-local-panel"><section class="player-section your-seat"><div class="player-zones"><div class="hand-zone"><div class="hand-strip">
<button type="button" class="hand-card" data-hand-play-instance-id="secret-1" data-stage26-revealed="false" data-preview-name="My Secret">My Secret</button>
<button type="button" class="hand-card stage26-own-revealed" data-hand-play-instance-id="secret-2" data-stage26-revealed="true" data-preview-name="My Revealed">My Revealed</button>
</div></div></div></section></div>
</div></main></body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.getenv('CHROMIUM_PATH') or shutil.which('chromium'))
    try:
        for width, height in ((1366, 768), (960, 740), (390, 760)):
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.set_content(html, wait_until='domcontentloaded')
            page.evaluate('''(code) => (new Function(code + '; return wireStage25OpponentHandHover'))()(document.querySelector('main[data-game]'))''',hover_js)
            page.evaluate('''(code) => (new Function(code + '; return wireStage18HandMenu'))()()''', menu_js)
            info = page.locator('.opponent-seat [data-zone-count="hand"]')
            assert info.is_visible(), (width, 'count not visible')
            assert info.inner_text() == 'Hand 7'
            assert page.locator('.stage26-revealed-card img').count() == 1
            assert page.locator('.stage25-opponent-card .library-back-art').count() == 6
            card_transform = page.locator('.stage25-opponent-card').first.evaluate('(e) => getComputedStyle(e).transform')
            assert card_transform.startswith('matrix(-'), (width, 'whole card was not rotated 180 degrees', card_transform)
            face_transform = page.locator('.stage25-opponent-card .library-back-art').first.evaluate('(e) => getComputedStyle(e).transform')
            assert face_transform == 'none', (width, 'unnecessary inner card rotation', face_transform)
            rect = page.locator('.stage25-opponent-hand-strip').bounding_box()
            strip = page.locator('.stage25-opponent-hand-strip')
            x = strip.evaluate('e => e.children[3].offsetLeft + 12') + rect['x']
            y = rect['y'] + 12
            page.mouse.move(x, y)
            page.wait_for_timeout(250)
            assert page.locator('.stage25-opponent-card.stage25-raised').count() == 1, (width, 'hover')
            page.mouse.move(width - 12, height - 12)
            page.wait_for_timeout(80)
            assert page.locator('.stage25-opponent-card.stage25-raised').count() == 0
            card = page.locator('.your-seat .hand-card').first
            card.dispatch_event('contextmenu', {'clientX': width // 2, 'clientY': height // 2, 'button': 2})
            button = page.locator('.stage26-hand-reveal')
            assert button.is_visible()
            assert button.inner_text().endswith('Show to opponent'), (width, 'show menu')
            assert button.get_attribute('data-game-action') == '{"type":"toggleHandReveal","instanceId":"secret-1"}'
            page.locator('.your-seat .hand-card').nth(1).dispatch_event('contextmenu', {'clientX': width // 2, 'clientY': height // 2, 'button': 2})
            assert button.inner_text().endswith('Hide from opponent'), (width, 'hide menu')
            if width == 1366:
                page.screenshot(path='/mnt/data/stage26b-preview.png', full_page=False)
            page.close()
            print(f'PASS {width}x{height}: inverted fan, hand count, reveal, right-click toggle')
    finally:
        browser.close()
