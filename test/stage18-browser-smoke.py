"""Integration check: actual Stage 18 browser module with a fake network.
Run: python3 test/stage18-browser-smoke.py
Requires playwright, chromium, node --experimental-strip-types.
"""
import base64
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
LIVE = 'export class SolidObjectsComponentRegistry {register(){} invalidate(){}}\nexport class SolidObjectsBrowserClient {constructor(){} subscribe(){} connect(){}}'
COMPONENT = 'export function renderComponent(){return ""}'

def build_module():
    js = (ROOT / 'public/shuffle.js').read_text()
    modules={'/vendor/live/browser/index.js':LIVE,'/shared/server/render/components.ts':COMPONENT}
    for name in ('drag-math.js','morph.js','stage12-spells.js','stage13-drop-target.js','stage13-wallpapers.js','stage16-opponents.js'):
        modules['./'+name] = (ROOT/'public'/name).read_text()
    for name,contents in modules.items():
        uri = 'data:text/javascript;base64,'+base64.b64encode(contents.encode()).decode()
        js=js.replace('from "'+name+'"','from "'+uri+'"')
    return js.replace('new URL("/live", window.location.href)','new URL("/live", "https://example.test")')

def main():
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        file=Path(tmp)/'fixture.html'
        subprocess.run(['node','--experimental-strip-types',str(ROOT/'test/stage18-browser-fixture.mjs'),str(file)],check=True,stdout=subprocess.DEVNULL)
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'))
        page=browser.new_page(viewport={'width':1280,'height':800})
        page.set_default_timeout(2500)
        errors=[]
        page.on('pageerror', lambda err: errors.append(str(err)))
        try:
            page.set_content(file.read_text(),wait_until='domcontentloaded')
            page.evaluate('''() => {
              window.__actions=[];window.__fetchcalls=[];
              if (!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{value:()=>`test-${Math.random()}`});
              Object.defineProperty(navigator,'clipboard',{value:{writeText:async s=>{window.__copied=s}}});
              window.fetch=async (target,options={})=>{
                const url=String(target);window.__fetchcalls.push(url);
                if(url.endsWith('/actions'))window.__actions.push(JSON.parse(options.body).action);
                if(url.includes('wallpapers/manifest.json'))return {ok:true,json:async()=>[]};
                if(url.includes('/api/archidekt/search'))return {ok:true,json:async()=>({decks:[]})};
                return {ok:true,json:async()=>({})};
              }
            }''')
            page.evaluate('''async (js) => {
              const uri=URL.createObjectURL(new Blob([js],{type:'text/javascript'}));
              try{await import(uri)}finally{URL.revokeObjectURL(uri)}
            }''',build_module())
            # A global token can be created even on an empty board (backend tested separately).
            assert page.locator('.your-seat .stage18-create-token').count()==1
            page.locator('.your-seat .stage18-create-token').click()
            assert page.locator('.stage17-token-picker').evaluate('(el)=>el.open')
            page.locator('[data-stage17-token-id="treasure"]').click()
            page.wait_for_function('window.__actions.length>=1')
            assert page.evaluate('window.__actions.at(-1)')=={'type':'createToken','tokenId':'treasure'}
            # Creature right-click: first move row, copy, counters, Attach.
            card=page.locator('.your-seat .battlefield-canvas > .battlefield-card[data-instance-id="c1"]')
            card.click(button='right',force=True)
            page.locator('.your-seat .battlefield-card[data-instance-id="c1"] > .card-tools:popover-open').wait_for(timeout=3000)
            tools=page.locator('.your-seat .battlefield-card[data-instance-id="c1"] > .card-tools')
            assert tools.locator('.stage09-zone-shortcuts button').count()==4
            assert tools.locator('[data-stage17-open-tokens]').count()==0
            assert tools.locator('details.stage18-counter-menu').count()==1
            assert tools.locator('[data-stage8-attach-start]').count()==1
            tools.locator('summary').click()
            assert tools.locator('.stage18-counter-choice').count()==18
            tools.locator('.stage18-counter-choice',has_text='Deathtouch').click()
            page.wait_for_function('window.__actions.some(a=>a.type==="addCounter" && a.label==="Deathtouch")')
            # Hand menu is separate from playing by drag or clicking.
            hand=page.locator('.your-seat .hand-card[data-hand-play-instance-id="hand1"]')
            hand.evaluate('el => el.dispatchEvent(new MouseEvent("contextmenu", {button:2,clientX:640,clientY:650,bubbles:true,cancelable:true}))')
            page.locator('.stage18-hand-menu:not([hidden])').wait_for(timeout=3000)
            assert page.locator('.stage18-hand-menu [data-stage18-hand-move]').count()==4
            assert page.locator('.stage18-hand-menu .stage18-hand-token-copy').count()==1
            assert page.locator('.stage18-hand-menu .stage18-counter-menu').count()==0
            page.locator('.stage18-hand-menu .stage18-hand-token-copy').click()
            page.wait_for_function('window.__actions.some(a=>a.type==="createTokenCopy" && a.instanceId==="hand1")')
            hand.evaluate('el => el.dispatchEvent(new MouseEvent("contextmenu", {button:2,clientX:640,clientY:650,bubbles:true,cancelable:true}))')
            page.locator('.stage18-hand-menu [data-stage18-hand-move="battlefield"]').click()
            page.wait_for_function('window.__actions.some(a=>a.type==="playFromHand" && a.instanceId==="hand1")')
            # Fixed lands still provide the requested streamlined actions.
            land=page.locator('.your-seat .stage7-land-card[data-instance-id="land1"]')
            assert land.count()==1
            land.evaluate('el => el.dispatchEvent(new MouseEvent("contextmenu", {button:2,clientX:470,clientY:300,bubbles:true,cancelable:true}))')
            fixed=page.locator('.stage7-land-menu:not([hidden])')
            fixed.wait_for(timeout=3000)
            assert fixed.locator('[data-land-choice]').count()==4
            assert fixed.locator('[data-stage17-open-tokens]').count()==0
            assert fixed.locator('[data-stage17-copy-fixed]').count()==1
            assert fixed.locator('.stage18-counter-choice').count()==18
            assert fixed.locator('[data-stage18-fixed-attach]').count()==1
            # Basic Stage 17B regression: copy button still works.
            page.locator('[data-copy-text]').click()
            page.wait_for_function('window.__copied === "https://example.test/t/DEMO"')
            # Menus must be constrained to a narrow viewport as well.
            page.set_viewport_size({'width':390,'height':720})
            hand.evaluate('el => el.dispatchEvent(new MouseEvent("contextmenu", {button:2,clientX:345,clientY:690,bubbles:true,cancelable:true}))')
            bounds=page.locator('.stage18-hand-menu').evaluate('(el)=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})')
            assert bounds['left']>=0 and bounds['right']<=390 and bounds['top']>=0 and bounds['bottom']<=720,bounds
            assert not errors,errors
            print('Stage 18 Chromium: toolbar token, creature menu, keyword counters, hand actions, fixed menu, copy link PASS')
        finally:
            browser.close()
if __name__=='__main__':main()
