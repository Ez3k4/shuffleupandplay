"""Integration check against the real shuffle.js in a disconnected Chromium page.
Run: python3 test/stage17b-game-boot.browser.py
Requires Python Playwright + Chromium; no server or database is used.
"""
import base64
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
LIVE = 'export class SolidObjectsComponentRegistry {register(){} invalidate(){}}\nexport class SolidObjectsBrowserClient {constructor(){} subscribe(){} connect(){}}'
COMPONENT = 'export function renderComponent(){return ""}'
PAGE = '''<main data-game data-table-type="GameRoom" data-table-code="DEMO" data-components="[]" data-seat="1" data-current-player-id="" data-worker-url="">
  <div id="component-opponentRoster"><button data-stage16-select-seat="2">Bob</button></div>
  <div id="players-area" style="height:650px;width:1000px">
    <div class="stage16-opponent-panel" data-stage16-opponent-panel="2"><div class="player-section opponent-seat"><div class="battlefield-canvas"></div></div></div>
    <div class="player-section your-seat" data-current-player="true" data-player-id="you"><div class="battlefield-canvas" style="width:800px;height:250px">
      <div class="battlefield-card" data-instance-id="creature"><button data-stage17-open-tokens="true">Create token</button></div>
    </div></div>
  </div>
  <button data-copy-text="https://example.test/t/DEMO">Copy invite link</button>
  <form data-deck-search><input name="q" value="sample"><button>Search deck</button></form>
  <div data-deck-results></div>
</main><div data-toast-region></div>'''


def build_module():
    js = (ROOT / 'public/shuffle.js').read_text()
    replacements = {'/vendor/live/browser/index.js': LIVE,
                    '/shared/server/render/components.ts': COMPONENT}
    for name in ('drag-math.js','morph.js','stage12-spells.js',
                 'stage13-drop-target.js','stage13-wallpapers.js','stage16-opponents.js'):
        replacements['./' + name] = (ROOT / 'public' / name).read_text()
    for name, contents in replacements.items():
        uri = 'data:text/javascript;base64,' + base64.b64encode(contents.encode()).decode()
        js = js.replace('from "' + name + '"', 'from "' + uri + '"')
    # about:blank cannot resolve relative WebSocket URLs; only in test copy.
    js = js.replace('new URL("/live", window.location.href)',
                    'new URL("/live", "https://example.test")')
    return js


def main():
    with sync_playwright() as p:
        opts = {'headless': True}
        browser_path = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
        if browser_path:
            opts['executable_path'] = browser_path
        browser = p.chromium.launch(**opts)
        try:
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_content(PAGE)
            page.evaluate("""() => {
              Object.defineProperty(navigator, 'clipboard', {value: {writeText: async (s) => {window.__copied = s}}});
              window.fetch = async (target) => {
                const url = String(target);
                if (url.includes('wallpapers/manifest.json')) return {ok:true, json:async()=>['forest.jpg','island.png']};
                if (url.includes('/api/archidekt/search')) return {ok:true, json:async()=>({decks:[
                  {id:42,name:'Sample Deck',featuredUrl:null,ownerName:'Test',size:60,updatedAt:'today',colorBands:[]}
                ]})};
                return {ok:true, json:async()=>({})};
              };
            }""")
            page.evaluate("""async (js) => {
              const uri = URL.createObjectURL(new Blob([js], {type:'text/javascript'}));
              try { await import(uri); } finally { URL.revokeObjectURL(uri) }
            }""", build_module())
            page.locator('.stage17-token-picker').wait_for(state='attached', timeout=4000)
            page.wait_for_function('document.querySelector("#players-area").hasAttribute("data-stage13-wallpapers-ready")', timeout=4000)
            page.locator('[data-copy-text]').click()
            page.wait_for_function('window.__copied === "https://example.test/t/DEMO"')
            page.locator('[data-deck-search] button').click()
            page.locator('.deck-result-item').wait_for(timeout=4000)
            page.locator('.your-seat [data-stage17-open-tokens]').click()
            assert page.locator('.stage17-token-picker').evaluate('(el) => el.open')
            page.locator('.stage17-token-filter').fill('zombie')
            assert page.locator('.stage17-token-options button:visible').count() == 1
            page.locator('[data-stage17-token-id="zombie"]').click()
            assert not errors, errors
            print('Stage 17B Chromium: game init, copy link, deck search, wallpapers and token menu PASS')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
