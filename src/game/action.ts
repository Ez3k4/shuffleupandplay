import { DECK_POSITIONS, ZONE_NAMES, type DeckPosition, type ZoneName } from "./types.ts"

export type GameAction =
  | { type: "drawCard"; count?: number }
  | { type: "shuffleLibrary" }
  | { type: "stage10DesignateCommander"; instanceId: string }
  | { type: "stage10PlayCommander" }
  | { type: "stage10ReturnCommander" }
  | { type: "stage10ReselectCommander"; instanceId: string }
  | { type: "beginOpeningHand"; format: "commander" | "standard" }
  | { type: "redrawOpeningHand" }
  | { type: "keepOpeningHand" }
  | { type: "finishOpeningHand"; instanceIds: string[] }
  | { type: "untapAll" }
  | { type: "openDeckSearch" }
  | { type: "closeDeckSearch" }
  | { type: "moveLibraryCardToHand"; instanceId: string }
  | { type: "playFromHand"; instanceId: string }
  | { type: "resolveSpell"; instanceId: string }
  | { type: "toggleTap"; instanceId: string }
  | { type: "createToken"; tokenId: string; sourceInstanceId?: string }
  | { type: "createTokenCopy"; instanceId: string }
  | { type: "adjustCreatureStat"; instanceId: string; stat: "power" | "toughness"; delta: number }
  | { type: "setAttachment"; instanceId: string; targetInstanceId: string | null }
  | { type: "moveBattlefieldCard"; instanceId: string; x: number; y: number }
  | {
      type: "moveCardZone"
      instanceId: string
      from: ZoneName
      to: ZoneName
      x?: number
      y?: number
    }
  | { type: "moveToDeck"; instanceId: string; from: ZoneName; position: DeckPosition }
  | { type: "adjustLife"; delta: number }
  | { type: "resetLife" }
  | { type: "setLife"; value: number }
  | {
      type: "addCounter"
      instanceId: string
      x: number
      y: number
      label?: string
      counterId?: string
    }
  | { type: "moveCounter"; instanceId: string; counterId: string; x: number; y: number }
  | { type: "updateCounterValue"; instanceId: string; counterId: string; delta: number }

export type GameActionType = GameAction["type"]

const NUMERIC_ATTRIBUTE_NAMES = ["count", "delta", "value", "x", "y"]

const TYPE_ALIASES: Record<string, GameActionType> = {
  openLibrarySearch: "openDeckSearch",
  closeLibrarySearch: "closeDeckSearch",
}

type RawAttributes = Record<string, unknown>

type Builder = (attributes: RawAttributes) => GameAction | null

const BUILDERS: Record<GameActionType, Builder> = {
  drawCard: (attributes) => {
    if (attributes.count === undefined) return { type: "drawCard" }
    if (!isFiniteNumber(attributes.count)) return null
    return { type: "drawCard", count: attributes.count }
  },
  shuffleLibrary: () => ({ type: "shuffleLibrary" }),
  stage10DesignateCommander: (attrs) => {
    const instanceId = textIdentifier(attrs.instanceId)
    return instanceId ? { type: "stage10DesignateCommander", instanceId } : null
  },
  stage10PlayCommander: () => ({ type: "stage10PlayCommander" }),
  stage10ReturnCommander: () => ({ type: "stage10ReturnCommander" }),
  stage10ReselectCommander: (attrs) => {
    const instanceId = textIdentifier(attrs.instanceId)
    return instanceId ? { type: "stage10ReselectCommander", instanceId } : null
  },
  beginOpeningHand: (attrs) => attrs.format === "commander" || attrs.format === "standard"
    ? { type: "beginOpeningHand", format: attrs.format } : null,
  redrawOpeningHand: () => ({ type: "redrawOpeningHand" }),
  keepOpeningHand: () => ({ type: "keepOpeningHand" }),
  finishOpeningHand: (attrs) => {
    if (!Array.isArray(attrs.instanceIds) || attrs.instanceIds.length > 7 ||
        !attrs.instanceIds.every((value) => typeof value === "string" && value.length > 0) ||
        new Set(attrs.instanceIds).size !== attrs.instanceIds.length) return null
    return { type: "finishOpeningHand", instanceIds: attrs.instanceIds as string[] }
  },
  untapAll: () => ({ type: "untapAll" }),
  openDeckSearch: () => ({ type: "openDeckSearch" }),
  closeDeckSearch: () => ({ type: "closeDeckSearch" }),
  resetLife: () => ({ type: "resetLife" }),
  moveLibraryCardToHand: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    if (!instanceId) return null
    return { type: "moveLibraryCardToHand", instanceId }
  },
  playFromHand: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    if (!instanceId) return null
    return { type: "playFromHand", instanceId }
  },
  resolveSpell: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    return instanceId ? { type: "resolveSpell", instanceId } : null
  },
  setAttachment: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    const targetInstanceId = attributes.targetInstanceId === null
      ? null : textIdentifier(attributes.targetInstanceId)
    if (!instanceId || (attributes.targetInstanceId !== null && !targetInstanceId)) return null
    return { type: "setAttachment", instanceId, targetInstanceId }
  },
  createToken: (attributes) => {
    const tokenId = textIdentifier(attributes.tokenId)
    const sourceInstanceId = textIdentifier(attributes.sourceInstanceId)
    if (!tokenId || (attributes.sourceInstanceId !== undefined && !sourceInstanceId)) return null
    return { type: "createToken", tokenId, ...(sourceInstanceId ? { sourceInstanceId } : {}) }
  },
  createTokenCopy: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    return instanceId ? { type: "createTokenCopy", instanceId } : null
  },
  adjustCreatureStat: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    const stat = attributes.stat
    const delta = attributes.delta
    if (!instanceId || (stat !== "power" && stat !== "toughness") ||
        (delta !== 1 && delta !== -1)) return null
    return { type: "adjustCreatureStat", instanceId, stat, delta }
  },
  toggleTap: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    if (!instanceId) return null
    return { type: "toggleTap", instanceId }
  },
  moveBattlefieldCard: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    if (!instanceId) return null
    if (!isFiniteNumber(attributes.x) || !isFiniteNumber(attributes.y)) return null
    return { type: "moveBattlefieldCard", instanceId, x: attributes.x, y: attributes.y }
  },
  moveCardZone: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    if (!instanceId) return null

    const from = zoneName(attributes.from)
    const to = zoneName(attributes.to)
    if (!from || !to) return null

    const action: GameAction = { type: "moveCardZone", instanceId, from, to }
    if (attributes.x !== undefined) {
      if (!isFiniteNumber(attributes.x)) return null
      action.x = attributes.x
    }
    if (attributes.y !== undefined) {
      if (!isFiniteNumber(attributes.y)) return null
      action.y = attributes.y
    }
    return action
  },
  moveToDeck: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    const from = zoneName(attributes.from)
    const position = deckPosition(attributes.position)
    if (!instanceId || !from || !position) return null
    return { type: "moveToDeck", instanceId, from, position }
  },
  adjustLife: (attributes) => {
    if (!isFiniteNumber(attributes.delta)) return null
    return { type: "adjustLife", delta: attributes.delta }
  },
  setLife: (attributes) => {
    if (!isFiniteNumber(attributes.value)) return null
    return { type: "setLife", value: attributes.value }
  },
  addCounter: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    if (!instanceId) return null
    if (!isFiniteNumber(attributes.x) || !isFiniteNumber(attributes.y)) return null
    if (attributes.label !== undefined && typeof attributes.label !== "string") return null
    if (attributes.counterId !== undefined && !textIdentifier(attributes.counterId)) return null

    return {
      type: "addCounter",
      instanceId,
      x: attributes.x,
      y: attributes.y,
      ...(typeof attributes.label === "string" ? { label: attributes.label } : {}),
      ...(attributes.counterId === undefined
        ? {}
        : { counterId: String(attributes.counterId) }),
    }
  },
  moveCounter: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    const counterId = textIdentifier(attributes.counterId)
    if (!instanceId || !counterId) return null
    if (!isFiniteNumber(attributes.x) || !isFiniteNumber(attributes.y)) return null
    return { type: "moveCounter", instanceId, counterId, x: attributes.x, y: attributes.y }
  },
  updateCounterValue: (attributes) => {
    const instanceId = textIdentifier(attributes.instanceId)
    const counterId = textIdentifier(attributes.counterId)
    if (!instanceId || !counterId) return null
    if (!isFiniteNumber(attributes.delta)) return null
    return { type: "updateCounterValue", instanceId, counterId, delta: attributes.delta }
  },
}

export function parseAction(rawAction: unknown): GameAction | null {
  if (!isPlainObject(rawAction)) return null

  const type = actionType(rawAction.type)
  if (!type) return null

  return BUILDERS[type](normalizeNumericAttributes(rawAction))
}

function actionType(value: unknown): GameActionType | null {
  if (typeof value !== "string") return null

  const resolved = TYPE_ALIASES[value] ?? value
  return resolved in BUILDERS ? (resolved as GameActionType) : null
}

function normalizeNumericAttributes(attributes: RawAttributes): RawAttributes {
  const normalized: RawAttributes = {}
  for (const [name, value] of Object.entries(attributes)) {
    normalized[name] = normalizeNumericAttribute({ name, value })
  }
  return normalized
}

function normalizeNumericAttribute(options: { name: string; value: unknown }): unknown {
  const { name, value } = options
  if (!NUMERIC_ATTRIBUTE_NAMES.includes(name) || typeof value !== "string") return value

  const parsed = Number(value)
  return value.trim().length > 0 && Number.isFinite(parsed) ? parsed : value
}

function isPlainObject(value: unknown): value is RawAttributes {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function textIdentifier(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null
  return value
}

function zoneName(value: unknown): ZoneName | null {
  return ZONE_NAMES.includes(value as ZoneName) ? (value as ZoneName) : null
}

function deckPosition(value: unknown): DeckPosition | null {
  return DECK_POSITIONS.includes(value as DeckPosition) ? (value as DeckPosition) : null
}
