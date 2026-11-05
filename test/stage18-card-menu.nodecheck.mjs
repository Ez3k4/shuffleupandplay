import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildPlayer, applyPlayerAction } from '../src/game/player.ts'
import { parseAction } from '../src/game/action.ts'
import { roomPayload, seatFingerprints } from '../src/game/room-snapshot.ts'
import { renderComponent } from '../src/server/render/components.ts'
const js = readFileSync(new URL('../public/shuffle.js', import.meta.url),'utf8')
const css = readFileSync(new URL('../public/application.css', import.meta.url),'utf8')
const spellCard=(instanceId='h1')=>({instanceId,name:'Mystic Spell',scryfallId:'valid',imageUrl:'/test.jpg',typeLine:'Instant',tapped:false,isManaSource:false})
const creature=(instanceId='c1')=>({...spellCard(instanceId),name:'Lifebearer',typeLine:'Creature — Angel',printedPower:'3',printedToughness:'4',isCreature:true,x:80,y:90,counters:[]})
const land=()=>({...spellCard('land1'),name:'Island',typeLine:'Basic Land — Island',isLand:true,x:50,y:90,counters:[]})
let id=0
const randomness={identifier:()=>`unique-${++id}`,shuffle:(cards)=>[...cards].reverse()}
const player=()=>({...buildPlayer({name:'Alice',sessionId:'alice-session',seat:1,identifier:'alice'}),deckName:'my deck',deckStatus:'loaded',battlefield:[creature(),land()],hand:[spellCard()]})
const apply=(p,action)=>{const parsed=parseAction(action);assert.ok(parsed,JSON.stringify(action));return applyPlayerAction({player:p,action:parsed,randomness})}
const render=(p,session='alice-session')=>{
  const room={id:'room',code:'ROOM1',name:'Table',version:4,players:[p],createdAt:'',updatedAt:'',maxPlayers:4,idleSweepAt:null}
  const payload=roomPayload({room,sessionId:session})
  return renderComponent({name:'player',key:'1',context:{payload,roomCode:'ROOM1',seat:1,shareUrl:'/tables/ROOM1'}})
}

test('global token action works even when the battlefield and hand are empty',()=>{
  const initial=buildPlayer({name:'Alice',sessionId:'alice-session',seat:1,identifier:'alice'})
  assert.deepEqual(parseAction({type:'createToken',tokenId:'treasure'}),{type:'createToken',tokenId:'treasure'})
  assert.equal(parseAction({type:'createToken',tokenId:'treasure',sourceInstanceId:2}),null)
  const next=apply(initial,{type:'createToken',tokenId:'treasure'})
  assert.equal(next.battlefield[0].name,'Treasure')
  assert.equal(next.battlefield[0].isToken,true)
  assert.deepEqual(next.hand,[])
  assert.equal(next.battlefield[0].counters.length,0)
  const full={...initial,battlefield:Array.from({length:250},(_,i)=>creature(String(i)))}
  assert.equal(apply(full,{type:'createToken',tokenId:'treasure'}).battlefield.length,250)
})

test('token copy of a card in hand stays in hand and creates public token on board',()=>{
  const p=player()
  const copied=apply(p,{type:'createTokenCopy',instanceId:'h1'})
  assert.deepEqual(copied.hand,p.hand)
  assert.equal(copied.battlefield.length,3)
  assert.equal(copied.battlefield.at(-1).name,'Mystic Spell (Token)')
  assert.equal(copied.battlefield.at(-1).isToken,true)
  assert.deepEqual(copied.battlefield.at(-1).counters,[])
  assert.equal(apply(p,{type:'createTokenCopy',instanceId:'another-h1'}).battlefield.length,2)
  const room=(q)=>({id:'r',code:'T',name:'Table',version:1,idleSweepAt:null,players:[q],createdAt:'',updatedAt:''})
  const other=roomPayload({room:room(copied),sessionId:'not-alice'})
  assert.equal(other.space.players[0].hand[0].name,'Hidden card')
  assert.equal(other.space.players[0].battlefield.at(-1).name,'Mystic Spell (Token)')
})

test('keyword counters have full names, start at one, can be removed, and synchronize',()=>{
  const p=player()
  const added=apply(p,{type:'addCounter',instanceId:'c1',x:8,y:8,label:'Indestructible'})
  assert.equal(added.battlefield[0].counters[0].label,'Indestructible')
  assert.equal(added.battlefield[0].counters[0].value,1)
  const next=apply(added,{type:'updateCounterValue',instanceId:'c1',counterId:added.battlefield[0].counters[0].id,delta:-1})
  assert.deepEqual(next.battlefield[0].counters,[])
  assert.equal(render(added,'not-alice').includes('Indestructible'),true)
  assert.equal(render(added,'not-alice').includes('1</span>'),true)
  const makeRoom=(q)=>({id:'r',code:'T',name:'test',version:1,idleSweepAt:null,players:[q],createdAt:'',updatedAt:''})
  assert.notDeepEqual(seatFingerprints(makeRoom(p)),seatFingerprints(makeRoom(added)))
})

test('battlefield menu offers zone icons, token copy, counter submenu, attach only',()=>{
  const html=render(player())
  assert.match(html,/class="zone-summary-actions"[\s\S]*data-stage17-open-tokens="true"/)
  const within=html.split('<div class="card-tools">')[1]
  assert.ok(within)
  // End at the first details closing tag; nested counter-options <div> is not
  // the end of .card-tools and cannot be sliced by a naive </div> regex.
  const tools=within.slice(0, within.indexOf('</details>') + '</details>'.length)
  const actions=[...tools.matchAll(/data-game-action="([^"\n]+)"/g)].map(m=>m[1])
  const parts=actions.map(a=>a.replaceAll('&quot;','"'))
  assert.equal(parts.filter(a=>a.includes('moveCardZone')).length,3)
  assert.equal(parts.filter(a=>a.includes('moveToDeck')).length,1)
  assert.equal(parts.filter(a=>a.includes('createTokenCopy')).length,1)
  assert.equal(parts.filter(a=>a.includes('addCounter')).length,18)
  assert.ok(tools.indexOf('stage17-token-copy')>tools.indexOf('stage18-zone-exile'))
  assert.ok(tools.indexOf('stage18-counter-menu')>tools.indexOf('stage17-token-copy'))
  assert.ok(within.indexOf('data-stage8-attach-start')>within.indexOf('stage18-counter-menu'))
  assert.doesNotMatch(tools,/data-stage17-open-tokens/)
  assert.match(html,/data-hand-play-instance-id="h1"/)
  assert.match(js,/function wireStage18HandMenu/)
  assert.match(js,/from:'hand',to:'graveyard'/)
  assert.match(js,/from:'hand',to:'exile'/)
  assert.match(js,/type:'playFromHand'/)
  assert.match(css,/\.stage18-hand-menu/)
  assert.match(css,/\.stage18-counter-options/)
})

test('opponents cannot see a Create Token button or hand card menu',()=>{
  const html=render(player(),'not-alice')
  assert.doesNotMatch(html,/data-stage17-open-tokens/)
  assert.doesNotMatch(html,/data-hand-play-instance-id="h1"/)
  assert.doesNotMatch(html,/data-stage8-attach-start/)
})

test('normal hand zone moves remain valid; dragged instant goes to spell area',()=>{
  const p=player()
  assert.equal(apply(p,{type:'moveCardZone',instanceId:'h1',from:'hand',to:'graveyard'}).graveyard.length,1)
  assert.equal(apply(p,{type:'moveCardZone',instanceId:'h1',from:'hand',to:'exile'}).exile.length,1)
  assert.equal(apply(p,{type:'moveToDeck',instanceId:'h1',from:'hand',position:'shuffle'}).library.length,1)
  assert.equal(apply(p,{type:'playFromHand',instanceId:'h1'}).pendingSpells.length,1)
  assert.equal(p.hand.length,1)
})
