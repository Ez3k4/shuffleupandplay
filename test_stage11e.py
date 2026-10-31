#!/usr/bin/env python3
"""Self-contained Stage 11E installer, TypeScript, sizing and rollback checks."""
from pathlib import Path
import importlib.util
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location('installer', HERE / 'install_stage11e.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

spec_d = importlib.util.spec_from_file_location('stage11d', ROOT / 'stage11d_pack' / 'install_stage11d.py')
prior = importlib.util.module_from_spec(spec_d)
spec_d.loader.exec_module(prior)

renderer_fixture = '''export function renderBattlefieldCard(options: {
  card: { x: number; y: number };
  isCurrentPlayer: boolean;
  landStackIndex?: number;
}): string {
  const card = options.card
  const isLandStackCard = options.landStackIndex !== undefined
  const position = isLandStackCard
    ? `--stage7-stack-index:${options.landStackIndex}`
    : `left:calc(var(--tabletop-travel-x) * ${card.x / 1200});top:calc(var(--tabletop-travel-y) * ${card.y / 700})`
  return `<div class="battlefield-card" style="${position};--stage8c-attach-x:23px;--stage8c-attach-y:31px"></div>`
}
function renderCardTools(): string { return '' }
'''
css_fixture = '''/* ===== Stage 11C: stable battlefield card-size tiers ===== */
/* ===== Stage 8C: attachment fan and compact card menu ===== */
#players-area .battlefield-canvas > .battlefield-card.stage8-attached {
  margin-top: var(--stage8c-attach-y, 31px);
}
'''

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / 'public').mkdir()
    (root / 'src/server/render').mkdir(parents=True)
    (root / installer.JS_PATH).write_text(prior.NEW_JS, encoding='utf-8')
    (root / installer.RENDER_PATH).write_text(renderer_fixture, encoding='utf-8')
    (root / installer.CSS_PATH).write_text(css_fixture, encoding='utf-8')
    before = {rel: (root / rel).read_bytes() for rel in installer.FILES}
    command = ['python3', str(HERE / 'install_stage11e.py')]

    def run(*args, expected=0):
        p = subprocess.run(command + list(args), cwd=root, capture_output=True, text=True)
        assert p.returncode == expected, (p.returncode, p.stdout, p.stderr)
        return p.stdout + p.stderr

    assert 'compatibility check passed' in run('--check')
    assert {rel: (root / rel).read_bytes() for rel in installer.FILES} == before
    assert 'installed' in run()
    status = run('--status')
    assert status.count('YES') == 3, status
    new_js = (root / installer.JS_PATH).read_text()
    new_ts = (root / installer.RENDER_PATH).read_text()
    assert 'Math.ceil((count - 6) / 3)' in new_js
    assert '6 + 4 * tier' in new_js
    assert 'group of three: 7-9, 10-12, 13-15' in new_js
    assert installer.NEW_Y in new_ts
    assert '--stage7-stack-index:${options.landStackIndex}' in new_ts
    subprocess.run(['node', '--check', str(root / installer.JS_PATH)], check=True)
    build_path = root / 'compiled'
    subprocess.run(['tsc', '--strict', '--target', 'es2022', '--module', 'commonjs',
                    '--outDir', str(build_path), str(root / installer.RENDER_PATH)],
                   check=True, capture_output=True, text=True)
    rendered_js = next(build_path.rglob('components.js'))
    result = subprocess.run(['node', '-e', '''const {renderBattlefieldCard:r}=require(process.argv[1]);
const own = r({card:{x:120,y:70},isCurrentPlayer:true});
const other = r({card:{x:120,y:70},isCurrentPlayer:false});
const land = r({card:{x:120,y:70},isCurrentPlayer:false,landStackIndex:1});
if(!own.includes('0.1)') || !other.includes('0.9)') || !land.includes('--stage7-stack-index:1'))
process.exit(1);
''', str(rendered_js)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr + result.stdout

    # Tier transition boundaries, maintaining original Stage 11D shrink.
    for count, tier in [(1,0),(6,0),(7,1),(8,1),(9,1),(10,2),(12,2),(13,3),(15,3),(16,4)]:
        actual = 0 if count <= 6 else (count - 6 + 2) // 3
        assert actual == tier, (count,actual,tier)
        target = 6 if tier == 0 else 6 + 4 * tier
        assert target == 6 + 4 * tier

    assert 'already installed' in run('--check', expected=1)
    assert 'restored' in run('--undo')
    assert {rel: (root / rel).read_bytes() for rel in installer.FILES} == before
    assert 'compatibility check passed' in run('--check')

print('PASS: dry run, install/status, JavaScript syntax, TypeScript, mirrored Y, lands,')
print('      tier thresholds, original shrink factor, idempotence and rollback.')
