export const ZONE_NAMES = ["library", "hand", "battlefield", "graveyard", "exile"] as const

export type ZoneName = (typeof ZONE_NAMES)[number]

export const DECK_POSITIONS = ["top", "bottom", "shuffle"] as const

export type DeckPosition = (typeof DECK_POSITIONS)[number]

export const DECK_STATUSES = ["idle", "loading", "loaded", "failed"] as const

export type DeckStatus = (typeof DECK_STATUSES)[number]

export type Card = {
  instanceId: string
  name: string
  scryfallId: string
  imageUrl: string
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
  deckRequestId: string | null
  library: Card[]
  hand: Card[]
  battlefield: BattlefieldCard[]
  graveyard: Card[]
  exile: Card[]
  isSearchingDeck: boolean
  openingHand?: OpeningHandState
  appliedMove: number
  commander?: Card
  commanderInstanceId?: string
}

export type Room = {
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
}

export type PublicBattlefieldCard = PublicCard & {
  attachedTo?: string
  x: number
  y: number
  counters: CardCounter[]
}

export type PublicPlayer = {
  id: string
  name: string
  seat: number
  life: number
  deckName: string | null
  deckStatus: DeckStatus
  library: PublicCard[]
  hand: PublicCard[]
  battlefield: PublicBattlefieldCard[]
  graveyard: PublicCard[]
  exile: PublicCard[]
  isSearchingDeck: boolean
  openingHand?: OpeningHandState
  appliedMove: number
  commander?: PublicCard
  commanderInstanceId?: string
}

export type PublicRoom = {
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
  x: number
  y: number
  counters: CardCounter[]
}

export type SeatFingerprint = PlayerSummary & {
  battlefield: CardFingerprint[]
  /** Commander state must invalidate the owning player's rendered component. */
  commanderInstanceId: string | null
  commanderInZone: boolean
}
