import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderComponent } from '../src/server/render/components.ts'
import { buildPlayer } from '../src/game/player.ts'
import { roomPayload } from '../src/game/room-snapshot.ts'

const css = readFileSync(new URL('../public/application.css', import.meta.url), 'utf8')
const stage19b = css.slice(css.lastIndexOf('/* ===== Stage 19B:'))

test('counter rack is narrow, bottom-left, and grows upward', () => {
  assert.match(stage19b, /\.battlefield-card\s*>\s*\.stage19-counter-rack\s*\{[^}]*right:\s*auto;/s)
  assert.match(stage19b, /max-width:\s*min\(48px,\s*calc\(100% - 6px\)\)/)
  assert.match(stage19b, /flex-flow:\s*column-reverse nowrap/)
  assert.match(stage19b, /overflow-y:\s*auto/)
  assert.match(stage19b, /touch-action:\s*pan-y/)
})

test('P/T controls stack above counter badges for pointer hit testing', () => {
  assert.match(stage19b, /\.compact-card-pt\.stage17-stats\s*\{\s*z-index:\s*48;/)
  assert.match(stage19b, /\.stage7-land-card\s*>\s*\.stage19-counter-rack\s*\{[^}]*right:\s*auto;/s)
})

test('creatures still render independent P/T controls and their counter buttons', () => {
  const creature = {
    instanceId:'stack-creature', name:'Bear', typeLine:'Creature — Bear',
    imageUrl:'/test.png', scryfallId:'x', isCreature:true,
    printedPower:'2', printedToughness:'3', x:15, y:20, tapped:false,
    counters:[
      {id:'flying-1',label:'Flying',value:2,x:0,y:0},
      {id:'lifelink-1',label:'Lifelink',value:1,x:0,y:0},
    ]
  }
  const player={...buildPlayer({name:'Alice',sessionId:'alice',seat:1,identifier:'a'}),deckStatus:'loaded',battlefield:[creature]}
  const room={id:'r',code:'TEST',name:'Test',version:1,maxPlayers:2,createdAt:'',updatedAt:'',players:[player]}
  const html=renderComponent({name:'player',key:'1',context:{payload:roomPayload({room,sessionId:'alice'}),roomCode:'TEST',seat:1,shareUrl:'/tables/TEST'}})
  assert.match(html,/data-stage17-stat="power"/)
  assert.match(html,/data-stage17-stat="toughness"/)
  assert.match(html,/data-counter-id="flying-1"/)
  assert.match(html,/data-counter-id="lifelink-1"/)
})
