"""Run Stage 21 interaction/layout checks in a real Chromium browser.

Prerequisite: python -m pip install playwright && python -m playwright install chromium
Run: python3 test/stage21-browser-smoke.py
"""
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
css=(ROOT/'public/application.css').read_text()
source=(ROOT/'public/shuffle.js').read_text()
start=source.index('function wireStage21StableHandHover(game) {')
end=source.index('// ===== Stage 17: one reusable token picker', start)
hover_js=source[start:end]

html='''<!doctype html><html><head><meta charset="utf-8"><style>''' + css + '''
body{margin:0;background:#111;}
main.layout{margin:0;padding:0;max-width:none;width:100vw;height:780px;}
.board-layout{height:710px;}
.main-table{height:100%; padding:0;}
#players-area[data-stage16-players]{height:700px;width:100%;display:grid;grid-template-rows:repeat(2,minmax(0,1fr));position:relative;}
.stage16-opponent-panel{position:relative;height:100%;}
.stage16-opponent-panel>.opponent-seat{position:relative;height:100%;width:100%;}
#component-player-1{position:relative;height:100%;}
#component-player-1>.your-seat{position:relative;height:100%;width:100%;}
.player-zones{width:100%;position:absolute;bottom:0;left:0;height:0;overflow:visible;}
.your-seat .player-zones .hand-zone{position:absolute;bottom:0;left:45%;max-width:none;width:max-content;transform:translateX(-50%);overflow:visible;}
.your-seat .player-zones .hand-strip{display:flex;width:max-content;height:50px;overflow:visible;}
.your-seat .player-zones .hand-card{--stage08-hand-angle:0deg;--stage08-hand-drop:0px;--hand-rise:-120px;--stage10-fan-lift:20px;--stage10-hand-width:128px;--zone-card-width:128px;height:178px;background:#273744;color:white;}
.your-seat .player-zones .hand-card + .hand-card{margin-left:-55px;}
.your-seat .hand-card img{display:block;width:100%;height:100%;pointer-events:none;}
</style></head><body><main class="layout" data-game>
<div class="board-layout"><section class="main-table"><div id="players-area" data-stage16-players>
<div class="stage16-opponent-panel" data-stage16-opponent-panel="2"><section class="player-section opponent-seat"><div class="zone-summary"><div class="zone-summary-player"><strong>Bob</strong></div><div class="zone-summary-life"><span class="life-value">30</span></div><div class="zone-summary-info">library 10</div></div></section></div>
<div id="component-player-1"><section class="player-section your-seat"><div class="zone-summary"><div class="zone-summary-player"><strong>Alice</strong></div></div><div class="player-zones"><div class="hand-zone"><div class="hand-strip" data-hand-count="3">
<button class="hand-card" data-hand-play-instance-id="c1"><img alt="A" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='180'%3E%3Crect width='128' height='180' fill='%23334'/%3E%3C/svg%3E"></button>
<button class="hand-card" data-hand-play-instance-id="c2"><img alt="B" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='180'%3E%3Crect width='128' height='180' fill='%23556'/%3E%3C/svg%3E"></button>
<button class="hand-card" data-hand-play-instance-id="c3"><img alt="C" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='180'%3E%3Crect width='128' height='180' fill='%23778'/%3E%3C/svg%3E"></button>
</div></div></div></section></div>
</div></section></div></main></body></html>'''

with sync_playwright() as p:
    browser_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
    browser=p.chromium.launch(headless=True, **({'executable_path':browser_path} if browser_path else {}))
    try:
        for width,height in ((1280,800),(860,800),(390,760)):
            page=browser.new_page(viewport={'width':width,'height':height})
            page.set_content(html, wait_until="domcontentloaded", timeout=6000)
            page.evaluate('''src => { (new Function(src + '; return wireStage21StableHandHover'))()(document.querySelector('main[data-game]')) }''',hover_js)
            metrics=page.evaluate('''() => {const area=document.querySelector('#players-area'),opp=document.querySelector('.opponent-seat .zone-summary');const top=area.getBoundingClientRect(),r=opp.getBoundingClientRect();return {divider:top.top+top.height/2,bottom:r.bottom,x:r.left,areaX:top.left}}''')
            assert abs(metrics['bottom']-metrics['divider'])<28, (width,metrics)
            assert metrics['x']-metrics['areaX'] < 70, (width,metrics)
            card=page.locator('.your-seat .hand-card[data-hand-play-instance-id="c2"]')
            coords=page.evaluate('''() => {const strip=document.querySelector('.hand-strip');const cards=[...strip.children];const r=strip.getBoundingClientRect();return {x:r.left+cards[1].offsetLeft+15,y:r.bottom-13}}''')
            page.mouse.move(coords['x'],coords['y'])
            page.wait_for_timeout(250)
            assert card.evaluate("e=>e.classList.contains('stage21-raised')"), (width,'not raised')
            # Native hover is now irrelevant; selection must remain stable
            # after the card moves upwards out of its resting hitbox.
            page.wait_for_timeout(450)
            assert card.evaluate("e=>e.classList.contains('stage21-raised')"), (width,'flicker')
            page.mouse.move(12,12)
            page.wait_for_timeout(25)
            assert not card.evaluate("e=>e.classList.contains('stage21-raised')"), (width,'not cleared')
            page.close()
        print('Stage 21 Chromium: stable hand reveal and mirrored opponent header PASS')
        # Stage 22 verifies the deck token picker separately.
    finally:
        if browser.is_connected(): browser.close()
