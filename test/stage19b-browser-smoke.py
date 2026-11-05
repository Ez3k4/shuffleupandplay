"""Stage 19B: stacked counter badges never intercept power/toughness clicks.

Requires Python Playwright and Chromium. Run from project root:
  python3 test/stage19b-browser-smoke.py
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import importlib.util
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
module_spec = importlib.util.spec_from_file_location('stage18_smoke', ROOT / 'test/stage18-browser-smoke.py')
smoke = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(smoke)

with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
    fixture = Path(tmp)/'counter-stack.html'
    subprocess.run(['node', '--experimental-strip-types',str(ROOT / 'test/stage19-browser-fixture.mjs'),str(fixture)],check=True)
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'))
    for viewport in ({'width':1280,'height':800}, {'width':390,'height':720}):
        page = browser.new_page(viewport=viewport)
        page.set_default_timeout(4500)
        page.set_content(fixture.read_text(), wait_until='domcontentloaded')
        page.evaluate('''() => {
          window.__actions=[];
          if (!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{value:()=>String(Math.random())});
          Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{}}});
          window.fetch=async (target,options={}) => {
            if(String(target).endsWith('/actions'))window.__actions.push(JSON.parse(options.body).action);
            if(String(target).includes('wallpapers/manifest.json'))return {ok:true,json:async()=>[]};
            return {ok:true,json:async()=>({decks:[]})};
          };
        }''')
        page.evaluate('''async js => {
          const uri=URL.createObjectURL(new Blob([js],{type:'text/javascript'}));
          try { await import(uri) } finally { URL.revokeObjectURL(uri) }
        }''', smoke.build_module())
        if viewport['width'] < 500:
            # Simulate a crowded battlefield where creature cards shrink.
            page.locator('.your-seat .battlefield-card[data-instance-id="c1"]').evaluate("e => e.style.setProperty('width','72px','important')")
        for cid in ('c1','land1','ench1'):
            measures = page.evaluate('''id => {
              const card = document.querySelector(`.your-seat .battlefield-card[data-instance-id="${id}"]`);
              const tray = card.querySelector('.stage19-counter-rack');
              const style = getComputedStyle(tray);
              const rect = tray.getBoundingClientRect();
              const base = card.getBoundingClientRect();
              const badges = [...tray.querySelectorAll('.counter-chip')].map(e=>e.getBoundingClientRect());
              return {flex:style.flexDirection, width:rect.width, cardWidth:base.width,
                left:rect.left-base.left, bottom:base.bottom-rect.bottom,
                y:badges.map(b=>b.top),
                pt:card.querySelector('.compact-card-pt')?.getBoundingClientRect().toJSON()};
            }''', cid)
            assert measures['flex']=='column-reverse', (cid, measures)
            assert 0 <= measures['left'] <= 8, (cid, measures)
            assert abs(measures['bottom']) <= 9, (cid, measures)
            assert measures['width'] <= measures['cardWidth']-6, (cid, measures)
            if cid == 'c1':
                assert len(measures['y']) == 2
                assert measures['y'][0] > measures['y'][1], measures
        # A counter must not cover the clickable P/T controls.
        for stat in ('power','toughness'):
            button = page.locator(f'.your-seat .battlefield-card[data-instance-id="c1"] [data-stage17-stat="{stat}"]')
            button.click()
            page.wait_for_function('''stat => window.__actions.some(a=>a.type==='adjustCreatureStat' && a.stat===stat && a.delta===1)''', arg=stat)
            button.click(button='right')
            page.wait_for_function('''stat => window.__actions.some(a=>a.type==='adjustCreatureStat' && a.stat===stat && a.delta===-1)''', arg=stat)
        # Counter actions remain clickable and don't open the card menu.
        counter = page.locator('.your-seat [data-instance-id="c1"] [data-counter-id="elf-flying"]')
        counter.click()
        page.wait_for_function('''() => window.__actions.some(a=>a.type==='updateCounterValue' && a.counterId==='elf-flying' && a.delta===1)''')
        counter.click(button='right')
        page.wait_for_function('''() => window.__actions.some(a=>a.type==='updateCounterValue' && a.counterId==='elf-flying' && a.delta===-1)''')
        page.close()
    browser.close()
print('Stage 19B Chromium: vertical stacks, P/T +/- and counter +/- PASS')
