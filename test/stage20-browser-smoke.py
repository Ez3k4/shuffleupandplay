"""Quick browser smoke test: Stage 20 actions must work without starting SQLite.
Requires Python Playwright and Chromium; no application server or npm install.
Run: python3 test/stage20-browser-smoke.py
"""
from pathlib import Path
import importlib.util
import os
import shutil
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('stage17b_fixture', HERE / 'stage17b-game-boot.browser.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

page_html = fixture.PAGE.replace('data-current-player-id="" data-worker-url=""',
    'data-current-player-id="player-1" data-worker-url="/assets/table-worker.js"')
page_html = page_html.replace('</main>',
    '''<button id="stage20-action" data-game-action='{"type":"changeLife","delta":-1}'>-1</button></main>''')

with sync_playwright() as p:
    browser_path = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
    browser = p.chromium.launch(headless=True, **({'executable_path': browser_path} if browser_path else {}))
    try:
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(page_html)
        page.evaluate('''() => {
          Object.defineProperty(window.crypto, 'randomUUID', { configurable:true, value: () => 'browser-test-key-123' });
          window.__workers = 0;
          window.Worker = class {
            constructor() { window.__workers += 1; throw new Error('OPFS unavailable'); }
          };
          window.__requests = [];
          window.fetch = async (target, options = {}) => {
            const url = String(target);
            if (url.includes('/api/tables/') && url.includes('/actions')) {
              window.__requests.push({url, method: options.method, key: options.headers['idempotency-key']});
              return {ok:true,status:202};
            }
            if (url.includes('wallpapers/manifest.json')) return {ok:true,json:async()=>[]};
            if (url.includes('/api/archidekt/search')) return {ok:true,json:async()=>({decks:[]})};
            return {ok:true,json:async()=>({})};
          };
        }''')
        page.evaluate('''async (source) => {
            const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
            try { await import(url) } finally { URL.revokeObjectURL(url) }
        }''', fixture.build_module())
        page.wait_for_function('document.querySelector(".stage17-token-picker") !== null')
        page.locator('#stage20-action').click()
        page.wait_for_function('window.__requests.length === 1')
        assert page.evaluate('window.__workers') == 0, 'server sync must not spawn OPFS worker'
        assert page.evaluate('window.__requests[0].method') == 'POST'
        assert not errors, errors
        print('Stage 20 Chromium: normal game boot, action POST, no SQLite worker PASS')
    finally:
        browser.close()
