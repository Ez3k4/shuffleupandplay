export const ZONE_NAMES = ["library", "hand", "battlefield", "graveyard", "exile"] as const

export type ZoneName = (typeof ZONE_NAMES)[number]

export const DECK_POSITIONS = ["top", "bottom", "shuffle"] as const

export type DeckPosition = (typeof DECK_POSITIONS)[number]

export const DECK_STATUSES = ["idle", "loading", "loaded", "failed"] as const

export type DeckStatus = (typeof DECK_STATUSES)[number]

import type { DeckTokenCard } from "../archidekt/deck-token-cards.ts"

export type Card = {
  instanceId: string
  name: string
  scryfallId: string
  imageUrl: string
  /** Monotonic room-version order when cast onto the pending-spell stack. */
  stackOrder?: number
  /** Scryfall art_crop shows only the illustration on the compact tabletop. */
  artCropUrl?: string
  /** Printed stats can contain '*' or formulas, not only integers. */
  printedPower?: string
  printedToughness?: string
  typeLine?: string
  isCreature?: boolean
  /** A standalone noncreature, non-Aura, non-Equipment artifact/enchantment. */
  isUtilityPermanent?: boolean
  tapped: boolean
  isManaSource: boolean
  /** Visible face is a land. Optional for saved decks created before Stage 7. */
  isLand?: boolean
  /** Aura or Equipment type, for optional drag-to-attach. */
  isAttachment?: boolean
  /** Generated game piece; removed from the game when it leaves the battlefield. */
  isToken?: boolean
}

export type CardCounter = {
  id: string
  label: string
  value: number
  x: number
  y: number
}

export type BattlefieldCard = Card & {
  attachedTo?: string
  x: number
  y: number
  counters: CardCounter[]
  /** Manual base P/T adjustments, separate from actual +1/+1 counters. */
  powerModifier?: number
  toughnessModifier?: number
}

// Stage 9: opening-hand state is stored with the player.
export type OpeningHandState = {
  phase: "choosing" | "bottoming" | "kept"
  format: "commander" | "standard"
  mulligans: number
  bottomCount: number
}

export type Player = {
  id: string
  sessionId: string
  name: string
  seat: number
  life: number
  deckName: string | null
  deckStatus: DeckStatus
  /** Stage 21: supported token presets suggested by the loaded deck. */
  deckTokenIds?: string[]
  /** Official printed tokens linked to this player’s imported deck. */
  deckTokens?: DeckTokenCard[]
  deckRequestId: string | null
  library: Card[]
  hand: Card[]
  /** IDs shared voluntarily while their cards remain in this player's hand. */
  revealedHandCardIds?: string[]
  battlefield: BattlefieldCard[]
  /** Instants/sorceries that were cast and are awaiting manual resolution. */
  pendingSpells?: Card[]
  graveyard: Card[]
  exile: Card[]
  isSearchingDeck: boolean
  openingHand?: OpeningHandState
  appliedMove: number
  commander?: Card
  commanderInstanceId?: string
}

export type Room = {
  /** Set by the host at creation. Missing on older two-player saves. */
  maxPlayers?: 2 | 3 | 4
  id: string
  code: string
  name: string
  version: number
  idleSweepAt: number | null
  players: Player[]
  createdAt: string
  updatedAt: string
}

export type PublicCard = Card & {
  isHidden?: boolean
  /** Card owner explicitly chose to reveal this hand card to other players. */
  isRevealed?: boolean
}

export type PublicBattlefieldCard = PublicCard & {
  attachedTo?: string
  x: number
  y: number
  counters: CardCounter[]
  powerModifier?: number
  toughnessModifier?: number
}

export type PublicPlayer = {
  id: string
  name: string
  seat: number
  life: number
  deckName: string | null
  deckStatus: DeckStatus
  /** Only projected to the player who loaded the deck. */
  deckTokenIds?: string[]
  /** Official printed tokens linked to this player’s imported deck. */
  deckTokens?: DeckTokenCard[]
  library: PublicCard[]
  hand: PublicCard[]
  battlefield: PublicBattlefieldCard[]
  /** Public, face-up pending spells; this is not a new standard MTG zone. */
  pendingSpells?: PublicCard[]
  graveyard: PublicCard[]
  exile: PublicCard[]
  isSearchingDeck: boolean
  openingHand?: OpeningHandState
  appliedMove: number
  commander?: PublicCard
  commanderInstanceId?: string
}

export type PublicRoom = {
  maxPlayers?: 2 | 3 | 4
  id: string
  code: string
  name: string
  version: number
  players: PublicPlayer[]
  createdAt: string
  updatedAt: string
}

export type RoomPayload = {
  space: PublicRoom | null
  currentPlayerId: string | null
}

export type PlayerSummary = {
  seat: number
  name: string
  deckName: string | null
  deckStatus: DeckStatus
  life: number
  libraryCount: number
  handCount: number
  battlefieldCount: number
  graveyardCount: number
  exileCount: number
  isSearchingDeck: boolean
  openingHand?: OpeningHandState
}

export type CardFingerprint = {
  attachedTo?: string | null
  instanceId: string
  tapped: boolean
  isToken?: boolean
  x: number
  y: number
  counters: CardCounter[]
  powerModifier?: number
  toughnessModifier?: number
}

export type SeatFingerprint = PlayerSummary & {
  battlefield: CardFingerprint[]
  /** Commander state must invalidate the owning player's rendered component. */
  commanderInstanceId: string | null
  commanderInZone: boolean
  /** Observe spell arrivals/resolutions, even if permanent counts do not change. */
  pendingSpellIds: string[]
  /** Reveals must invalidate both the owner and the opponent component. */
  revealedHandCardIds: string[]
}
