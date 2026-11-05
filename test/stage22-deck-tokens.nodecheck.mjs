import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveDeckTokenCards } from '../src/archidekt/deck-token-cards.ts'
import { applyPlayerAction, buildPlayer } from '../src/game/player.ts'
import { roomPayload } from '../src/game/room-snapshot.ts'

const source = '11111111-1111-4111-8111-111111111111'
const source2 = '22222222-2222-4222-8222-222222222222'
const soldier = '33333333-3333-4333-8333-333333333333'
const soldierCopy = '44444444-4444-4444-8444-444444444444'
const treasure = '55555555-5555-4555-8555-555555555555'
const unrelated = '66666666-6666-4666-8666-666666666666'
const card = (id, extra={}) => ({id, object:'card',...extra})
const related = (id) => ({id, component:'token', name:'Some token'})

function testApi() {
  const calls=[]
  const lookup = new Map([
    [source,card(source,{all_parts:[related(soldier),related(treasure)]})],
    [source2,card(source2,{all_parts:[related(soldierCopy)]})],
    [soldier,card(soldier,{name:'Soldier',type_line:'Token Creature — Soldier',power:'1',toughness:'1',colors:['W'],image_uris:{normal:'https://cards.scryfall.io/normal/front/3/3/token.jpg',art_crop:'https://cards.scryfall.io/art_crop/front/3/3/token.jpg'}})],
    [soldierCopy,card(soldierCopy,{name:'Soldier',type_line:'Token Creature — Soldier',power:'1',toughness:'1',colors:['W']})],
    [treasure,card(treasure,{name:'Treasure',type_line:'Token Artifact — Treasure',image_uris:{normal:'https://other.example/unsafe.jpg'}})],
  ])
  const request = async (url, options) => {
    assert.equal(url,'https://api.scryfall.com/cards/collection')
    const ids=JSON.parse(options.body).identifiers.map((i)=>i.id)
    calls.push(ids)
    return {ok:true,json:async()=>({data:ids.map(id=>lookup.get(id)).filter(Boolean)})}
  }
  return {calls,request}
}

test('uses Scryfall token links, retains printed stats/images and deduplicates equivalent printings', async()=>{
  const {calls,request}=testApi()
  const tokens=await resolveDeckTokenCards([source,source2,source,'not-a-uuid'],request)
  assert.deepEqual(calls[0],[source,source2])
  assert.equal(calls.length,2)
  assert.equal(tokens.length,2)
  assert.deepEqual(tokens.map(t=>t.name),['Soldier','Treasure'])
  assert.equal(tokens[0].imageUrl,'https://cards.scryfall.io/normal/front/3/3/token.jpg')
  assert.equal(tokens[0].printedPower,'1')
  assert.equal(tokens[0].printedToughness,'1')
  assert.ok(tokens[1].imageUrl.startsWith('https://cards.scryfall.io/normal/front/5/5/'))
  assert.ok(!tokens.some(t=>t.id===unrelated))
})

test('empty deck makes no requests; deck import no longer requires secondary token fetches',async()=>{
  const {calls,request}=testApi()
  assert.deepEqual(await resolveDeckTokenCards([],request),[])
  assert.equal(calls.length,0)
  await assert.rejects(resolveDeckTokenCards([source],async()=>({ok:false,status:429})),/429/)
  const client=readFileSync(new URL('../src/archidekt/client.ts',import.meta.url),'utf8')
  assert.doesNotMatch(client,/await resolveDeckTokenCards/)
})

test('generated token is validated by loaded deck, carries its official properties and synchronizes via room snapshots',()=>{
  const token={id:soldier,name:'Soldier',typeLine:'Token Creature — Soldier',imageUrl:'https://cards.scryfall.io/normal/front/3/3/token.jpg',artCropUrl:'https://cards.scryfall.io/art_crop/front/3/3/token.jpg',printedPower:'1',printedToughness:'1'}
  const a={...buildPlayer({name:'Alice',sessionId:'a',seat:1,identifier:'player-a'}),deckStatus:'loaded',deckTokens:[token]}
  const b={...buildPlayer({name:'Bob',sessionId:'b',seat:2,identifier:'player-b'})}
  const unchanged=applyPlayerAction({player:a,action:{type:'createToken',tokenId:unrelated}})
  assert.equal(unchanged.battlefield.length,0)
  const next=applyPlayerAction({player:a,action:{type:'createToken',tokenId:soldier}})
  assert.equal(next.battlefield.length,1)
  assert.equal(next.battlefield[0].isToken,true)
  assert.equal(next.battlefield[0].imageUrl,token.imageUrl)
  assert.equal(next.battlefield[0].printedPower,'1')
  const room={id:'room',code:'TEST',name:'Table',version:1,players:[next,b],createdAt:'',updatedAt:''}
  const owner=roomPayload({room,sessionId:'a'}).space.players[0]
  const guest=roomPayload({room,sessionId:'b'}).space.players[0]
  assert.equal(owner.deckTokens.length,1)
  assert.equal(guest.deckTokens,undefined)
  assert.equal(guest.battlefield[0].imageUrl,token.imageUrl)
})

test('the player picker searches any printed token with official artwork',()=>{
  const js=readFileSync(new URL('../public/shuffle.js',import.meta.url),'utf8')
  const section=js.slice(js.indexOf('function wireStage17TokenPicker('),js.indexOf('// ===== Stage 18: right-click actions'))
  assert.match(section,/\/api\/tokens\/search/)
  assert.match(section,/choices\.replaceChildren\(\)/)
  assert.match(section,/image\.src = token\.imageUrl/)
  assert.doesNotMatch(section,/for \(const \[id, label, detail\] of STAGE17_TOKENS\)/)
})
