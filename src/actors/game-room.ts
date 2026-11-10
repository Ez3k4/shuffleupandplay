import { randomUUID } from "node:crypto"

import {
  Actor,
  broadcastInvalidation,
  broadcastValue,
  type JsonObject,
  type PayloadBroadcasts,
} from "solid-objects"

import { MatchLog } from "./match-log.ts"
import { createEngineState, applyEngineCommand } from "../engine/reducer.ts"
import { seedEngineLibraries } from "../engine/zones.ts"
import { projectEngineServerView, type EngineServerView } from "../engine/server-view.ts"
import type { EngineState } from "../engine/types.ts"
import { parseAction } from "../game/action.ts"
import { applyPlayerAction, buildPlayer } from "../game/player.ts"
import { stampNewPendingSpells } from "../game/stack-order.ts"
import {
  broadcastObservables,
  isPlayerInRoom,
  playerForSession,
  roomPayload,
  seatFingerprints,
} from "../game/room-snapshot.ts"
import type { Card, Player, PlayerSummary, Room, RoomPayload } from "../game/types.ts"
import type { DeckTokenCard } from "../archidekt/deck-token-cards.ts"

const MAXIMUM_PLAYERS = 4

export function allowedPlayerCount(value: unknown): 2 | 3 | 4 {
  const number = Number(value)
  return number === 3 || number === 4 ? number : 2
}
const MAXIMUM_ROOM_NAME_LENGTH = 40
const MAXIMUM_PLAYER_NAME_LENGTH = 28
const DEFAULT_ROOM_NAME = "Gaming Table"
const IDLE_SWEEP_DELAY_MILLISECONDS = 5 * 60 * 1_000
const STARTING_LIFE = 20

export type GameViewer = {
  sessionId: string
  roomCode: string
}

export type DeckResult = {
  deckName: string
  cards: Card[]
  tokenPresetIds?: string[]
  deckTokens?: DeckTokenCard[]
}

type DeckEffectArguments = {
  deckId: string
  sessionId: string
  deckRequestId: string
}

export class GameRoom extends Actor {
  static override readonly actorType = "GameRoom"
  static override readonly stateVersion = 8
  static override readonly migrations = [
    {
      from: 1,
      to: 2,
      migrate: (state: JsonObject): JsonObject => ({
        ...state,
        seatRevisions: { "1": 1, "2": 1 },
      }),
    },
    {
      from: 2,
      to: 3,
      migrate: (state: JsonObject): JsonObject =>
        Object.fromEntries(Object.entries(state).filter(([name]) => name !== "seatRevisions")),
    },
    {
      from: 3,
      to: 4,
      migrate: (state: JsonObject): JsonObject => {
        const room = state.room
        if (!isRecord(room) || !Array.isArray(room.players)) return state

        return {
          ...state,
          room: {
            ...room,
            players: room.players.map((player) =>
              isRecord(player) ? { deckRequestId: null, ...player } : player,
            ),
          },
        }
      },
    },
    {
      from: 4,
      to: 5,
      migrate: (state: JsonObject): JsonObject => {
        const room = state.room
        if (!isRecord(room)) return state

        return { ...state, room: { idleSweepAt: null, ...room } }
      },
    },
    {
      from: 5,
      to: 6,
      migrate: (state: JsonObject): JsonObject => {
        const room = state.room
        if (!isRecord(room) || !Array.isArray(room.players)) return state

        return {
          ...state,
          room: {
            ...room,
            players: room.players.map((player) =>
              isRecord(player) ? { appliedMove: 0, ...player } : player,
            ),
          },
        }
      },
    },
    {
      from: 6,
      to: 7,
      migrate: (state: JsonObject): JsonObject => {
        // Preserve existing two-player tables when upgrading to multiplayer.
        const room = state.room
        if (!isRecord(room)) return state
        return { ...state, room: { maxPlayers: 2, ...room } }
      },
    },
    {
      from: 7,
      to: 8,
      migrate: (state: JsonObject): JsonObject => ({ ...state, experimentalEngine: null }),
    },
  ]

  static override readonly payloads = {
    game: (actor: GameRoom, viewer: GameViewer): RoomPayload => {
      const room = actor.room
      const sessionId = seatedSessionId(viewer)
      if (!room || !sessionId) return NO_ROOM
      if (!isPlayerInRoom({ room, sessionId })) return NO_ROOM

      return roomPayload({ room, sessionId })
    },
  } satisfies PayloadBroadcasts<GameRoom, GameViewer>

  room: Room | null = null
  /** Persisted separately from the existing manual tabletop Room. */
  experimentalEngine: EngineState | null = null

  get roomName(): string | null {
    return this.room?.name ?? null
  }

  get playerCount(): number {
    return this.room?.players.length ?? 0
  }

  override observables(): Record<string, unknown> {
    const seats = this.room ? seatFingerprints(this.room) : []
    const broadcast = broadcastObservables(this.room)

    return {
      version: broadcastValue(broadcast.version),
      lifeTotals: broadcastValue(broadcast.lifeTotals),
      seatOne: broadcastInvalidation(seats.find((seat) => seat.seat === 1) ?? null),
      seatTwo: broadcastInvalidation(seats.find((seat) => seat.seat === 2) ?? null),
      seatThree: broadcastInvalidation(seats.find((seat) => seat.seat === 3) ?? null),
      seatFour: broadcastInvalidation(seats.find((seat) => seat.seat === 4) ?? null),
    }
  }

  createRoom(options: {
    code: string
    roomName: string
    maxPlayers?: number
    playerName: string
    sessionId: string
  }): "created" {
    if (this.room) {
      this.reject("roomExists", { message: "This room code is already in use" })
    }

    const timestamp = new Date().toISOString()
    const creator = buildPlayer({
      name: normalizedName({
        value: options.playerName,
        fallback: "Player 1",
        maximumLength: MAXIMUM_PLAYER_NAME_LENGTH,
      }),
      sessionId: options.sessionId,
      seat: 1,
      identifier: randomUUID(),
    })

    this.room = {
      id: randomUUID(),
      code: options.code,
      name: normalizedName({
        value: options.roomName,
        fallback: DEFAULT_ROOM_NAME,
        maximumLength: MAXIMUM_ROOM_NAME_LENGTH,
      }),
      version: 1,
      idleSweepAt: null,
      maxPlayers: allowedPlayerCount(options.maxPlayers),
      players: [creator],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.#log({ event: "roomCreated", detail: creator.name })
    return "created"
  }

  join(options: { playerName: string; sessionId: string }): "joined" | "alreadyJoined" {
    const room = this.#requireRoom()
    if (playerForSession({ room, sessionId: options.sessionId })) return "alreadyJoined"

    const capacity = Math.min(MAXIMUM_PLAYERS, allowedPlayerCount(room.maxPlayers))
    if (room.players.length >= capacity) {
      this.reject("roomFull", { message: `This table is full (${capacity} players)` })
    }

    const seat = room.players.length + 1
    const player = buildPlayer({
      name: normalizedName({
        value: options.playerName,
        fallback: `Player ${seat}`,
        maximumLength: MAXIMUM_PLAYER_NAME_LENGTH,
      }),
      sessionId: options.sessionId,
      seat,
      identifier: randomUUID(),
    })

    this.#commit({ room: { ...room, players: [...room.players, player] } })
    this.#log({ event: "playerJoined", detail: player.name })
    return "joined"
  }

  /**
   * Experimental mode is separate from manual play. Only seat one can initialize,
   * and only after two seats have been filled. Card definitions come from the
   * server's already-imported deck data, never from an HTTP request body.
   */
  startExperimentalEngine(options: { sessionId: string }): "started" | "alreadyStarted" {
    const room = this.#requireRoom()
    const caller = this.#requirePlayer({ room, sessionId: options.sessionId })
    if (room.players[0]?.id !== caller.id) {
      this.reject("engineHostOnly", { message: "Only the first seated player can start this experiment" })
    }
    if (room.players.length !== 2 || allowedPlayerCount(room.maxPlayers) !== 2) {
      this.reject("engineTwoPlayers", { message: "The prototype requires exactly two players" })
    }
    if (this.experimentalEngine) return "alreadyStarted"

    const [first, second] = room.players
    if (!first || !second) throw new Error("Missing experimental engine participant")
    if (first.deckStatus !== "loaded" || second.deckStatus !== "loaded") {
      this.reject("engineNeedsDecks", { message: "Both players need loaded decks before starting" })
    }
    const engine = createEngineState(first.id, second.id)
    // Snapshots of the server-trusted imported libraries, not untrusted card
    // definitions supplied by a browser. No automatic shuffling or initial hand.
    try {
      this.experimentalEngine = seedEngineLibraries(engine, [
        { playerId: first.id, cardDefinitionIds: first.library.map(engineCardDefinitionId) },
        { playerId: second.id, cardDefinitionIds: second.library.map(engineCardDefinitionId) },
      ])
    } catch {
      this.reject("engineInvalidDecks", { message: "The loaded decks are not usable by the prototype" })
    }
    this.#commit({ room })
    return "started"
  }

  /** Server-authorized PASS_PRIORITY only. Never expose the 27B–D prototype commands. */
  passExperimentalPriority(options: { sessionId: string }): "applied" {
    const room = this.#requireRoom()
    const player = this.#requirePlayer({ room, sessionId: options.sessionId })
    if (!this.experimentalEngine) {
      this.reject("engineNotStarted", { message: "The experimental engine has not started" })
    }
    const transition = applyEngineCommand(this.experimentalEngine, player.id, {
      type: "PASS_PRIORITY",
    })
    if (!transition.accepted) {
      this.reject("engineIllegalCommand", { message: transition.reason })
    }
    this.experimentalEngine = transition.state
    this.#commit({ room })
    return "applied"
  }

  /** The ONLY engine response returned to HTTP: always project for the seated viewer. */
  experimentalEngineView(options: { sessionId: string }): EngineServerView {
    const room = this.#requireRoom()
    const player = this.#requirePlayer({ room, sessionId: options.sessionId })
    return projectEngineServerView(this.experimentalEngine, player.id, room.version)
  }

  requestDeck(options: { deckId: string; sessionId: string }): "requested" {
    const room = this.#requireRoom()
    const player = this.#requirePlayer({ room, sessionId: options.sessionId })
    const deckRequestId = randomUUID()

    this.#replacePlayer({ room, player: { ...player, deckStatus: "loading", deckRequestId } })
    this.emit("fetchArchidektDeck", {
      arguments: { deckId: options.deckId, sessionId: options.sessionId, deckRequestId },
      onSuccess: "deckLoaded",
      onFailure: "deckFailed",
    })
    this.#log({ event: "deckRequested", detail: options.deckId })
    return "requested"
  }

  deckLoaded(options: {
    effectId: string
    arguments: DeckEffectArguments
    result: DeckResult | null
  }): void {
    const room = this.room
    const result = options.result
    if (!room || !result) return

    const player = playerForSession({ room, sessionId: options.arguments.sessionId })
    if (!player) return
    if (player.deckRequestId !== options.arguments.deckRequestId) return

    const { openingHand: _previousOpening, commander: _previousCommander, commanderInstanceId: _previousCommanderId, ...freshPlayer } = player
    this.#replacePlayer({
      room,
      player: {
        ...freshPlayer,
        life: STARTING_LIFE,
        deckName: result.deckName,
        deckStatus: "loaded",
        deckTokenIds: result.tokenPresetIds ?? [],
        deckTokens: result.deckTokens ?? [],
        deckRequestId: null,
        library: result.cards,
        hand: [],
        battlefield: [],
        pendingSpells: [],
        graveyard: [],
        exile: [],
        isSearchingDeck: false,
      },
    })
    this.#log({ event: "deckLoaded", detail: result.deckName })
  }

  deckFailed(options: {
    effectId: string
    arguments: DeckEffectArguments
    error: JsonObject
  }): void {
    const room = this.room
    if (!room) return

    const player = playerForSession({ room, sessionId: options.arguments.sessionId })
    if (!player || player.deckStatus !== "loading") return
    if (player.deckRequestId !== options.arguments.deckRequestId) return

    this.#replacePlayer({ room, player: { ...player, deckStatus: "failed", deckRequestId: null } })
    this.#log({ event: "deckFailed", detail: String(options.error.message ?? "unknown") })
  }

  applyAction(options: {
    action: JsonObject
    sessionId: string
    moveNumber?: number
  }): "applied" {
    const room = this.#requireRoom()
    const player = this.#requirePlayer({ room, sessionId: options.sessionId })
    const action = parseAction(options.action)
    if (!action) {
      this.reject("invalidAction", {
        message: "The action payload is not a supported game action",
      })
    }

    const updated = applyPlayerAction({ player, action })
    const sequenced = stampNewPendingSpells({ before: player, after: updated, roomVersion: room.version })
    this.#replacePlayer({
      room,
      player: { ...sequenced, appliedMove: advancedMove({ player, moveNumber: options.moveNumber }) },
    })
    this.#armIdleSweep()
    this.commitAction("recordActionMetric", {
      roomCode: room.code,
      actionType: action.type,
      seat: player.seat,
    })
    return "applied"
  }

  sweepIdleState(options: { armedAt: number }): "swept" | "unchanged" {
    const room = this.room
    if (!room) return "unchanged"

    if (room.idleSweepAt !== options.armedAt) return "unchanged"
    if (!room.players.some((player) => player.isSearchingDeck)) return "unchanged"

    this.#commit({
      room: {
        ...room,
        idleSweepAt: null,
        players: room.players.map((player) => ({ ...player, isSearchingDeck: false })),
      },
    })
    return "swept"
  }

  reconcile(): "reconciled" {
    this.#armIdleSweep()
    return "reconciled"
  }

  #armIdleSweep(): void {
    const room = this.room
    if (!room) return

    if (!room.players.some((player) => player.isSearchingDeck)) {
      if (room.idleSweepAt !== null) this.room = { ...room, idleSweepAt: null }
      return
    }

    const armedAt = Date.now() + IDLE_SWEEP_DELAY_MILLISECONDS
    this.room = { ...room, idleSweepAt: armedAt }
    this.schedule({ at: new Date(armedAt) }).sweepIdleState?.({ armedAt })
  }

  #requireRoom(): Room {
    if (!this.room) {
      this.reject("roomNotFound", { message: "This space does not exist" })
    }
    return this.room
  }

  #requirePlayer(options: { room: Room; sessionId: string }): Player {
    const player = playerForSession(options)
    if (!player) {
      this.reject("notAPlayer", { message: "You are not a player in this space" })
    }
    return player
  }

  #replacePlayer(options: { room: Room; player: Player }): void {
    const { room, player } = options
    this.#commit({
      room: {
        ...room,
        players: room.players.map((candidate) =>
          candidate.id === player.id ? player : candidate,
        ),
      },
    })
  }

  #commit(options: { room: Room }): void {
    this.room = {
      ...options.room,
      version: options.room.version + 1,
      updatedAt: new Date().toISOString(),
    }
  }

  #log(options: { event: string; detail: string }): void {
    this.sendTo(MatchLog.ref(this.actorId)).record(options)
  }
}

export type { PlayerSummary }

const NO_ROOM: RoomPayload = { space: null, currentPlayerId: null }

function advancedMove(options: { player: Player; moveNumber: number | undefined }): number {
  const { moveNumber } = options
  if (typeof moveNumber !== "number" || !Number.isSafeInteger(moveNumber)) {
    return options.player.appliedMove
  }

  return Math.max(options.player.appliedMove, moveNumber)
}

function seatedSessionId(viewer: GameViewer | undefined): string | null {
  if (!viewer || typeof viewer.sessionId !== "string") return null

  return viewer.sessionId.length > 0 ? viewer.sessionId : null
}

function normalizedName(options: {
  value: unknown
  fallback: string
  maximumLength: number
}): string {
  if (typeof options.value !== "string") return options.fallback

  const trimmed = options.value.trim()
  return trimmed.length === 0 ? options.fallback : trimmed.slice(0, options.maximumLength)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function engineCardDefinitionId(card: Card): string {
  const id = typeof card.scryfallId === "string" ? card.scryfallId.trim() : ""
  if (id) return id
  return typeof card.name === "string" ? card.name.trim() : ""
}
