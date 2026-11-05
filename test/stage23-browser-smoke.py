"""Stage 23 token catalog UI integration; no external API or game server required.
Run: python3 test/stage23-browser-smoke.py (requires Playwright Chromium).
"""
from pathlib import Path
import os, shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
source = (ROOT / 'public/shuffle.js').read_text()
css = (ROOT / 'public/application.css').read_text()
picker = source[source.index('function wireStage17TokenPicker('):source.index('// ===== Stage 18: right-click actions')]

UUID_A = '11111111-2222-4333-8444-555555555555'
UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

def token(uuid, name):
    return {'id': uuid, 'name': name, 'typeLine': f'Token Creature — {name}',
        'imageUrl': f'https://cards.scryfall.io/normal/front/1/1/{uuid}.jpg',
        'artCropUrl': f'https://cards.scryfall.io/art_crop/front/1/1/{uuid}.jpg',
        'printedPower': '1', 'printedToughness': '1'}

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
    browser = playwright.chromium.launch(headless=True, **({'executable_path':executable} if executable else {}))
    try:
        for width in (1280, 390):
            page = browser.new_page(viewport={'width':width,'height':780})
            page.set_content(f'''<!doctype html><html><head><style>{css}</style></head><body>
              <div class="your-seat"><button id="create" data-stage17-open-tokens="true">Create Token</button></div>
              </body></html>''', wait_until='domcontentloaded', timeout=5000)
            page.evaluate('''(src) => {
              window.__actions = [];
              window.__queries = [];
              window.fetch = async (url) => {
                const params = new URL(url, 'http://localhost').searchParams;
                const query = params.get('q') || '';
                const page = Number(params.get('page') || 1);
                window.__queries.push([query, page]);
                let tokens = query ? [
                  {id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name:'Knight', typeLine:'Token Creature — Knight',
                   imageUrl:'https://cards.scryfall.io/normal/front/a/a/example.jpg', printedPower:'2', printedToughness:'2'}
                ] : [{id:'11111111-2222-4333-8444-555555555555',name:'Elephant',
                  typeLine:'Token Creature — Elephant', imageUrl:'https://cards.scryfall.io/normal/front/1/1/example.jpg',
                  printedPower:'3',printedToughness:'3'}];
                if (page === 2) tokens = [{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name:'Knight',typeLine:'Token Creature — Knight'}];
                return {ok:true, json:async()=>({tokens,hasMore:!query && page === 1})};
              };
              const pick = new Function('const sendAction=(actor,action)=>{window.__actions.push(action);return Promise.resolve()};'+src+';return wireStage17TokenPicker');
              pick()('TEST');
            }''', picker)
            page.locator('#create').click(timeout=3000)
            page.locator('.stage17-token-options button').first.wait_for(timeout=5000)
            assert page.locator('.stage17-token-options button').count() == 1
            assert page.locator('.stage17-token-options img[src^="https://cards.scryfall.io/"]').count() == 1
            assert page.locator('.stage23-more').is_visible()
            page.locator('.stage23-more').click(timeout=3000)
            page.wait_for_function('document.querySelectorAll(".stage17-token-options button").length===2',timeout=5000)
            assert page.evaluate('window.__queries')[:2] == [['',1],['',2]]
            page.locator('.stage17-token-filter').fill('Knight',timeout=3000)
            page.wait_for_function('document.querySelectorAll(".stage17-token-options button").length===1 && document.querySelector(".stage17-token-options .stage17-token-name").textContent==="Knight"',timeout=5000)
            page.locator('.stage17-token-options button').first.click(timeout=3000)
            assert page.evaluate('window.__actions') == [{'type':'createToken','tokenId':UUID_B}]
            assert page.locator('.stage17-token-picker').evaluate('(e)=>e.open') is False
            page.close()
        print('Stage 23 Chromium: global picker, artwork, pagination, live search, action PASS')
    finally:
        if browser.is_connected(): browser.close()
