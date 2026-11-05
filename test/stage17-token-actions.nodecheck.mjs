import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildPlayer, applyPlayerAction} from '../src/game/player.ts'
import {parseAction} from '../src/game/action.ts'
import {roomPayload, seatFingerprints} from '../src/game/room-snapshot.ts'
import {TOKEN_PRESETS, tokenPreset} from '../src/game/tokens.ts'
import {renderComponent} from '../src/server/render/components.ts'
import {readFileSync} from 'node:fs'
const shuffle = readFileSync(new URL('../public/shuffle.js', import.meta.url),'utf8')
const css = readFileSync(new URL('../public/application.css', import.meta.url),'utf8')
const card = (id='creature') => ({instanceId:id,name:'Test Elf',scryfallId:'test',imageUrl:'/image.jpg',printedPower:'2',printedToughness:'3',typeLine:'Creature — Elf',isCreature:true,tapped:false,isManaSource:false,x:100,y:100,counters:[]})
const player = () => ({...buildPlayer({name:'Alice',sessionId:'s1',seat:1,identifier:'p1'}), battlefield:[card()]})
let next=0
const randomness={identifier:()=>`token-${++next}`,shuffle:(items)=>[...items]}
const apply=(p,raw)=>applyPlayerAction({player:p,action:parseAction(raw),randomness})

// Tokens must have unique ids, visible stats and actual SVG artwork.
test('server token library is an allowlist, including common artifact and creature tokens',()=>{
  assert.equal(TOKEN_PRESETS.length,14)
  assert.ok(tokenPreset('treasure'))
  assert.equal(tokenPreset('../attack'),undefined)
})
test('create token places a new token, retaining the original card',()=>{
  const p=apply(player(),{type:'createToken', tokenId:'zombie',sourceInstanceId:'creature'})
  assert.equal(p.battlefield.length,2)
  const token=p.battlefield[1]
  assert.equal(token.name,'Zombie')
  assert.equal(token.isToken,true)
  assert.equal(token.printedPower,'2')
  assert.equal(token.printedToughness,'2')
  assert.equal(token.isCreature,true)
  assert.match(token.imageUrl,/^data:image\/svg\+xml/)
  assert.notEqual(token.instanceId,'creature')
  assert.deepEqual(token.counters,[])
})
test('create token rejects unknown types, invalid sources and excessive board size',()=>{
  const p=player()
  assert.deepEqual(apply(p,{type:'createToken',tokenId:'nonsense',sourceInstanceId:'creature'}),p)
  assert.deepEqual(apply(p,{type:'createToken',tokenId:'treasure',sourceInstanceId:'not-mine'}),p)
  const full={...p,battlefield:Array.from({length:250},(_,i)=>card(String(i)))}
  assert.equal(apply(full,{type:'createToken',tokenId:'treasure',sourceInstanceId:'0'}).battlefield.length,250)
})
test('treasure token behaves as fixed artifact, and exiling removes it permanently',()=>{
  const p=apply(player(),{type:'createToken',tokenId:'treasure',sourceInstanceId:'creature'})
  assert.equal(p.battlefield[1].isUtilityPermanent,true)
  const id=p.battlefield[1].instanceId
  const moved=apply(p,{type:'moveCardZone',instanceId:id,from:'battlefield',to:'exile'})
  assert.equal(moved.battlefield.length,1)
  assert.equal(moved.exile.length,0)
  const p2=apply(player(),{type:'createToken',tokenId:'food',sourceInstanceId:'creature'})
  const shuffled=apply(p2,{type:'moveToDeck',instanceId:p2.battlefield[1].instanceId,from:'battlefield',position:'shuffle'})
  assert.equal(shuffled.library.length,0)
  assert.equal(shuffled.battlefield.length,1)
})
test('creating a token copy retains artwork and base stats, not counters or temporary modifiers',()=>{
  const p=player()
  p.battlefield[0].tapped=true
  p.battlefield[0].powerModifier=8
  p.battlefield[0].toughnessModifier=-2
  p.battlefield[0].counters=[{id:'c',label:'+1/+1',value:3,x:8,y:8}]
  const copied=apply(p,{type:'createTokenCopy',instanceId:'creature'})
  const token=copied.battlefield[1]
  assert.equal(token.name,'Test Elf (Token)')
  assert.equal(token.isToken,true)
  assert.equal(token.imageUrl,'/image.jpg')
  assert.equal(token.printedPower,'2')
  assert.equal(token.tapped,false)
  assert.equal(token.powerModifier,undefined)
  assert.equal(token.toughnessModifier,undefined)
  assert.deepEqual(token.counters,[])
  assert.equal(copied.battlefield[0].tapped,true)
})
test('power and toughness adjust independently with delta ±1, reject other deltas',()=>{
  let p=player()
  p=apply(p,{type:'adjustCreatureStat',instanceId:'creature',stat:'power',delta:1})
  p=apply(p,{type:'adjustCreatureStat',instanceId:'creature',stat:'toughness',delta:-1})
  assert.equal(p.battlefield[0].powerModifier,1)
  assert.equal(p.battlefield[0].toughnessModifier,-1)
  assert.equal(parseAction({type:'adjustCreatureStat',instanceId:'creature',stat:'power',delta:200}),null)
  assert.equal(parseAction({type:'adjustCreatureStat',instanceId:'creature',stat:'bad',delta:1}),null)
  assert.equal(apply(p,{type:'adjustCreatureStat',instanceId:'missing',stat:'power',delta:1}).battlefield[0].powerModifier,1)
})
test('creature stat and token changes invalidate both owner and opponent render components',()=>{
  const initial=player()
  const updated=apply(initial,{type:'adjustCreatureStat',instanceId:'creature',stat:'power',delta:1})
  const room=(p)=>({id:'r',code:'ABC123',name:'test',version:2,idleSweepAt:null,maxPlayers:4,players:[p],createdAt:'',updatedAt:''})
  assert.notDeepEqual(seatFingerprints(room(initial)),seatFingerprints(room(updated)))
  const owner=roomPayload({room:room(updated),sessionId:'s1'})
  const opponent=roomPayload({room:room(updated),sessionId:'not-alice'})
  assert.equal(owner.space.players[0].battlefield[0].powerModifier,1)
  assert.equal(opponent.space.players[0].battlefield[0].powerModifier,1)
  const c=(payload,seat=1)=>renderComponent({name:'player',key:'1',context:{payload,roomCode:'ABC123',seat,shareUrl:'/t/ABC123'}})
  assert.match(c(owner),/stage17-stat-adjust/)
  assert.doesNotMatch(c(opponent),/stage17-stat-adjust/)
  assert.match(c(opponent),/3\/3/)
})
test('original four zone shortcuts remain, and both card-menu variants support tokens',()=>{
  assert.match(shuffle,/stage09-zone-shortcuts/)
  assert.match(shuffle,/data-stage17-copy-fixed/)
  assert.match(shuffle,/data-stage17-open-tokens/)
  assert.match(shuffle,/wireStage17TokenPicker\(actorId\)/)
  assert.match(shuffle,/wireStage17StatControls\(actorId\)/)
  assert.match(css,/stage17-token-picker/)
  assert.match(css,/stage17-stat-adjust/)
})
test('browser token choices match server allowlist',()=>{
  const choices=[...shuffle.slice(shuffle.indexOf('const STAGE17_TOKENS = ['),shuffle.indexOf('function wireStage17TokenPicker')).matchAll(/\['([\w-]+)',\s*'[^']+',\s*'[^']+'\]/g)].map(a=>a[1])
  assert.deepEqual(choices,TOKEN_PRESETS.map(p=>p.id))
})
