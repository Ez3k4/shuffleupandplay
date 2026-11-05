import type { GameAction } from "./action.ts"
import { defaultRandomness, type Randomness } from "./randomness.ts"
import type { BattlefieldCard, Card, CardCounter, Player, ZoneName } from "./types.ts"

const STARTING_LIFE = 20
const LIFE_RANGE = { minimum: 0, maximum: 999 }
const COUNTER_VALUE_RANGE = { minimum: -999, maximum: 999 }
const TABLE_RANGE = { x: { minimum: 0, maximum: 1200 }, y: { minimum: 0, maximum: 700 } }
const COUNTER_RANGE = { x: { minimum: 0, maximum: 96 }, y: { minimum: 0, maximum: 136 } }
const DRAW_RANGE = { minimum: 1, maximum: 12 }
const MAXIMUM_COUNTER_LABEL_LENGTH = 9
const COUNTER_FOOTPRINT = { width: 78, height: 28 }
const COUNTER_SLOT_POSITION = { x: 8, y: 8 }
const COUNTER_SLOT_STEP = 29
const COUNTER_SLOT_COUNT = 5
const PLAY_POSITION = { x: 240, y: 140 }
const PLAY_STAGGER = 26
const PLAY_COLUMNS = 6
const PLAY_ROWS = 4
const DROP_POSITION = { x: 40, y: 40 }

export interface BuildPlayerOptions {
  name: string
  sessionId: string
  seat: number
  identifier: string
}

export function buildPlayer(options: BuildPlayerOptions): Player {
  return {
    id: options.identifier,
    sessionId: options.sessionId,
    name: options.name,
    seat: options.seat,
    life: STARTING_LIFE,
    deckName: null,
    deckStatus: "idle",
    deckRequestId: null,
    library: [],
    hand: [],
    battlefield: [],
    pendingSpells: [],
    graveyard: [],
    exile: [],
    isSearchingDeck: false,
    appliedMove: 0,
  }
}

export interface ApplyPlayerActionOptions {
  player: Player
  action: GameAction
  randomness?: Randomness
}

export function applyPlayerAction(options: ApplyPlayerActionOptions): Player {
  const { action } = options
  const player = structuredClone(options.player)
  const randomness = options.randomness ?? defaultRandomness

  // Mulligans are disabled. Keep normal actions available even for saved
  // tables whose players still have an unfinished openingHand state.
  if (["beginOpeningHand", "redrawOpeningHand", "keepOpeningHand", "finishOpeningHand"].includes(action.type)) {
    return player
  }
  switch (action.type) {
    case "beginOpeningHand":
      return beginOpeningHand(player, action.format, randomness)
    case "redrawOpeningHand":
      return redrawOpeningHand(player, randomness)
    case "keepOpeningHand":
      return keepOpeningHand(player)
    case "finishOpeningHand":
      return finishOpeningHand(player, action.instanceIds)
    case "stage10DesignateCommander":
      return stage10DesignateCommander(player, action.instanceId)
    case "stage10PlayCommander":
      return stage10PlayCommander(player)
    case "stage10ReturnCommander":
      return stage10ReturnCommander(player)
    case "stage10ReselectCommander":
      return stage10ReselectCommander(player, action.instanceId)
    case "drawCard":
      return drawCards({ player, count: action.count ?? 1 })
    case "shuffleLibrary":
      return { ...player, library: randomness.shuffle(player.library) }
    case "untapAll":
      return untapAll(player)
    case "openDeckSearch":
      return { ...player, isSearchingDeck: true }
    case "closeDeckSearch":
      return { ...player, isSearchingDeck: false }
    case "moveLibraryCardToHand":
      return moveLibraryCardToHand({ player, instanceId: action.instanceId })
    case "playFromHand":
      return playFromHand({ player, instanceId: action.instanceId })
    case "resolveSpell":
      return resolveSpell(player, action.instanceId)
    case "toggleTap":
      return toggleTap({ player, instanceId: action.instanceId })
    case "setAttachment":
      return setAttachment({ player, instanceId: action.instanceId, targetInstanceId: action.targetInstanceId })
    case "moveBattlefieldCard":
      return moveBattlefieldCard({ player, instanceId: action.instanceId, x: action.x, y: action.y })
    case "moveCardZone":
      return moveCardBetweenZones({ player, action })
    case "moveToDeck":
      return moveToDeck({ player, action, randomness })
    case "adjustLife":
      return { ...player, life: clamp(player.life + action.delta, LIFE_RANGE) }
    case "resetLife":
      return { ...player, life: STARTING_LIFE }
    case "setLife":
      return { ...player, life: clamp(action.value, LIFE_RANGE) }
    case "addCounter":
      return addCounter({ player, action, randomness })
    case "moveCounter":
      return moveCounter({ player, action })
    case "updateCounterValue":
      return updateCounterValue({ player, action })
  }
}

// Stage 9: a London mulligan starts with seven cards and only bottoms on keep.
// Repeated redraws use the tournament shortcut: shuffle the current hand back
// without bottoming first, then bottom the final required number upon keeping.
function openingBottomCount(mulligans: number, format: "commander" | "standard"): number {
  return Math.max(0, mulligans - (format === "commander" ? 1 : 0))
}

function beginOpeningHand(player: Player, format: "commander" | "standard", randomness: Randomness): Player {
  if (player.deckStatus !== "loaded" || player.openingHand) return player
  if (player.battlefield.length || player.graveyard.length || player.exile.length) return player
  if (player.hand.length !== 0 && player.hand.length !== 7) return player
  if (player.hand.length === 0 && player.library.length < 7) return player
  // Existing seven-card hands are adopted rather than drawn twice.
  const library = player.hand.length === 7 ? player.library : randomness.shuffle(player.library)
  return {
    ...player,
    library: player.hand.length === 7 ? library : library.slice(7),
    hand: player.hand.length === 7 ? player.hand : library.slice(0, 7),
    openingHand: { phase: "choosing", format, mulligans: 0, bottomCount: 0 },
  }
}

function redrawOpeningHand(player: Player, randomness: Randomness): Player {
  const state = player.openingHand
  if (!state || state.phase !== "choosing" || player.hand.length !== 7) return player
  const mulligans = state.mulligans + 1
  if (openingBottomCount(mulligans, state.format) > 7) return player
  const shuffled = randomness.shuffle([...player.library, ...player.hand])
  if (shuffled.length < 7) return player
  return {
    ...player,
    library: shuffled.slice(7),
    hand: shuffled.slice(0, 7),
    openingHand: {
      ...state,
      mulligans,
      bottomCount: openingBottomCount(mulligans, state.format),
    },
  }
}

function keepOpeningHand(player: Player): Player {
  const state = player.openingHand
  if (!state || state.phase !== "choosing" || player.hand.length !== 7) return player
  return {
    ...player,
    openingHand: {
      ...state,
      phase: state.bottomCount === 0 ? "kept" : "bottoming",
    },
  }
}

function finishOpeningHand(player: Player, instanceIds: string[]): Player {
  const state = player.openingHand
  if (!state || state.phase !== "bottoming") return player
  if (instanceIds.length !== state.bottomCount || new Set(instanceIds).size !== instanceIds.length) return player
  const byId = new Map(player.hand.map((card) => [card.instanceId, card] as const))
  const bottomCards = instanceIds.map((id) => byId.get(id))
  if (bottomCards.some((card) => card === undefined)) return player
  const chosen = new Set(instanceIds)
  return {
    ...player,
    hand: player.hand.filter((card) => !chosen.has(card.instanceId)),
    // Click order determines the ordering at the bottom of the library.
    library: [...player.library, ...bottomCards.filter((card): card is Card => card !== undefined)],
    openingHand: { ...state, phase: "kept" },
  }
}

// Stage 10A: one manually selected Commander; never duplicate the card.
// Commands are server-authoritative because the optional offline mirror does
// not understand these new actions yet.
function stage10DesignateCommander(player: Player, instanceId: string): Player {
  if (player.commanderInstanceId || player.deckStatus !== "loaded") return player
  const sourceZones = ["library", "hand", "battlefield", "graveyard", "exile"] as const
  const from = sourceZones.find((zone) => player[zone].some((card) => card.instanceId === instanceId))
  if (!from) return player
  const removal = removeCard({ player, zone: from, instanceId })
  if (!removal) return player
  const battlefield = from === "battlefield"
    ? stage10UnlinkHost(removal.remainder.battlefield, instanceId)
    : removal.remainder.battlefield
  return {
    ...removal.remainder,
    battlefield,
    commander: deckCard(removal.card),
    commanderInstanceId: instanceId,
  }
}

// Correct an accidental Commander choice without creating or losing cards.
// Only available while the current Commander is in its command zone.
// The former Commander takes the replacement card's exact old slot.
function stage10ReselectCommander(player: Player, instanceId: string): Player {
  const previous = player.commander
  if (!previous || !player.commanderInstanceId || previous.instanceId === instanceId) return player
  const zones = ["library", "hand", "battlefield", "graveyard", "exile"] as const
  const from = zones.find((zone) => player[zone].some((card) => card.instanceId === instanceId))
  if (!from) return player
  const replacement = player[from].find((card) => card.instanceId === instanceId)
  if (!replacement) return player
  const oldCard = deckCard(previous)
  if (from === "battlefield") {
    const battlefield = stage10UnlinkHost(player.battlefield, instanceId).map((card) =>
      card.instanceId === instanceId
        ? battlefieldCard({ card: { ...oldCard, tapped: false }, x: card.x, y: card.y })
        : card,
    )
    return {
      ...player,
      battlefield,
      commander: deckCard(replacement),
      commanderInstanceId: instanceId,
    }
  }
  return {
    ...player,
    [from]: player[from].map((card) => card.instanceId === instanceId ? oldCard : card),
    commander: deckCard(replacement),
    commanderInstanceId: instanceId,
  }
}

function stage10PlayCommander(player: Player): Player {
  if (!player.commander || !player.commanderInstanceId) return player
  const card = player.commander
  const { commander: _commander, ...remainder } = player
  return {
    ...remainder,
    battlefield: [
      ...player.battlefield,
      battlefieldCard({ card: { ...card, tapped: false }, ...freePlayPosition(player.battlefield) }),
    ],
  }
}

function stage10ReturnCommander(player: Player): Player {
  const id = player.commanderInstanceId
  if (!id || player.commander) return player
  const zones = ["battlefield", "graveyard", "exile", "hand", "library"] as const
  const from = zones.find((zone) => player[zone].some((card) => card.instanceId === id))
  if (!from) return player
  const removal = removeCard({ player, zone: from, instanceId: id })
  if (!removal) return player
  return {
    ...removal.remainder,
    battlefield: from === "battlefield"
      ? stage10UnlinkHost(removal.remainder.battlefield, id)
      : removal.remainder.battlefield,
    commander: deckCard(removal.card),
  }
}

// An attached Aura/Equipment must not retain a dangling host reference when
// the Commander moves to its command zone. The attachments remain in play.
function stage10UnlinkHost(cards: BattlefieldCard[], instanceId: string): BattlefieldCard[] {
  return cards.map((card) => {
    if (card.attachedTo !== instanceId) return card
    const { attachedTo: _oldHost, ...detached } = card
    return detached
  })
}

function drawCards(options: { player: Player; count: number }): Player {
  const { player } = options
  if (player.library.length === 0) return player

  const count = clamp(Math.trunc(options.count), DRAW_RANGE)
  return {
    ...player,
    library: player.library.slice(count),
    hand: [...player.hand, ...player.library.slice(0, count)],
  }
}

function moveLibraryCardToHand(options: { player: Player; instanceId: string }): Player {
  const { player, instanceId } = options
  const card = player.library.find((candidate) => candidate.instanceId === instanceId)
  if (!card) return player

  return {
    ...player,
    library: withoutCard({ cards: player.library, instanceId }),
    hand: [...player.hand, card],
  }
}

function playFromHand(options: { player: Player; instanceId: string }): Player {
  const { player, instanceId } = options
  const card = player.hand.find((candidate) => candidate.instanceId === instanceId)
  if (!card) return player

  // Stage 11: do not treat instant/sorcery spells as battlefield permanents.
  // Persist them in their controller's pending spell list until Resolve is pressed.
  // Existing decks without typeLine metadata may need to be re-imported.
  if (/\b(?:Instant|Sorcery)\b/i.test(card.typeLine ?? "")) {
    return {
      ...player,
      hand: withoutCard({ cards: player.hand, instanceId }),
      pendingSpells: [...(player.pendingSpells ?? []), deckCard(card)],
    }
  }

  return {
    ...player,
    hand: withoutCard({ cards: player.hand, instanceId }),
    battlefield: [
      ...player.battlefield,
      battlefieldCard({ card, ...freePlayPosition(player.battlefield) }),
    ],
  }
}

function resolveSpell(player: Player, instanceId: string): Player {
  const pending = player.pendingSpells ?? []
  const spell = pending.find((card) => card.instanceId === instanceId)
  if (!spell) return player
  return {
    ...player,
    pendingSpells: pending.filter((card) => card.instanceId !== instanceId),
    graveyard: [...player.graveyard, deckCard(spell)],
  }
}

function freePlayPosition(battlefield: BattlefieldCard[]): { x: number; y: number } {
  for (let slot = 0; slot < PLAY_COLUMNS * PLAY_ROWS; slot += 1) {
    const x = PLAY_POSITION.x + (slot % PLAY_COLUMNS) * PLAY_STAGGER
    const y = PLAY_POSITION.y + Math.floor(slot / PLAY_COLUMNS) * PLAY_STAGGER
    if (!battlefield.some((card) => card.x === x && card.y === y)) return { x, y }
  }
  return PLAY_POSITION
}

// An attachment is a presentation relationship, not a separate zone.
// Only one player's own battlefield is supported in this first stage.
// Do not allow cycles, attachment-to-attachment, or attaching a card which
// already has something attached to it; those cases need deeper layout logic.
function setAttachment(options: {
  player: Player
  instanceId: string
  targetInstanceId: string | null
}): Player {
  const { player, instanceId, targetInstanceId } = options
  const source = player.battlefield.find((card) => card.instanceId === instanceId)
  if (!source) return player
  if (targetInstanceId === null) {
    return {
      ...player,
      battlefield: player.battlefield.map((card) => {
        if (card.instanceId !== instanceId) return card
        const { attachedTo: _attachedTo, ...detached } = card
        return detached
      }),
    }
  }
  const target = player.battlefield.find((card) => card.instanceId === targetInstanceId)
  if (!target || target.instanceId === source.instanceId || target.attachedTo ||
      player.battlefield.some((card) => card.attachedTo === source.instanceId)) return player
  return {
    ...player,
    battlefield: player.battlefield.map((card) => card.instanceId === instanceId
      ? { ...card, attachedTo: targetInstanceId, x: target.x, y: target.y } : card),
  }
}

function toggleTap(options: { player: Player; instanceId: string }): Player {
  const { player, instanceId } = options
  return {
    ...player,
    battlefield: player.battlefield.map((card) =>
      card.instanceId === instanceId ? { ...card, tapped: !card.tapped } : card,
    ),
  }
}

function untapAll(player: Player): Player {
  return {
    ...player,
    battlefield: player.battlefield.map((card) => ({ ...card, tapped: false })),
  }
}

function moveBattlefieldCard(options: {
  player: Player
  instanceId: string
  x: number
  y: number
}): Player {
  const { player, instanceId } = options
  const x = clamp(options.x, TABLE_RANGE.x)
  const y = clamp(options.y, TABLE_RANGE.y)
  return {
    ...player,
    battlefield: player.battlefield.map((card) => {
      if (card.instanceId === instanceId) {
        const { attachedTo: _attachedTo, ...detached } = card
        return { ...detached, x, y }
      }
      return card.attachedTo === instanceId ? { ...card, x, y } : card
    }),
  }
}

function moveCardBetweenZones(options: {
  player: Player
  action: Extract<GameAction, { type: "moveCardZone" }>
}): Player {
  const { player, action } = options
  if (action.from === action.to) return player

  const removal = removeCard({ player, zone: action.from, instanceId: action.instanceId })
  if (!removal) return player

  const { card, remainder } = removal
  if (action.to !== "battlefield") {
    return { ...remainder, [action.to]: [...remainder[action.to], deckCard(card)] }
  }

  return {
    ...remainder,
    battlefield: [
      ...remainder.battlefield,
      battlefieldCard({
        card: deckCard(card),
        x: clamp(action.x ?? DROP_POSITION.x, TABLE_RANGE.x),
        y: clamp(action.y ?? DROP_POSITION.y, TABLE_RANGE.y),
      }),
    ],
  }
}

function moveToDeck(options: {
  player: Player
  action: Extract<GameAction, { type: "moveToDeck" }>
  randomness: Randomness
}): Player {
  const { player, action, randomness } = options
  const removal = removeCard({ player, zone: action.from, instanceId: action.instanceId })
  if (!removal) return player

  const { remainder } = removal
  const card = deckCard(removal.card)
  if (action.position === "top") return { ...remainder, library: [card, ...remainder.library] }
  if (action.position === "bottom") return { ...remainder, library: [...remainder.library, card] }

  return { ...remainder, library: randomness.shuffle([...remainder.library, card]) }
}

function addCounter(options: {
  player: Player
  action: Extract<GameAction, { type: "addCounter" }>
  randomness: Randomness
}): Player {
  const { player, action, randomness } = options
  const label = (action.label ?? "+1/+1").slice(0, MAXIMUM_COUNTER_LABEL_LENGTH)
  const requested = {
    x: clamp(action.x, COUNTER_RANGE.x),
    y: clamp(action.y, COUNTER_RANGE.y),
  }

  return {
    ...player,
    battlefield: player.battlefield.map((card) => {
      if (card.instanceId !== action.instanceId) return card

      const counter: CardCounter = {
        id: action.counterId ?? randomness.identifier(),
        label,
        value: 0,
        ...freeCounterPosition({ requested, taken: card.counters }),
      }
      return { ...card, counters: [...card.counters, counter] }
    }),
  }
}

function freeCounterPosition(options: {
  requested: { x: number; y: number }
  taken: readonly CardCounter[]
}): { x: number; y: number } {
  const { requested, taken } = options
  if (!overlapsCounter({ position: requested, taken })) return requested

  for (let slot = 0; slot < COUNTER_SLOT_COUNT; slot += 1) {
    const position = {
      x: COUNTER_SLOT_POSITION.x,
      y: clamp(COUNTER_SLOT_POSITION.y + slot * COUNTER_SLOT_STEP, COUNTER_RANGE.y),
    }
    if (!overlapsCounter({ position, taken })) return position
  }

  return requested
}

function overlapsCounter(options: {
  position: { x: number; y: number }
  taken: readonly CardCounter[]
}): boolean {
  const { position, taken } = options
  return taken.some(
    (counter) =>
      Math.abs(counter.x - position.x) < COUNTER_FOOTPRINT.width &&
      Math.abs(counter.y - position.y) < COUNTER_FOOTPRINT.height,
  )
}

function moveCounter(options: {
  player: Player
  action: Extract<GameAction, { type: "moveCounter" }>
}): Player {
  const { player, action } = options
  return mapCounters({
    player,
    instanceId: action.instanceId,
    map: (counter) =>
      counter.id === action.counterId
        ? { ...counter, x: clamp(action.x, COUNTER_RANGE.x), y: clamp(action.y, COUNTER_RANGE.y) }
        : counter,
  })
}

function updateCounterValue(options: {
  player: Player
  action: Extract<GameAction, { type: "updateCounterValue" }>
}): Player {
  const { player, action } = options
  return mapCounters({
    player,
    instanceId: action.instanceId,
    map: (counter) => {
      if (counter.id !== action.counterId) return counter

      const value = clamp(counter.value + action.delta, COUNTER_VALUE_RANGE)
      return value === 0 ? null : { ...counter, value }
    },
  })
}

function mapCounters(options: {
  player: Player
  instanceId: string
  map: (counter: CardCounter) => CardCounter | null
}): Player {
  const { player, instanceId, map } = options
  return {
    ...player,
    battlefield: player.battlefield.map((card) => {
      if (card.instanceId !== instanceId) return card

      const counters = card.counters
        .map(map)
        .filter((counter): counter is CardCounter => counter !== null)
      return { ...card, counters }
    }),
  }
}

function removeCard(options: {
  player: Player
  zone: ZoneName
  instanceId: string
}): { card: Card; remainder: Player } | null {
  const { player, zone, instanceId } = options
  const card = player[zone].find((candidate) => candidate.instanceId === instanceId)
  if (!card) return null

  return {
    card,
    remainder: {
      ...player,
      [zone]: withoutCard({ cards: player[zone], instanceId }),
      ...(zone === "battlefield" ? {
        battlefield: player.battlefield
          .filter((candidate) => candidate.instanceId !== instanceId)
          .map((candidate) => {
            if (candidate.attachedTo !== instanceId) return candidate
            const { attachedTo: _attachedTo, ...detached } = candidate
            return detached
          }),
      } : {}),
    },
  }
}

function withoutCard(options: { cards: readonly Card[]; instanceId: string }): Card[] {
  return options.cards.filter((card) => card.instanceId !== options.instanceId)
}

function battlefieldCard(options: { card: Card; x: number; y: number }): BattlefieldCard {
  return { ...deckCard(options.card), x: options.x, y: options.y, counters: [] }
}

function deckCard(card: Card): Card {
  return {
    instanceId: card.instanceId,
    name: card.name,
    scryfallId: card.scryfallId,
    imageUrl: card.imageUrl,
    ...(card.artCropUrl !== undefined ? { artCropUrl: card.artCropUrl } : {}),
    ...(card.typeLine !== undefined ? { typeLine: card.typeLine } : {}),
    ...(card.printedPower !== undefined ? { printedPower: card.printedPower } : {}),
    ...(card.printedToughness !== undefined ? { printedToughness: card.printedToughness } : {}),
    ...(card.isCreature !== undefined ? { isCreature: card.isCreature } : {}),
    ...(card.isUtilityPermanent !== undefined ? { isUtilityPermanent: card.isUtilityPermanent } : {}),
    tapped: card.tapped,
    isManaSource: card.isManaSource,
    ...(card.isAttachment !== undefined ? { isAttachment: card.isAttachment } : {}),
    ...(card.isLand !== undefined ? { isLand: card.isLand } : {}),
  }
}

function clamp(value: number, range: { minimum: number; maximum: number }): number {
  return Math.min(Math.max(value, range.minimum), range.maximum)
}
