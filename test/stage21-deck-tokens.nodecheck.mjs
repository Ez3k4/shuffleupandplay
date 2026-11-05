import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deckTokenPresetIds } from '../src/archidekt/token-suggestions.ts'

const card = (text, categories=['Main'], name='Something') => ({categories, quantity:1, card: { displayName:name, oracleCard: { name, text } }})
const deck = (cards, categories=[{name:'Main',includedInDeck:true}]) => ({ cards, categories })

test('recognizes only supported tokens created by deck card abilities', () => {
  const ids = deckTokenPresetIds(deck([
    card('Whenever this attacks, create a tapped Treasure token.'),
    card('Create two 1/1 white Soldier creature tokens.'),
    card('Create a 1/1 blue Thopter artifact creature token with flying.'),
    card('Exile target creature token. It cannot be regenerated.'),
  ]))
  assert.deepEqual(ids, ['treasure', 'soldier', 'thopter'])
})

test('ignores cards outside deck; supports explicitly listed Tokens & Extras', () => {
  const ids = deckTokenPresetIds(deck([
    card('Create a Clue token.', ['Maybeboard']),
    card('Create a Food token.', ['Main']),
    card('', ['Tokens & Extras'], 'Zombie'),
  ], [ {name:'Main',includedInDeck:true}, {name:'Maybeboard',includedInDeck:false}, {name:'Tokens & Extras',includedInDeck:false} ]))
  assert.deepEqual(ids, ['food','zombie'])
})

test('does not duplicate token presets when deck has multiple generators', () => {
  assert.deepEqual(deckTokenPresetIds(deck([card('Create a Treasure token.'),card('Create three Treasure tokens.')])), ['treasure'])
})

test('old decks with no token data still work and new picker searches Scryfall', () => {
  assert.deepEqual(deckTokenPresetIds({}),[])
  const js = readFileSync(new URL('../public/shuffle.js', import.meta.url),'utf8')
  assert.doesNotMatch(js,/const STAGE17_TOKENS = \[/)
  assert.match(js,/\/api\/tokens\/search/)
  assert.match(js,/choices\.replaceChildren\(\)/)
})

test('game snapshots expose hints to owner only and keep player sessions independent', () => {
  const snapshot = readFileSync(new URL('../src/game/room-snapshot.ts', import.meta.url),'utf8')
  assert.match(snapshot, /visible \? \{ deckTokenIds: player\.deckTokenIds \?\? \[\], deckTokens: player\.deckTokens \?\? \[\] \} : \{\}/)
})

test('opponent mirror is positioned by center divider, with no additional row', () => {
  const css = readFileSync(new URL('../public/application.css', import.meta.url),'utf8')
  assert.match(css,/stage16-opponent-panel:not\(\[hidden\]\) \.opponent-seat \.zone-summary\s*\{[^}]*bottom: 0\.35rem/s)
  assert.match(css,/\.hand-card\.stage21-raised/)
})
