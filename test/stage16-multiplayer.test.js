// @vitest-environment happy-dom
import { describe, test, expect } from 'vitest'
import { buildPlayer } from '../src/game/player.ts'
import { roomPayload } from '../src/game/room-snapshot.ts'
import { allowedPlayerCount } from '../src/actors/game-room.ts'
import { gamePage, lobbyPage, componentDeclarations } from '../src/server/render/pages.ts'
import { renderComponent } from '../src/server/render/components.ts'
import { mountStage16OpponentSelector } from '../public/stage16-opponents.js'

function makeRoom(count = 4, maxPlayers = 4) {
  const players = ['Alice', 'Bob', 'Clara', 'David'].slice(0, count)
    .map((name, index) => buildPlayer({ name, seat: index + 1,
      sessionId: `session${index + 1}`, identifier: `player${index + 1}` }))
  return { id:'table', code:'ABC123', name:'Table', maxPlayers, players,
    version: 1, createdAt:'now', updatedAt:'now' }
}

function context(room, seat = 1) {
  return { payload: roomPayload({ room, sessionId: `session${seat}` }),
    roomCode: room.code, seat, shareUrl:'https://example.org/tables/ABC123' }
}

describe('Stage 16 — 2/3/4-player mode', () => {
  test('validates 2-4 seats and preserves old two-player defaults', () => {
    expect([2,3,4].map(allowedPlayerCount)).toEqual([2,3,4])
    expect(allowedPlayerCount(99)).toBe(2)
    expect(allowedPlayerCount(undefined)).toBe(2)
    expect(roomPayload({ room: { ...makeRoom(2), maxPlayers: undefined }, sessionId:'session1' }).space.maxPlayers).toBe(2)
  })

  test('creation form contains a 2/3/4 player selector', () => {
    const page = lobbyPage({ joinCode:null, error:null })
    const root = document.createElement('div'); root.innerHTML = page
    const choices = [...root.querySelectorAll('[name="maxPlayers"] option')].map(el => el.value)
    expect(choices).toEqual(['2','3','4'])
  })

  test('each seat subscribes to every other possible seat before they join', () => {
    for (const seat of [1,2,3,4]) {
      const declarations = componentDeclarations(seat)
      const playerSeats = declarations.filter(c=>c.name==='player').map(c=>c.key).sort()
      expect(playerSeats).toEqual([1,2,3,4])
      expect(declarations.find(c=>c.name==='opponentRoster').observes)
        .toEqual(['seatOne','seatTwo','seatThree','seatFour'])
    }
  })

  test('private hands stay hidden for all three opponents', () => {
    const room = makeRoom()
    for (const player of room.players) {
      player.hand = [{ instanceId:`secret-${player.seat}`, name:`Hidden ${player.seat}`,
        scryfallId:'s', imageUrl:'', tapped:false, isManaSource:false }]
    }
    const payload = roomPayload({ room, sessionId:'session3' })
    for (const player of payload.space.players) {
      expect(player.hand[0].name).toBe(player.seat === 3 ? 'Hidden 3' : 'Hidden card')
    }
    const roster = renderComponent({ name:'opponentRoster', context: context(room, 3), key:undefined })
    expect(roster).toContain('Alice')
    expect(roster).toContain('Bob')
    expect(roster).toContain('David')
    expect(roster).not.toContain('Clara')
  })

  test('viewer gets exactly one own seat and three replaceable opponent views', () => {
    const room = makeRoom()
    for (const seat of [1,2,3,4]) {
      const page = gamePage({ payload:context(room,seat).payload, roomCode:'ABC123', seat, shareUrl:'https://example.org' })
      const root = document.createElement('div'); root.innerHTML = page
      const panels = [...root.querySelectorAll('[data-stage16-opponent-panel]')]
      expect(panels).toHaveLength(3)
      expect(panels.map(p=>Number(p.dataset.stage16OpponentPanel)).includes(seat)).toBe(false)
      expect(root.querySelectorAll('.your-seat')).toHaveLength(1)
      expect(root.querySelectorAll('.stage16-opponent-choice')).toHaveLength(3)
    }
  })

  test('opponent selector stays outside the battlefield and collapsed settings', () => {
    const room = makeRoom(3, 3)
    const root = document.createElement('div')
    root.innerHTML = gamePage({ payload:context(room,1).payload, roomCode:'ABC123', seat:1, shareUrl:'https://example.org' })
    document.body.append(root)
    const game = root.querySelector('[data-game]')
    const toolbar = game.querySelector('.compact-tabletop-toolbar')
    const details = toolbar.querySelector('[data-compact-toolbar]')
    expect(details.open).toBe(false)
    expect(toolbar.querySelector('#component-opponentRoster')).not.toBeNull()
    expect(details.contains(toolbar.querySelector('#component-opponentRoster'))).toBe(false)
    expect(game.querySelector('#players-area #component-opponentRoster')).toBeNull()

    const stop = mountStage16OpponentSelector(game)
    toolbar.querySelector('[data-stage16-select-seat="3"]').click()
    expect(game.querySelector('[data-stage16-opponent-panel="3"]').hidden).toBe(false)
    expect(details.open).toBe(false)
    stop(); root.remove()
  })

  test('clicks switch the highlighted opponent without modifying game state', () => {
    const room = makeRoom()
    const root = document.createElement('div')
    root.innerHTML = gamePage({ payload:context(room,1).payload, roomCode:'ABC123', seat:1, shareUrl:'https://example.org' })
    document.body.append(root)
    const game = root.querySelector('[data-game]')
    const stop = mountStage16OpponentSelector(game)
    const choice = game.querySelector('[data-stage16-select-seat="4"]')
    choice.click()
    expect(choice.getAttribute('aria-pressed')).toBe('true')
    expect(game.querySelector('[data-stage16-opponent-panel="4"]').hidden).toBe(false)
    expect(game.querySelector('[data-stage16-opponent-panel="2"]').hidden).toBe(true)
    expect(game.querySelector('.your-seat')).not.toBeNull()
    stop(); root.remove()
  })
})
