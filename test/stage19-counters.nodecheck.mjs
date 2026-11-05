import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildPlayer, applyPlayerAction } from '../src/game/player.ts'
import { parseAction } from '../src/game/action.ts'
import { roomPayload, seatFingerprints } from '../src/game/room-snapshot.ts'
import { renderComponent } from '../src/server/render/components.ts'

const js = readFileSync(new URL('../public/shuffle.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')
const card = (instanceId, name, typeLine, counterLabel) => ({
  instanceId, name, typeLine, imageUrl: '/card.png', scryfallId: 'sample-id',
  x: 20, y: 25, tapped: false, isManaSource: false,
  ...(typeLine.includes('Land') ? { isLand: true } : {}),
  counters: [{ id: `counter-${instanceId}`, label: counterLabel, value: 2, x: 90, y: 125 }],
})
const cards = [card('creature', 'Bear', 'Creature — Bear', 'Lifelink'),
  card('land', 'Forest', 'Basic Land — Forest', 'Charge'),
  card('artifact', 'Sol Ring', 'Artifact', 'Shield'),
  card('enchantment', 'Propaganda', 'Enchantment', 'Flying')]
const player = () => ({ ...buildPlayer({ name:'Alice',sessionId:'alice', seat:1, identifier:'a' }),
  deckStatus:'loaded', battlefield:cards })
const room = (p) => ({ id:'r',code:'TT',name:'Test',version:2,maxPlayers:4,createdAt:'',updatedAt:'',players:[p] })
const html = (p, sessionId) => renderComponent({name:'player',key:'1',context:{
  payload:roomPayload({room:room(p), sessionId}),roomCode:'TT',seat:1,shareUrl:'/tables/TT'
}})

// This is intentional: legacy counters' saved x/y positions are not read by the
// compact presentation; the game state and protocol remain compatible.
test('all permanent types render anchored symbolic counter controls without saved coordinates', () => {
  const shown = html(player(), 'alice')
  assert.equal((shown.match(/class="stage19-counter-rack"/g) ?? []).length,4)
  for (const c of cards) {
    assert.match(shown,new RegExp(`data-instance-id="${c.instanceId}"`))
    assert.match(shown,new RegExp(`data-counter-id="counter-${c.instanceId}"`))
    assert.ok(shown.includes(`${c.counters[0].label} counter: 2`))
  }
  assert.equal((shown.match(/data-stage19-counter-adjust="true"/g) ?? []).length,4)
  assert.ok(shown.includes('stage19-counter-symbol'))
  assert.ok(!shown.includes('style="left:90px;top:125px"'))
  assert.ok(shown.includes('&quot;delta&quot;:1'))
})

test('opponents see counters with hover names but cannot modify them', () => {
  const shown=html(player(),'visitor')
  assert.equal((shown.match(/stage19-counter-static/g) ?? []).length,4)
  assert.ok(!shown.includes('data-stage19-counter-adjust="true"'))
  assert.ok(shown.includes('Shield counter: 2'))
})

test('left/right increment/decrement use the existing authoritative game action', () => {
  const a=parseAction({type:'updateCounterValue',instanceId:'land',counterId:'counter-land',delta:1})
  const b=parseAction({type:'updateCounterValue',instanceId:'land',counterId:'counter-land',delta:-1})
  assert.ok(a && b)
  const randomness={identifier:()=>String(Math.random()),shuffle:x=>x}
  const increment=applyPlayerAction({player:player(),action:a,randomness})
  assert.equal(increment.battlefield[1].counters[0].value,3)
  const decrement=applyPlayerAction({player:increment,action:b,randomness})
  assert.equal(decrement.battlefield[1].counters[0].value,2)
  const afterAnother=applyPlayerAction({player:decrement,action:b,randomness})
  assert.equal(afterAnother.battlefield[1].counters[0].value,1)
  const removed=applyPlayerAction({player:afterAnother,action:b,randomness})
  assert.equal(removed.battlefield[1].counters.length,0)
  assert.notDeepEqual(seatFingerprints(room(player())),seatFingerprints(room(increment)))
})

test('counter contextmenu is captured before fixed-card and general card context menus', () => {
  assert.match(js,/function wireStage19CounterControls\(actorId\)/)
  assert.match(js,/stopImmediatePropagation\(\)/)
  assert.match(js,/type: 'updateCounterValue', instanceId, counterId, delta: -1/)
  assert.match(js,/if \(event\.target\.closest\?\.\('\.stage19-counter-rack'\)\) return/)
})

test('land and utility menu internal scrolling no longer dismisses the menu', () => {
  assert.match(js,/if \(menu\.contains\(event\.target\)\) return/)
  assert.match(js,/if \(!counterLabel\) closeMenu\(\)/)
  assert.match(js,/\.stage18-counter-menu'\)\.open = false/)
  assert.match(css,/\.stage7-land-menu \.stage18-counter-options\s*\{[\s\S]*?overflow-y: auto/)
  assert.match(css,/\.stage19-counter-rack[\s\S]*?bottom: 3px/)
})
