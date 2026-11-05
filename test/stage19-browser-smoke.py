"""Stage 19 browser regression: symbolic counter clicks and fixed-menu scrolling.
Run: python3 test/stage19-browser-smoke.py (requires Playwright + Chromium).
"""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
import importlib.util
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('stage18_smoke', ROOT/'test/stage18-browser-smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

def main():
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        fixture = Path(tmp)/'fixture.html'
        subprocess.run(['node', '--experimental-strip-types',str(ROOT/'test/stage19-browser-fixture.mjs'),str(fixture)],check=True,stdout=subprocess.DEVNULL)
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'))
        page = browser.new_page(viewport={'width':1280,'height':800})
        page.set_default_timeout(3500)
        errors=[]
        page.on('pageerror',lambda err:errors.append(str(err)))
        try:
            page.set_content(fixture.read_text(),wait_until='domcontentloaded')
            page.evaluate('''() => {
              window.__actions=[];
              if (!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{value:()=>String(Math.random())});
              Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{}}});
              window.fetch=async(target,options={})=>{
                const url=String(target);
                if(url.endsWith('/actions'))window.__actions.push(JSON.parse(options.body).action);
                if(url.includes('wallpapers/manifest.json'))return {ok:true,json:async()=>[]};
                return {ok:true,json:async()=>({decks:[]})};
              };
            }''')
            page.evaluate('''async (js) => {
              const uri=URL.createObjectURL(new Blob([js],{type:'text/javascript'}));
              try { await import(uri) } finally { URL.revokeObjectURL(uri) }
            }''',smoke.build_module())
            def counters(instance):
                return page.locator(f'.your-seat .battlefield-card[data-instance-id="{instance}"] > .stage19-counter-rack')
            elf=counters('c1')
            assert elf.locator('.counter-chip').count()==2
            assert elf.locator('.counter-chip').first.get_attribute('title').startswith('Flying counter: 2')
            assert elf.locator('.stage19-counter-symbol').first.inner_text() == '↟'
            def check_bottom(instance):
                return page.evaluate('''id=>{
                  const card=document.querySelector(`.your-seat .battlefield-card[data-instance-id="${id}"]`);
                  const tray=card.querySelector('.stage19-counter-rack');
                  const c=card.getBoundingClientRect(),t=tray.getBoundingClientRect();
                  return {gap:c.bottom-t.bottom,left:t.left-c.left,cardHeight:c.height,chipCount:tray.children.length};
                }''',instance)
            for cid in ('c1','land1','ench1'):
                box=check_bottom(cid)
                assert abs(box['gap'])<=9, (cid,box)
                assert box['left']>=0, (cid,box)
            flying=elf.locator('[data-counter-id="elf-flying"]')
            flying.click()
            page.wait_for_function('window.__actions.some(a=>a.type==="updateCounterValue" && a.counterId==="elf-flying" && a.delta===1)')
            flying.click(button='right')
            page.wait_for_function('window.__actions.some(a=>a.type==="updateCounterValue" && a.counterId==="elf-flying" && a.delta===-1)')
            assert page.locator('.your-seat .battlefield-card[data-instance-id="c1"].card-tools-open').count()==0
            # Both fixed-lane counter buttons use the same delegated actions.
            for cid,coid in [('land1','land-charge'),('ench1','ench-shield')]:
                btn=counters(cid).locator('button')
                btn.click()
                page.wait_for_function('''([c])=>window.__actions.some(a=>a.type==='updateCounterValue' && a.counterId===c && a.delta===1)''',arg=[coid])
                btn.click(button='right')
                page.wait_for_function('''([c])=>window.__actions.some(a=>a.type==='updateCounterValue' && a.counterId===c && a.delta===-1)''',arg=[coid])
                card=page.locator(f'.your-seat .stage7-land-card[data-instance-id="{cid}"]')
                card.evaluate('''el=>el.dispatchEvent(new MouseEvent('contextmenu',{button:2,clientX:460,clientY:300,bubbles:true,cancelable:true}))''')
                menu=page.locator('.stage7-land-menu:not([hidden])')
                menu.wait_for()
                menu.locator('summary').click()
                options=menu.locator('.stage18-counter-options')
                options.evaluate('''el=>{ el.scrollTop=el.scrollHeight; el.dispatchEvent(new Event('scroll',{bubbles:false})); }''')
                assert options.evaluate('(el)=>el.scrollTop')>0, cid
                assert menu.is_visible(),f'Menu closed while scrolling {cid}'
                options.locator('button',has_text='Indestructible').click()
                page.wait_for_function('window.__actions.some(a=>a.type==="addCounter" && a.label==="Indestructible")')
                assert menu.is_visible(),f'Menu closed when adding counter on {cid}'
                page.keyboard.press('Escape')
                assert not menu.is_visible()
            page.set_viewport_size({'width':390,'height':720})
            for cid in ('c1','land1','ench1'):
                assert abs(check_bottom(cid)['gap'])<=9,cid
            assert not errors,errors
            print('Stage 19 Chromium: counter symbols, +/- clicks, hover metadata, anchored land/utility badges and fixed-menu scrolling PASS')
        finally:
            browser.close()
if __name__=='__main__': main()
