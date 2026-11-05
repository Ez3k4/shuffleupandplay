import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {searchPrintedTokens, lookupPrintedToken, parseTokenDefinition} from '../src/archidekt/deck-token-cards.ts'
import {parseAction} from '../src/game/action.ts'
import {buildPlayer, applyPlayerAction} from '../src/game/player.ts'
import {roomPayload} from '../src/game/room-snapshot.ts'

const uuid = '11111111-2222-4333-8444-555555555555'
const id2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const official = {id:uuid,name:'Elephant',typeLine:'Token Creature — Elephant',imageUrl:`https://cards.scryfall.io/normal/front/1/1/${uuid}.jpg`,artCropUrl:`https://cards.scryfall.io/art_crop/front/1/1/${uuid}.jpg`,printedPower:'3',printedToughness:'3'}
const raw = {id:uuid,name:'Elephant',type_line:'Token Creature — Elephant',power:'3',toughness:'3',image_uris:{normal:official.imageUrl,art_crop:official.artCropUrl}}

const mockSearch = (result, status = 200) => async (url, options) => {
  const parsed = new URL(url)
  assert.equal(parsed.host, 'api.scryfall.com')
  assert.equal(parsed.pathname, '/cards/search')
  assert.equal(parsed.searchParams.get('include_extras'),'true')
  assert.equal(parsed.searchParams.get('unique'),'cards')
  assert.equal(parsed.searchParams.get('order'),'name')
  assert.ok(parsed.searchParams.get('q').startsWith('t:token'))
  assert.equal(options.headers.accept,'application/json')
  return {ok:status===200,status,json:async()=>result}
}

test('broad search works for any deck, returns real token artwork and paginates',async()=>{
  const request = mockSearch({data:[raw,{...raw,id:id2,type_line:'Creature — Human',name:'Not a token'}],has_more:true})
  const results = await searchPrintedTokens('',1,request)
  assert.equal(results.tokens.length,1)
  assert.equal(results.tokens[0].name,'Elephant')
  assert.equal(results.tokens[0].printedPower,'3')
  assert.equal(results.tokens[0].imageUrl, official.imageUrl)
  assert.equal(results.hasMore,true)
  assert.equal(results.page,1)
  const page2=await searchPrintedTokens('',2,request)
  assert.equal(page2.page,2)
})

test('search escapes user input and treats no matches as empty, not a fatal error',async()=>{
  let q=''
  const request=async(url)=>{q=new URL(url).searchParams.get('q');return {ok:false,status:404}}
  assert.deepEqual(await searchPrintedTokens('  elephant " special\\  ',1,request),{tokens:[],hasMore:false,page:1})
  assert.equal(q.startsWith('t:token name:'),true)
  assert.equal(q.includes('\\'),false)
  assert.equal(q.includes('special'),true)
})

test('Scryfall downtime gives an explicit failure',async()=>{
  await assert.rejects(searchPrintedTokens('Soldier',1,mockSearch({},429)),/HTTP 429/)
  await assert.rejects(lookupPrintedToken(uuid,async()=>({ok:false,status:503})),/HTTP 503/)
})

test('validate selected IDs against actual token cards, not arbitrary MTG cards',async()=>{
  const mock=async(url)=>{assert.equal(url,`https://api.scryfall.com/cards/${uuid}`);return {ok:true,status:200,json:async()=>raw}}
  assert.deepEqual(await lookupPrintedToken(uuid,mock),official)
  assert.equal(await lookupPrintedToken('../not-a-uuid',mock),null)
  assert.equal(await lookupPrintedToken(uuid,async()=>({ok:true,status:200,json:async()=>({...raw,type_line:'Creature — Elephant'})})),null)
})

test('action parser rejects forged card definitions, mismatched IDs and untrusted images',()=>{
  assert.equal(parseTokenDefinition({...official,imageUrl:'https://attacker.example/evil.png'}),null)
  assert.equal(parseAction({type:'createToken',tokenId:id2,tokenCard:official}),null)
  assert.equal(parseAction({type:'createToken',tokenId:uuid,tokenCard:{...official,typeLine:'Creature — Elephant'}}),null)
  const action=parseAction({type:'createToken',tokenId:uuid,tokenCard:official})
  assert.equal(action.tokenCard.id,uuid)
})

test('any deck can create an official token with correct stats, and opponents see it',()=>{
  const a=buildPlayer({name:'Alice',sessionId:'a',seat:1,identifier:'a'})
  const b=buildPlayer({name:'Bob',sessionId:'b',seat:2,identifier:'b'})
  assert.equal(a.deckTokens?.length??0,0)
  const action=parseAction({type:'createToken',tokenId:uuid,tokenCard:official})
  const next=applyPlayerAction({player:a,action})
  assert.equal(next.battlefield[0].name,'Elephant')
  assert.equal(next.battlefield[0].isToken,true)
  assert.equal(next.battlefield[0].printedToughness,'3')
  const room={id:'r',code:'ABC123',name:'Table',version:1,players:[next,b],createdAt:'',updatedAt:''}
  assert.equal(roomPayload({room,sessionId:'b'}).space.players[0].battlefield[0].imageUrl,official.imageUrl)
})

test('same-origin search and server validation are wired; browser does not use deck token list',()=>{
  const app=readFileSync(new URL('../src/server/app.ts',import.meta.url),'utf8')
  const js=readFileSync(new URL('../public/shuffle.js',import.meta.url),'utf8')
  const picker=js.slice(js.indexOf('function wireStage17TokenPicker('),js.indexOf('// ===== Stage 18: right-click actions'))
  assert.match(app,/path === "\/api\/tokens\/search"/)
  assert.match(app,/lookupPrintedToken\(id\)/)
  assert.match(app,/delete action\.tokenCard/)
  assert.match(picker,/\/api\/tokens\/search/)
  assert.match(picker,/Load more tokens/)
  assert.doesNotMatch(picker,/data-stage22-deck-tokens/)
  assert.match(picker,/type: 'createToken', tokenId: button\.dataset\.stage17TokenId/)
})
