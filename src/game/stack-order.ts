import type { Player } from "./types.ts"

/**
 * The room version increments for every committed action and is shared by all
 * players. A newly cast instant/sorcery gets the next version, allowing the UI
 * to order both players' spells globally without leaking hidden cards.
 * Old saved pending spells do not have a stackOrder; they remain supported.
 */
export function stampNewPendingSpells(options: {
  before: Player
  after: Player
  roomVersion: number
}): Player {
  const previous = new Set((options.before.pendingSpells ?? []).map((spell) => spell.instanceId))
  const pending = options.after.pendingSpells ?? []
  if (!pending.some((spell) => !previous.has(spell.instanceId))) return options.after
  return {
    ...options.after,
    pendingSpells: pending.map((spell) => previous.has(spell.instanceId)
      ? spell
      : { ...spell, stackOrder: options.roomVersion + 1 }),
  }
}
