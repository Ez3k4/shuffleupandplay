"""Small Chromium smoke test for Stage25 UI, without running a game server.

Use: CHROMIUM_PATH=/usr/bin/chromium python3 test/stage25-browser-smoke.py
"""
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
css = (ROOT / 'public/application.css').read_text()
src = (ROOT / 'public/shuffle.js').read_text()
hover_js = src[src.index('function wireStage25OpponentHandHover(game) {'):src.index('// ===== Stage 17: one reusable token picker')]
stack_js = (ROOT / 'public/stage12-spells.js').read_text().replace('export function', 'function')

backs = ''.join(f'<span class="hand-card stage25-opponent-card" data-stage25-hand-index="{i}" style="--stage08-hand-angle:{(i-3)*3:.1f}deg;--stage08-hand-drop:{abs(i-3)*2}px;--stage08-hand-order:{i+1}"><span class="library-back-art"></span></span>' for i in range(7))

html = f'''<!DOCTYPE html><html><head><style>{css}
body {{ background:#121b1d; margin:0; }}
main.layout {{ padding:0; width:100vw; max-width:none; }}
#players-area {{ display:grid; grid-template-rows:repeat(2,minmax(0,1fr)); height:calc(100dvh - 20px); position:relative; }}
.stage16-opponent-panel {{ position:relative; height:100%; }}
.stage16-opponent-panel > .opponent-seat {{ width:100%; height:100%; position:relative; }}
#component-player-1 {{position:relative; height:100%;}}
#component-player-1 > .your-seat {{position:relative;height:100%;width:100%;}}
#players-area .player-section > .stage12-planeswalker-area {{ --stage24b-land-clearance:107px; }}
#players-area .player-section > .stage12-planeswalker-area .stage7-land-zone {{position:relative;}}
</style></head><body><main class="layout" data-game>
<div id="players-area" data-stage16-players>
<div class="stage16-opponent-panel"><section class="player-section opponent-seat" data-player-id="p2">
<div class="zone-summary"><div class="zone-summary-player"><strong>Bob</strong></div></div>
<div class="player-zones"><div class="hand-zone"><div class="hand-strip stage25-opponent-hand-strip" data-hand-count="7">{backs}</div></div>
<div class="zone-lanes"><div class="zone-lane library-lane"><div class="zone-preview library-zone-preview"><span class="library-back-art"></span><span class="zone-preview-caption">Library</span></div></div></div></div>
<div class="stage12-planeswalker-area"><div class="stage7-land-zone"><div class="stage7-land-row"><div class="stage7-land-stack"><div class="stage7-land-card battlefield-card">Walker</div></div></div></div></div>
<div class="stage11-spell-area"><div class="stage11-spell-cards"><div class="stage11-spell-card" data-instance-id="late" data-stack-order="103"><img alt="Counterspell"><span class="stage11-spell-name">Counterspell</span><span class="stage11-awaiting">Waiting for player</span></div></div></div>
</section></div>
<div id="component-player-1"><section class="player-section your-seat" data-player-id="p1">
<div class="zone-summary"><div class="zone-summary-player"><strong>Alice</strong></div></div>
<div class="stage12-planeswalker-area"><div class="stage7-land-zone"><div class="stage7-land-row"><div class="stage7-land-stack"><div class="stage7-land-card battlefield-card">Walker</div></div></div></div></div>
<div class="stage11-spell-area"><div class="stage11-spell-cards"><div class="stage11-spell-card" data-instance-id="early" data-stack-order="102"><img alt="Lightning Bolt"><span class="stage11-spell-name">Lightning Bolt</span><button data-game-action='{{"type":"resolveSpell","instanceId":"early"}}'>Resolve</button></div></div></div>
</section></div>
</div></main></body></html>'''

with sync_playwright() as p:
    path = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    browser = p.chromium.launch(headless=True, executable_path=path)
    try:
        for width, height in ((1366, 768), (960, 760), (390, 760)):
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.set_content(html, wait_until='domcontentloaded', timeout=8000)
            page.evaluate('''(source) => { (new Function(source + '; return wireStage25OpponentHandHover'))()(document.querySelector('main[data-game]')) }''', hover_js)
            page.evaluate('''(source) => { (new Function(source + '; return mountStage12SpellOverlay'))()(document.querySelector('main[data-game]')) }''', stack_js)
            fan=page.locator('.stage25-opponent-hand-strip')
            assert fan.locator('.stage25-opponent-card').count() == 7
            assert fan.evaluate("e => getComputedStyle(e).height") not in ('0px', '')
            # Equal-size, face-down cards fan out and raise without flicker.
            rect=page.evaluate('''() => { const s=document.querySelector('.stage25-opponent-hand-strip');const card=s.children[3];const r=s.getBoundingClientRect();return {x:r.left+card.offsetLeft+12,y:r.top+14, fan:r.toJSON(), clip:getComputedStyle(card).clipPath} }''')
            assert 'inset' in rect['clip']
            print('width', width, 'hand', rect['fan'])
            page.mouse.move(rect['x'], rect['y'])
            page.wait_for_timeout(310)
            raised=page.locator('.stage25-opponent-card.stage25-raised')
            assert raised.count() == 1, (width,rect)
            page.wait_for_timeout(290)
            assert raised.count() == 1, (width,'opponent hand flicker')
            assert raised.evaluate('e => getComputedStyle(e).clipPath').startswith('inset(0px')
            page.mouse.move(width - 8, height - 8)
            page.wait_for_timeout(20)
            assert raised.count() == 0, (width,'opponent hand not cleared')
            # The most recently cast spell, regardless of player, is TOP.
            top=page.locator('.stage25-stack-top')
            assert top.count()==1 and top.get_attribute('data-instance-id')=='late',width
            assert page.locator('.stage25-stack-entry').count()==2
            # CSS scrollbar should always be thin, not high-contrast white.
            scrollbar=page.evaluate("getComputedStyle(document.querySelector('.stage7-land-row')).scrollbarWidth")
            assert scrollbar=='thin',(width,scrollbar)
            img=page.evaluate("getComputedStyle(document.querySelector('.library-back-art')).backgroundImage")
            assert 'cards.scryfall.io/back.png' in img
            if width==1366:
                page.screenshot(path='/mnt/data/stage25-preview.png', full_page=False)
            page.close()
        print('Stage25 Chromium: opponent fan, stack ordering, card back CSS and scrollbar styling PASS')
    finally:
        browser.close()
