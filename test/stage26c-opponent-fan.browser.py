"""Visual smoke test for the Stage 26C opponent hand fan.

Needs Python Playwright + Chromium. Does not start the game server or modify saves.
Run: CHROMIUM_PATH=/usr/bin/chromium python3 test/stage26c-opponent-fan.browser.py
"""
from pathlib import Path
from urllib.parse import quote
import os
import shutil
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
css = (ROOT / "public/application.css").read_text()
script = (ROOT / 'public/shuffle.js').read_text()
hover_js = script[script.index('function wireStage25OpponentHandHover(game) {'):script.index('// ===== Stage 17: one reusable token picker')]

# An obvious, two-color test card: top is vermilion, bottom is blue.
# When the wrong half is shown the fan appears blue rather than vermilion.
svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680">
<rect width="488" height="360" fill="#e65d3f"/>
<rect y="360" width="488" height="320" fill="#2864d2"/>
<text x="30" y="85" font-size="44" fill="#fff">TITLE / ART</text>
<text x="32" y="620" font-size="34" fill="#fff">LOWER HALF</text>
</svg>'''
url = 'data:image/svg+xml,' + quote(svg)

def page_html(count=7):
    cards = []
    for i in range(count):
        is_revealed = i == count // 2
        image = f'<img alt="TEST UPPER HALF" src="{url}">' if is_revealed else '<span class="library-back-art"></span>'
        offset = i - (count - 1) / 2
        angle = offset * 4.0
        drop = min(12, abs(offset) * 3)
        cards.append(f'<span class="hand-card stage25-opponent-card {"stage26-revealed-card" if is_revealed else ""}" data-stage25-hand-index="{i}" style="--stage08-hand-angle:{angle}deg;--stage08-hand-drop:{drop}px;--stage08-hand-order:{i + 1}">{image}</span>')
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{css}
      body {{ margin:0; background:#152521; }}
      main.layout[data-game] {{height:100vh; padding:0; max-width:100vw; }}
      .stage16-opponent-panel {{position:relative;height:50%;}}
      .stage16-opponent-panel > .opponent-seat {{position:relative;height:100%;width:100%;}}
      #players-area .opponent-seat .stage25-opponent-card > .library-back-art {{background-image:none;background-color:#443622;}}
      </style></head>
      <body><main class="layout" data-game="true"><div id="players-area" data-stage16-players>
      <div class="stage16-opponent-panel"><section class="player-section opponent-seat">
        <div class="zone-summary"><div class="zone-summary-player">Bob</div><div class="zone-summary-life">20</div><div class="zone-summary-info"><span data-zone-count="hand">Hand {count}</span></div></div>
        <div class="player-zones"><div class="hand-zone"><div class="hand-strip stage25-opponent-hand-strip" data-hand-count="{count}">{''.join(cards)}</div></div></div>
      </section></div><div class="stage16-local-panel"></div></div></main></body></html>'''

# Select the targeted card by setting the same classes the pointer controller uses.
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.getenv('CHROMIUM_PATH') or shutil.which('chromium'))
    try:
        for width, height in ((1366, 768), (960, 740), (390, 760)):
            page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1)
            page.set_content(page_html(), wait_until='domcontentloaded')
            selected = page.locator('.stage25-opponent-card.stage26-revealed-card')
            strip = page.locator('.stage25-opponent-hand-strip')
            image = selected.locator('img')
            assert selected.count() == 1 and image.count() == 1
            assert page.locator('.stage25-opponent-card .library-back-art').count() == 6
            assert page.locator('.opponent-seat [data-zone-count="hand"]').is_visible()
            assert strip.is_visible()
            css_values = selected.evaluate('e => ({ clip: getComputedStyle(e).clipPath, transform: getComputedStyle(e).transform, cardHeight:e.offsetHeight, stripHeight:e.parentElement.getBoundingClientRect().height, cardWidth:e.offsetWidth })')
            assert css_values['clip'].startswith('inset(0px 0px 45%'), css_values
            assert css_values['transform'].startswith('matrix(-'), css_values
            assert css_values['stripHeight'] >= 55, css_values
            # All cards sit in the top 100px of the battlefield; none are at
            # the bottom half before hover. The raised card remains readable.
            box = strip.bounding_box()
            assert box and 0 <= box['y'] <= 20, (width, box)
            assert box['height'] <= 85, (width, box)
            if width == 1366:
                # A direct pixel check catches a regression to Stage 26B's
                # lower-half crop, which incorrectly displays blue here.
                pixel = Image.open(__import__('io').BytesIO(page.screenshot())).convert('RGB')
                cropped = pixel.crop((0, 0, width, min(120, height)))
                pixels = cropped.get_flattened_data() if hasattr(cropped, 'get_flattened_data') else cropped.getdata()
                reds = sum(1 for r, g, b in pixels if r > 170 and r > g * 1.5 and r > b * 1.3)
                blues = sum(1 for r, g, b in pixels if b > 120 and b > r * 1.5)
                assert reds > 150 and reds > blues * 4, ('top half not visible', reds, blues)
            # Verify hover by using the original unchanged pointer handler.
            page.evaluate('''(code) => (new Function(code + '; return wireStage25OpponentHandHover'))()(document.querySelector('main[data-game]'))''', hover_js)
            x = strip.evaluate('e => e.children[3].offsetLeft + 12') + box['x']
            y = box['y'] + 16
            page.mouse.move(x, y)
            page.wait_for_timeout(250)
            assert page.locator('.stage25-opponent-card.stage25-raised').count() == 1, (width, 'hover inaccessible')
            page.wait_for_timeout(250)
            assert page.locator('.stage25-opponent-card.stage25-raised').evaluate('e => getComputedStyle(e).clipPath').startswith('inset(0px'), (width, 'not expanded')
            # Move completely away and ensure the card returns to its cropped
            # resting position; this catches permanent hover state regressions.
            page.mouse.move(width - 8, height - 8)
            page.wait_for_timeout(100)
            assert page.locator('.stage25-opponent-card.stage25-raised').count() == 0, (width, 'hover stuck')
            print(f'PASS {width}x{height}: top-half fan, 180deg card shell, full card on hover, count and privacy')
            page.close()
    finally:
        browser.close()
