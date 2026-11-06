import { attribute, escapeHtml, jsonAttribute } from "./escape.ts"
import type { GameAction } from "../../game/action.ts"
import type {
  PublicBattlefieldCard,
  PublicCard,
  PublicPlayer,
  PublicRoom,
  RoomPayload,
} from "../../game/types.ts"

export const COMPONENT_NAMES = [
  "player",
  "playerControls",
  "librarySearch",
  "gameResult",
  "tableStatus",
  "opponentRoster",
] as const

export type ComponentName = (typeof COMPONENT_NAMES)[number]

export type ComponentRenderContext = {
  payload: RoomPayload
  roomCode: string
  seat: number
  shareUrl: string
}

export function isComponentName(value: unknown): value is ComponentName {
  return COMPONENT_NAMES.includes(value as ComponentName)
}

export function renderComponent(options: {
  name: ComponentName
  key: string | undefined
  context: ComponentRenderContext
}): string {
  const { name, key, context } = options
  switch (name) {
    case "player":
      return renderPlayer({ context, seat: Number(key ?? context.seat) })
    case "playerControls":
      return renderPlayerControls(context)
    case "librarySearch":
      return renderLibrarySearch(context)
    case "gameResult":
      return renderGameResult(context)
    case "tableStatus":
      return renderTableStatus(context)
    case "opponentRoster":
      return renderOpponentRoster(context)
  }
}

/** Stage 16: names and life totals of ALL opponents; only the selected board is shown. */
function renderOpponentRoster(context: ComponentRenderContext): string {
  const room = context.payload.space
  const opponents = (room?.players ?? []).filter((player) => player.seat !== context.seat)
  return `<nav class="stage16-opponent-roster" aria-label="Choose opponent battlefield">
    ${opponents.map((player) => `<button type="button" class="stage16-opponent-choice"
      data-stage16-select-seat="${player.seat}" aria-pressed="false"
      aria-label="View ${attribute(player.name)}'s battlefield, ${player.life} life">
      <span class="stage16-opponent-name">${escapeHtml(player.name)}</span>
      <span class="stage16-opponent-life" title="Life total">${player.life} ♥</span>
    </button>`).join("")}
  </nav>`
}

function renderTableStatus(context: ComponentRenderContext): string {
  const room = context.payload.space
  const maxPlayers = room?.maxPlayers ?? 2
  if ((room?.players.length ?? 0) >= maxPlayers) return ""

  return `<section class="panel waiting-panel">
    <h2>Waiting for players</h2>
    <p>Send the invite link to the other players.</p>
    <div class="waiting-actions">
      <button type="button" class="primary-action" data-copy-text="${attribute(context.shareUrl)}">Copy invite link</button>
      <button type="button" class="secondary-action" data-share-url="${attribute(context.shareUrl)}" data-share-hidden hidden>Share…</button>
    </div>
    <p class="waiting-code">Table code <strong>${escapeHtml(context.roomCode)}</strong></p>
    <p class="waiting-count">${room?.players.length ?? 1} of ${maxPlayers} players connected</p>
  </section>`
}

export function componentTargetId(options: { name: ComponentName; key?: string | number }): string {
  return options.key === undefined
    ? `component-${options.name}`
    : `component-${options.name}-${options.key}`
}

function playerAt(options: { room: PublicRoom | null; seat: number }): PublicPlayer | undefined {
  return options.room?.players.find((player) => player.seat === options.seat)
}



const MULLIGAN_DISABLED = true

// Stage 9: this panel uses only the viewer's own hand; no private card data
// is emitted into the opponent's DOM. It disappears after the hand is kept.
function renderStage9Opening(player: PublicPlayer, isCurrentPlayer: boolean): string {
  // Temporarily disable the mulligan UI for all players.
  // Retain the implementation below so it can be re-enabled later.
  if (MULLIGAN_DISABLED) return ""
  const state = player.openingHand
  if (!isCurrentPlayer) {
    if (!state || state.phase === "kept") return ""
    return `<div class="stage9-opponent-status">${escapeHtml(player.name)} is choosing an opening hand…</div>`
  }
  if (player.deckStatus !== "loaded" || state?.phase === "kept") return ""
  if (!state) {
    const eligible = player.battlefield.length === 0 && player.graveyard.length === 0 &&
      player.exile.length === 0 && (player.hand.length === 0 || player.hand.length === 7) &&
      (player.hand.length === 7 || player.library.length >= 7)
    if (!eligible) return ""
    return `<section class="stage9-opening-panel" data-stage9-panel>
      <strong>Opening hand</strong>
      <label>Mulligan rules
        <select data-stage9-format>
          <option value="commander">Commander / casual — first mulligan free</option>
          <option value="standard">Standard — no free mulligan</option>
        </select>
      </label>
      <button type="button" data-stage9-start>${player.hand.length === 7 ? "Review existing seven" : "Shuffle &amp; draw seven"}</button>
    </section>`
  }
  if (state.phase === "choosing") {
    const nextBottom = Math.max(0, state.mulligans + 1 - (state.format === "commander" ? 1 : 0))
    return `<section class="stage9-opening-panel" data-stage9-panel>
      <strong>Opening hand · Mulligans ${state.mulligans}</strong>
      <span>${state.bottomCount === 0 ? "Keep all seven" : `Keep and bottom ${state.bottomCount} card${state.bottomCount === 1 ? "" : "s"}`}</span>
      <div class="stage9-buttons">
        <button type="button" data-stage9-keep>Keep hand</button>
        ${nextBottom <= 7 ? `<button type="button" data-stage9-redraw>Redraw seven</button>` : ""}
      </div>
    </section>`
  }
  if (state.phase !== "bottoming") return ""
  const choices = player.hand.map((card) =>
    `<button type="button" class="stage9-card-choice" data-stage9-card-id="${attribute(card.instanceId)}" ${previewAttributes(card)} aria-pressed="false">${cardFace(card)}</button>`
  ).join("")
  return `<section class="stage9-opening-panel stage9-bottoming" data-stage9-panel data-stage9-required="${state.bottomCount}">
    <strong>Put ${state.bottomCount} on the bottom</strong>
    <p>Select cards in the order they should be placed on the bottom of your library.</p>
    <div class="stage9-bottom-cards">${choices}</div>
    <div class="stage9-buttons">
      <span data-stage9-counter>Selected 0 / ${state.bottomCount}</span>
      <button type="button" data-stage9-finish disabled>Finish opening hand</button>
    </div>
  </section>`
}

// Stage 10A: command-zone state is public, but hidden library/hand contents
// are offered only to the owner. Commander selection is manual for now.
function renderStage10Commander(player: PublicPlayer, isCurrentPlayer: boolean): string {
  const current = player.commander
  const identified = player.commanderInstanceId
  let body = ""
  if (current) {
    body = `<div class="stage10-card" ${previewAttributes(current)}>${cardFace(current)}</div>` +
      (isCurrentPlayer ? `<button type="button" data-stage10-play>Play commander</button>` : "")
    if (isCurrentPlayer && player.deckStatus === "loaded") {
      const alternatives = (["library", "hand", "battlefield", "graveyard", "exile"] as const)
        .flatMap((zone) => player[zone].map((card) => ({ zone, card })))
        .filter(({ card }) => card.instanceId !== current.instanceId)
        .sort((a, b) => a.card.name.localeCompare(b.card.name))
        .map(({ zone, card }) =>
          `<option value="${attribute(card.instanceId)}">${escapeHtml(card.name)} (${zone})</option>`)
        .join("")
      if (alternatives) {
        body += `<details class="stage10-choose stage10-reselect">
          <summary>Change commander</summary>
          <select data-stage10-reselection aria-label="Choose replacement commander">${alternatives}</select>
          <button type="button" data-stage10-reselect>Confirm change</button>
        </details>`
      }
    }
  } else if (identified) {
    body = `<span class="stage10-away">Commander elsewhere</span>` +
      (isCurrentPlayer ? `<button type="button" data-stage10-return>Return to command zone</button>` : "")
  } else if (isCurrentPlayer && player.deckStatus === "loaded") {
    const options = (["library", "hand", "battlefield", "graveyard", "exile"] as const)
      .flatMap((zone) => player[zone].map((card) => ({ zone, card })))
      .sort((a, b) => a.card.name.localeCompare(b.card.name))
      .map(({ zone, card }) =>
        `<option value="${attribute(card.instanceId)}">${escapeHtml(card.name)} (${zone})</option>`)
      .join("")
    body = options ? `<details class="stage10-choose">
      <summary>Choose commander</summary>
      <select data-stage10-selection aria-label="Select your Commander">${options}</select>
      <button type="button" data-stage10-designate>Set commander</button>
    </details>` : `<span class="stage10-away">Load a deck first</span>`
  } else {
    body = `<span class="stage10-away">No commander</span>`
  }
  return `<aside class="stage10-command-zone" data-stage10-zone="true" data-stage10-owner="${isCurrentPlayer}">
    <strong>Command zone</strong>${body}
  </aside>`
}

function renderPlayer(options: {
  context: ComponentRenderContext
  seat: number
}): string {
  const { context, seat } = options
  const player = playerAt({
    room: context.payload.space,
    seat,
  })

  if (!player) return ""

  const isCurrentPlayer =
    player.id === context.payload.currentPlayerId

  const classes = [
    "player-section",
    isCurrentPlayer ? "your-seat" : "opponent-seat",
  ].join(" ")

  const playerDetails = `
    ${renderZoneSummary(player, isCurrentPlayer)}

    <div class="player-zones">
      <div class="hand-zone">
        <span class="hand-zone-label">
          Hand (${player.hand.length})
        </span>
        ${
          isCurrentPlayer
            ? renderHand(player)
            : `<p class="opponent-hand-hidden">
                 Opponent's hand is hidden
               </p>`
        }
      </div>

      ${renderZoneLanes({ player, isCurrentPlayer })}
    </div>
  `

  return `
    <section
      class="${classes}"
      data-player-id="${attribute(player.id)}"
      data-current-player="${isCurrentPlayer}"
    >
      ${isCurrentPlayer ? "" : playerDetails}

      ${renderBattlefield({ player, isCurrentPlayer })}
      ${renderStage12UtilityLane(player, isCurrentPlayer)}
      ${renderStage12PlaneswalkerLane(player, isCurrentPlayer)}
      ${renderStage10Commander(player, isCurrentPlayer)}
      ${renderStage9Opening(player, isCurrentPlayer)}

      ${isCurrentPlayer ? playerDetails : ""}
    </section>
  `
}



function renderPlayerHeader(options: { player: PublicPlayer; isCurrentPlayer: boolean }): string {
  const { player, isCurrentPlayer } = options
  const searching =
    !isCurrentPlayer && player.isSearchingDeck
      ? `<span class="searching-indicator">Looking through library…</span>`
      : ""

  return `<header class="player-header">
  <div class="player-header-name"><strong>${escapeHtml(player.name)}</strong>${searching}</div>
  <div class="life-controls">
    ${isCurrentPlayer
      ? actionButton({
          action: { type: "adjustLife", delta: 1 },
          label: String(player.life),
          className: "stage09-life-button",
          accessibleName: `Life ${player.life}. Left click to gain 1 life; right click to lose 1 life.`,
        })
      : `<span class="life-value">${player.life}</span>`}
  </div>
</header>`
}


function renderZoneSummary(
  player: PublicPlayer,
  isCurrentPlayer: boolean
): string {
  const zones = ["library", "hand", "graveyard", "exile"] as const

  const counts = zones
    .map((zone) => {
      const label = zone[0]?.toUpperCase() + zone.slice(1)

      return `<span
        data-zone-count="${zone}"
        data-zone-label="${label}"
        data-count="${player[zone].length}"
      >${label} ${player[zone].length}</span>`
    })
    .join("")


const playerName = `
  <div class="player-header-name">
    <strong>${escapeHtml(player.name)}</strong>
  </div>
`

// Stage 09: a single value button replaces +/-/Reset. The standard click
// action adds 1 life; shuffle.js intercepts contextmenu to subtract 1.
const lifeControls = `
  <div class="life-controls">
    ${isCurrentPlayer
      ? actionButton({
          action: { type: "adjustLife", delta: 1 },
          label: String(player.life),
          className: "stage09-life-button",
          accessibleName: `Life ${player.life}. Left click to gain 1 life; right click to lose 1 life.`,
        })
      : `<span class="life-value">${player.life}</span>`}
  </div>
`

    
  const actions = isCurrentPlayer
    ? `<div class="zone-summary-actions">
        ${player.deckName ? actionButton({ action: { type: "untapAll" }, label: "Untap all" }) : ""}
        <button type="button" class="stage18-create-token" data-stage17-open-tokens="true" aria-label="Create a token">Create token</button>
      </div>`
    : ""

  return `
    <div class="zone-summary">

      <div class="zone-summary-player">
        ${playerName}
      </div>

      <div class="zone-summary-life">
        ${lifeControls}
      </div>

      <div class="zone-summary-info">
        ${counts}
      </div>

      ${actions}

    </div>
  `

}


// Stage 08 hand presentation: rotations are precomputed so that the HTML
// remains a normal set of playable buttons. Only visual CSS variables change.
function renderHand(player: PublicPlayer): string {
  const hand = [...player.hand].reverse()
  const midpoint = (hand.length - 1) / 2
  const step = Math.min(4.2, 24 / Math.max(hand.length - 1, 1))
  const cards = hand.map((card, index) => {
    const fromCenter = index - midpoint
    const angle = fromCenter * step
    const drop = Math.min(12, Math.abs(fromCenter) * 3)
    const style = `--stage08-hand-angle:${angle.toFixed(2)}deg;--stage08-hand-drop:${drop.toFixed(1)}px;--stage08-hand-order:${index + 1}`
    return `<button type="button" class="hand-card" data-hand-play-instance-id="${attribute(card.instanceId)}" ${previewAttributes(card)} style="${attribute(style)}" aria-label="Drag ${attribute(card.name)} to play; right-click for more actions">${cardFace(card)}</button>`
  }).join("")

  return `<div class="hand-strip" data-hand-count="${hand.length}">${cards}</div>`
}

function renderBattlefield(options: {
  player: PublicPlayer
  isCurrentPlayer: boolean
}): string {
  const cards = options.player.battlefield
    .filter((card) => !isLandCard(card) && !isFixedUtilityCard(card, options.player.battlefield) &&
      !isStage12PlaneswalkerCard(card, options.player.battlefield))
    .map((card) => renderBattlefieldCard({
      card,
      isCurrentPlayer: options.isCurrentPlayer,
      hasAttachments: options.player.battlefield.some((candidate) => candidate.attachedTo === card.instanceId),
      attachmentIndex: card.attachedTo
        ? options.player.battlefield
            .filter((candidate) => candidate.attachedTo === card.attachedTo)
            .findIndex((candidate) => candidate.instanceId === card.instanceId)
        : 0,
    }))
    .join("")
  const fixedLanes = renderFixedLanes(options)
  const pendingSpells = renderPendingSpells(options.player, options.isCurrentPlayer)

  // Stage 12: the browser clones pendingSpells into one shared display at
  // the middle divider; this original stays in the player component so
  // server invalidations and owner-only Resolve permissions remain intact.
  return `<div class="battlefield"><div class="battlefield-canvas" data-battlefield-player-id="${attribute(options.player.id)}">${cards}${fixedLanes}${pendingSpells}</div></div>`
}

// ===== Stage 11: face-up spells awaiting manual resolution =====
// The list belongs to the player (and persists in SQLite), but is shown to
// both seats. Only the controlling seat receives the Resolve action button.
function renderPendingSpells(player: PublicPlayer, isCurrentPlayer: boolean): string {
  const pending = player.pendingSpells ?? []
  if (pending.length === 0) return ""
  const entries = pending.map((spell) => {
    const resolve = isCurrentPlayer
      ? actionButton({ action: { type: "resolveSpell", instanceId: spell.instanceId }, label: "Resolve", className: "stage11-resolve-button", accessibleName: `Resolve ${spell.name} and move it to your graveyard` })
      : `<span class="stage11-awaiting">Waiting for player</span>`
    return `<div class="stage11-spell-card" data-instance-id="${attribute(spell.instanceId)}" ${previewAttributes(spell)}>
      <img src="${attribute(spell.imageUrl)}" loading="lazy" alt="${attribute(spell.name)}" />
      <span class="stage11-spell-name">${escapeHtml(spell.name)}</span>
      ${resolve}
    </div>`
  }).join("")
  return `<aside class="stage11-spell-area" aria-label="Spells awaiting resolution">
    <div class="stage11-spell-heading">On the stack</div>
    <div class="stage11-spell-cards">${entries}</div>
  </aside>`
}

// Text symbols intentionally avoid asset files and remain legible on small
// land/utility cards. Tooltip and accessible name retain the full counter name.
function stage19CounterSymbol(label: string): string {
  const symbols: Record<string, string> = {
    "+1/+1": "✚", "-1/-1": "−", "Flying": "↟", "Deathtouch": "☠",
    "Lifelink": "♥", "Vigilance": "◉", "Trample": "⤳", "Haste": "⚡",
    "Reach": "↥", "Menace": "⚔", "Hexproof": "⬡", "First strike": "➤",
    "Double strike": "»", "Indestructible": "◆", "Shield": "⬟",
    "Stun": "⌛", "Charge": "ϟ", "Loyalty": "♛",
  }
  return symbols[label] ?? "●"
}

function renderBattlefieldCard(options: {
  card: PublicBattlefieldCard
  isCurrentPlayer: boolean
  landStackIndex?: number
  utilityStack?: boolean
  hasAttachments?: boolean
  attachmentIndex?: number
}): string {
  const { card, isCurrentPlayer } = options
  const tools = isCurrentPlayer ? renderCardTools(card) + renderStage8AttachmentTool(card) : ""
  // Stage 19: counters are an anchored, compact tray rather than draggable
  // floating labels. The server still owns every counter ID and value.
  const counters = card.counters.length
    ? `<div class="stage19-counter-rack" role="group" aria-label="Counters on ${attribute(card.name)}">${card.counters.map((counter) => {
        const icon = stage19CounterSymbol(counter.label)
        const description = `${counter.label} counter: ${counter.value}`
        const contents = `<span class="stage19-counter-symbol" aria-hidden="true">${escapeHtml(icon)}</span><span class="counter-value">${counter.value}</span>`
        if (!isCurrentPlayer) return `<span class="counter-chip stage19-counter-static" data-counter-id="${attribute(counter.id)}" title="${attribute(description)}" aria-label="${attribute(description)}">${contents}</span>`
        return `<button type="button" class="counter-chip stage19-counter-adjust" data-stage19-counter-adjust="true" data-counter-id="${attribute(counter.id)}" data-instance-id="${attribute(card.instanceId)}" data-game-action="${jsonAttribute({ type: "updateCounterValue", instanceId: card.instanceId, counterId: counter.id, delta: 1 })}" title="${attribute(description)} — left click +1, right click −1" aria-label="${attribute(description)}; left click increases, right click decreases">${contents}</button>`
      }).join("")}</div>`
    : ""

  const isLandStackCard = options.landStackIndex !== undefined
  const position = isLandStackCard
    ? `--stage7-stack-index:${options.landStackIndex}`
    : `left:calc(var(--tabletop-travel-x) * ${card.x / 1200});top:calc(var(--tabletop-travel-y) * ${(options.isCurrentPlayer ? card.y : 700 - card.y) / 700})`
  const landClass = isLandStackCard ? " stage7-land-card" : ""
  const utilityClass = options.utilityStack ? " compact-utility-card" : ""
  // Stage 24B: show the complete printed card (including loyalty abilities)
  // for Planeswalkers rather than the cropped battlefield artwork.
  // All other permanent types keep their current compact/land rendering.
  const isPlaneswalker = /\bPlaneswalker\b/i.test(card.typeLine ?? "")
  const compact = !isLandCard(card) && !isPlaneswalker
  const creature = card.isCreature === true || /\bCreature\b/i.test(card.typeLine ?? "")
  const statBadge = compact && creature
    ? renderStage17Stats(card, isCurrentPlayer)
    : ""
  const image = compact ? compactCardArtUrl(card) : card.imageUrl
  // The title is allowed to wrap instead of being ellipsized; extremely long
  // names get a slightly smaller font so they fit on an art-crop card.
  const titleScale = card.name.length > 44 ? 0.069 : card.name.length > 28 ? 0.079 : 0.095
  const face = compact
    ? `<img class="compact-art-image" loading="lazy" src="${attribute(image)}" data-art-fallback="${attribute(card.imageUrl)}" alt="${attribute(card.name)}" />
      <span class="compact-card-name" style="--compact-title-scale:${titleScale}">${escapeHtml(card.name)}</span>${statBadge}`
    : `<img loading="lazy" src="${attribute(card.imageUrl)}" alt="${attribute(card.name)}" />`
  return `<div class="battlefield-card${card.tapped ? " tapped" : ""}${landClass}${utilityClass}${compact ? " compact-art-card" : ""}${isPlaneswalker ? " stage24b-full-planeswalker" : ""}${statBadge ? " compact-has-pt" : ""}${card.isToken ? " stage17-token" : ""}${card.attachedTo ? " stage8-attached" : ""}${options.hasAttachments ? " stage8-attachment-host" : ""}" data-instance-id="${attribute(card.instanceId)}" title="${attribute(card.name)}" data-stage8b-attachable="${(card.isAttachment === true || /\b(?:Aura|Equipment)\b/i.test(card.typeLine ?? "")) ? "true" : "false"}" ${previewAttributes(card)} style="${position};--stage8c-attach-x:${Math.min(options.attachmentIndex ?? 0, 8) * 22}px;--stage8c-attach-y:42px">
  ${face}
  <div class="card-tools">${tools}</div>${counters}
</div>`
}

// Calculate the artwork URL for older saved decks that predate artCropUrl.
// Keep their original full-card URL as the hover preview and image fallback.
function stage17StatValue(printed: string | undefined, modifier: number): string {
  const number = Number(printed)
  if (printed !== undefined && printed.trim() !== "" && Number.isFinite(number)) return String(number + modifier)
  if (modifier === 0) return printed ?? "?"
  return `${printed ?? "?"}${modifier > 0 ? "+" : ""}${modifier}`
}

function renderStage17Stats(card: PublicBattlefieldCard, editable: boolean): string {
  const power = stage17StatValue(card.printedPower, card.powerModifier ?? 0)
  const toughness = stage17StatValue(card.printedToughness, card.toughnessModifier ?? 0)
  if (!editable) return `<span class="compact-card-pt" aria-label="Power ${attribute(power)}, toughness ${attribute(toughness)}">${escapeHtml(power)}/${escapeHtml(toughness)}</span>`
  const statControl = (stat: "power" | "toughness", value: string): string =>
    `<button type="button" class="stage17-stat-adjust" data-stage17-stat="${stat}" data-game-action="${jsonAttribute({ type: "adjustCreatureStat", instanceId: card.instanceId, stat, delta: 1 })}" title="${stat}: left +1, right −1" aria-label="${stat} ${attribute(value)}: left click increases, right click decreases">${escapeHtml(value)}</button>`
  return `<span class="compact-card-pt stage17-stats">${statControl("power", power)}<span aria-hidden="true">/</span>${statControl("toughness", toughness)}</span>`
}

function compactCardArtUrl(card: PublicBattlefieldCard): string {
  if (card.artCropUrl) return card.artCropUrl
  const id = card.scryfallId
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    return `https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg`
  }
  return card.imageUrl
}

// Land is a subtype-independent card type, NOT the same as "produces mana".
// A non-land mana rock must remain on the ordinary battlefield.
function isLandCard(card: PublicBattlefieldCard): boolean {
  // Always recognize basic lands, including decks imported with isLand: false.
  if (/^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest|Wastes)$/i.test(card.name.trim())) return true
  // Avoid treating mana-producing nonlands (such as Sol Ring) as lands.
  return card.isLand === true
}

// ===== Renderer: utility lane vs. draggable battlefield =====
// This is PRESENTATION only: every card remains in player.battlefield.
// Cards hosting or carrying attachments stay on the main canvas to preserve
// attachment offsets and dragging. Missing/ambiguous type data stays on the
// main canvas unless an existing saved isUtilityPermanent flag says otherwise.
// Note: old saved cards without subtype metadata may require a fresh deck load.
function isFixedUtilityCard(
  card: PublicBattlefieldCard,
  battlefield: readonly PublicBattlefieldCard[],
): boolean {
  if (isLandCard(card) || card.attachedTo) return false
  if (battlefield.some((candidate) => candidate.attachedTo === card.instanceId)) return false
  const type = card.typeLine ?? ""
  // Always exclude creatures, Equipment and Auras, even if an older imported
  // card mistakenly persisted isUtilityPermanent=true in the database.
  if (card.isAttachment === true || /\b(?:Land|Creature|Aura|Equipment|Planeswalker)\b/i.test(type)) return false
  if (card.isUtilityPermanent === false) return false
  if (card.isUtilityPermanent === true) return true
  return /\b(?:Artifact|Enchantment)\b/i.test(type)
}

// Both fixed lanes reuse the existing Stage 7 stack DOM, so tapping and the
// individual-copy right-click menu continue to work without new game actions.
// Only identical names are grouped; each copy keeps a distinct instanceId.
function renderFixedLanes(options: {
  player: PublicPlayer
  isCurrentPlayer: boolean
}): string {
  const battlefield = options.player.battlefield
  const lands = battlefield.filter(isLandCard)
  if (lands.length === 0) return ""
  return `<div class="compact-special-lanes" aria-label="Land area">
    ${renderFixedLane(lands, "Lands", "stage7-land-zone", options.isCurrentPlayer)}
  </div>`
}

// ===== Stage 12: fixed lanes without creating new MTG zones =====
// Utilities sit directly LEFT of the library, not next to lands. Both remain
// in player.battlefield and retain their action/stack behavior.
function renderStage12UtilityLane(player: PublicPlayer, isCurrentPlayer: boolean): string {
  const utilityCards = player.battlefield.filter((card) => isFixedUtilityCard(card, player.battlefield))
  if (utilityCards.length === 0) return ""
  return `<div class="stage12-utility-area" aria-label="Artifacts and enchantments">
    ${renderFixedLane(utilityCards, "Artifacts / Enchantments", "compact-utility-zone", isCurrentPlayer, true)}
  </div>`
}

// Planeswalkers are still ordinary battlefield cards. We recognize their
// typeLine even on non-standard multi-type cards; attached walkers remain on
// the main battlefield so attachment positioning is preserved.
function isStage12PlaneswalkerCard(card: PublicBattlefieldCard, battlefield: readonly PublicBattlefieldCard[]): boolean {
  return !isLandCard(card) && /\bPlaneswalker\b/i.test(card.typeLine ?? "") &&
    !card.attachedTo && !battlefield.some((other) => other.attachedTo === card.instanceId)
}

function renderStage12PlaneswalkerLane(player: PublicPlayer, isCurrentPlayer: boolean): string {
  const walkers = player.battlefield.filter((card) => isStage12PlaneswalkerCard(card, player.battlefield))
  if (walkers.length === 0) return ""
  return `<div class="stage12-planeswalker-area" aria-label="Planeswalker area">
    <span class="stage12-planeswalker-label">Planeswalkers</span>
    ${renderFixedLane(walkers, "Planeswalkers", "stage12-planeswalker-zone", isCurrentPlayer, true)}
  </div>`
}

function renderFixedLane(
  cards: readonly PublicBattlefieldCard[],
  title: string,
  extraClass: string,
  isCurrentPlayer: boolean,
  utility = false,
): string {
  const groups = new Map<string, PublicBattlefieldCard[]>()
  for (const card of cards) {
    const key = card.name.trim().toLocaleLowerCase("en")
    const group = groups.get(key) ?? []
    group.push(card)
    groups.set(key, group)
  }

  const stacks = [...groups.values()].map((copies) => {
    const sorted = [...copies].sort((a, b) => Number(b.tapped) - Number(a.tapped))
    const faces = sorted.map((card, index) => renderBattlefieldCard({
      card,
      isCurrentPlayer,
      landStackIndex: Math.min(index, 3),
      utilityStack: utility,
    })).join("")
    const tappedCount = copies.filter((card) => card.tapped).length
    return `<div class="stage7-land-stack" title="${attribute(copies[0]?.name ?? "Permanent")}" aria-label="${attribute(copies[0]?.name ?? "Permanent")}, ${copies.length} copies, ${tappedCount} tapped">
      ${faces}
      <span class="stage7-land-count">${tappedCount ? `${tappedCount}/` : ""}${copies.length}</span>
    </div>`
  }).join("")

  // The aria-label keeps the lane identifiable to assistive technology;
  // the visible heading is omitted to give the cards more vertical space.
  return `<div class="stage7-land-zone ${extraClass}" aria-label="${attribute(title)}">
    <div class="stage7-land-row">${stacks}</div>
  </div>`
}

function renderStage8AttachmentTool(card: PublicBattlefieldCard): string {
  const name = attribute(card.name)
  return card.attachedTo
    ? `<button type="button" class="card-tool stage8-tool" data-stage8-detach="true" title="Detach ${name}">Unlink</button>`
    : `<button type="button" class="card-tool stage8-tool" data-stage8-attach-start="true" title="Attach ${name} to another card">Attach</button>`
}

// Common manual counter presets. These are descriptive counters, not a rules
// engine: adding a Flying counter does not automatically change combat rules.
const STAGE18_COUNTER_LABELS = [
  "+1/+1", "-1/-1", "Flying", "Deathtouch", "Lifelink", "Vigilance",
  "Trample", "Haste", "Reach", "Menace", "Hexproof", "First strike",
  "Double strike", "Indestructible", "Shield", "Stun", "Charge", "Loyalty",
] as const

function renderStage18CounterMenu(instanceId: string): string {
  const buttons = STAGE18_COUNTER_LABELS.map((label) => actionButton({
    action: { type: "addCounter", instanceId, x: 8, y: 8, label },
    label,
    className: "stage18-counter-choice",
    accessibleName: `Add ${label} counter`,
  })).join("")
  return `<details class="stage18-counter-menu"><summary>⊕ Add counter</summary><div class="stage18-counter-options">${buttons}</div></details>`
}

function renderCardTools(card: PublicBattlefieldCard): string {
  const instanceId = card.instanceId
  const name = card.name
  return [
    // Always show these four move shortcuts above the other menu items.
    actionButton({
      action: { type: "moveCardZone", instanceId, from: "battlefield", to: "hand" },
      label: "✋", className: "card-tool stage18-zone-hand",
      accessibleName: `Move ${name} to hand`,
    }),
    actionButton({
      action: { type: "moveToDeck", instanceId, from: "battlefield", position: "shuffle" },
      label: "▤", className: "card-tool stage18-zone-library",
      accessibleName: `Shuffle ${name} into library`,
    }),
    actionButton({
      action: { type: "moveCardZone", instanceId, from: "battlefield", to: "graveyard" },
      label: "☠", className: "card-tool stage18-zone-graveyard",
      accessibleName: `Move ${name} to graveyard`,
    }),
    actionButton({
      action: { type: "moveCardZone", instanceId, from: "battlefield", to: "exile" },
      label: "✧", className: "card-tool stage18-zone-exile",
      accessibleName: `Move ${name} to exile`,
    }),
    actionButton({
      action: { type: "createTokenCopy", instanceId },
      label: "⧉", className: "card-tool stage17-token-copy",
      accessibleName: `Create token copy of ${name}`,
    }),
    renderStage18CounterMenu(instanceId),
  ].join("")
}

function renderZoneLanes(options: { player: PublicPlayer; isCurrentPlayer: boolean }): string {
  const lanes = (["graveyard", "exile"] as const)
    .map((zone) => {
      const label = zone[0]?.toUpperCase() + zone.slice(1)
      const cards = [...options.player[zone]]
        .reverse()
        .map((card, index) => {
          const topBadge =
            zone === "graveyard" && index === 0 ? `<em class="zone-top-badge">TOP</em>` : ""
          const className = `zone-card-chip${zone === "graveyard" && index === 0 ? " top-zone-card" : ""}`
          if (!options.isCurrentPlayer) {
            return `<div class="${className} read-only" ${previewAttributes(card)}>${cardFace(card)}${topBadge}</div>`
          }
          return actionButton({
            action: {
              type: "moveCardZone",
              instanceId: card.instanceId,
              from: zone,
              to: "battlefield",
              x: 48,
              y: 48,
            },
            label: `${cardFace(card)}${topBadge}`,
            className,
            preview: card,
          })
        })
        .join("")


    const zoneCards = options.player[zone]
    const topCard = zoneCards[zoneCards.length - 1]

    const preview = topCard?.imageUrl
      ? `<img
          src="${attribute(topCard.imageUrl)}"
          alt="${attribute(topCard.name)}"
        />`
      : `<span class="zone-preview-empty">
          ${topCard ? escapeHtml(topCard.name) : "Empty"}
        </span>`

    // Stage 12: Exile is a small inspector button rather than a card-sized
    // pile. Its complete searchable zone-source remains in the DOM.
    if (zone === "exile") {
      return `<div class="zone-lane stage12-exile-lane" data-zone="exile">
        <button type="button" class="zone-preview stage12-exile-button" data-open-zone="exile"
          aria-label="Open exile: ${zoneCards.length} cards" title="Exile (${zoneCards.length})">
          <span class="stage12-exile-icon" aria-hidden="true">✧</span>
          <span class="stage12-exile-count">Exile ${zoneCards.length}</span>
        </button>
        <div class="zone-source" hidden>${cards}</div>
      </div>`
    }

    return `
      <div class="zone-lane" data-zone="${zone}">
        <button
          type="button"
          class="zone-preview"
          data-open-zone="${zone}"
        >
          ${preview}
          <span class="zone-preview-caption">
            ${label} (${zoneCards.length})
          </span>
        </button>

        <div class="zone-source" hidden>
          ${cards}
        </div>
      </div>
    `
    })
    .join("")


  const libraryCount = options.player.library.length

  // The first array element is the top of the library.
  // Only the owning player gets card identities.
  const peekCards = options.isCurrentPlayer
    ? options.player.library
        .map((card, index) => `
            <div
              class="library-peek-card"
              data-library-position="${index + 1}"
              data-instance-id="${attribute(card.instanceId)}"
              ${previewAttributes(card)}
            >
            ${cardFace(card)}
          </div>
        `)
        .join("")
    : ""

  const libraryFace = `
    <span class="library-back-art"></span>
    <span class="zone-preview-caption">
      Library (${libraryCount})
    </span>
  `

  const libraryPreview = `
    <div class="zone-lane library-lane" data-zone="library">
      ${
        options.isCurrentPlayer
          ? actionButton({
              action: { type: "openDeckSearch" },
              label: libraryFace,
              className: "zone-preview library-zone-preview"
            })
          : `<div class="zone-preview library-zone-preview">
               ${libraryFace}
             </div>`
      }

      ${
        options.isCurrentPlayer
          ? `<div class="library-peek-source" hidden>
               ${peekCards}
             </div>`
          : ""
      }
    </div>
  `

  return `
    <div class="zone-lanes">
      ${libraryPreview}
      ${lanes}
    </div>
  `

}

function renderPlayerControls(context: ComponentRenderContext): string {
  const player = playerAt({ room: context.payload.space, seat: context.seat })
  if (!player || player.id !== context.payload.currentPlayerId) return ""

  const deckPanel = player.deckName
    ? `<div class="selected-deck-panel">
        <h4>Loaded deck</h4>
        <p class="deck-name">${escapeHtml(player.deckName)}</p>
        <p class="selected-deck-meta">
          <span>Library ${player.library.length} cards</span>
          <span>Hand ${player.hand.length} · Graveyard ${player.graveyard.length} · Exile ${player.exile.length}</span>
        </p>
      </div>
      <div class="controls-block">
        <h4>Counter token</h4>
        <p class="hint">Drag this onto a battlefield card.</p>
        <div class="counter-palette-token" data-counter-palette>+1/+1</div>
      </div>`
    : ""

  const status =
    player.deckStatus === "loading"
      ? `<p class="deck-status">Loading the deck…</p>`
      : player.deckStatus === "failed"
        ? `<p class="deck-status deck-status-failed">The deck could not be loaded. Try again.</p>`
        : ""

  return `<aside class="left-rail panel">
  <details class="deck-browser"${player.deckName ? "" : " open"}>
    <summary>${player.deckName ? "Change deck" : "Choose a deck"}</summary>
    <form class="deck-search-row" data-deck-search>
      <input type="search" name="q" placeholder="Search Archidekt decks" minlength="2" required />
      <button type="submit">Search</button>
    </form>
    <div class="search-term-row">
      ${["oldschool", "commander", "cedh", "modern", "legacy", "pauper"]
        .map((term) => `<button type="button" class="search-term-chip" data-deck-term="${term}">${term}</button>`)
        .join("")}
    </div>
    <div class="deck-results" data-deck-results></div>
    <form class="deck-load-row" data-deck-load>
      <input type="text" name="deckId" placeholder="Archidekt deck ID or URL" required />
      <button type="submit">Load deck</button>
    </form>
  </details>
  ${status}
  ${deckPanel}
</aside>`
}

function renderLibrarySearch(context: ComponentRenderContext): string {
  const player = playerAt({ room: context.payload.space, seat: context.seat })
  if (!player || player.id !== context.payload.currentPlayerId) return ""
  if (!player.isSearchingDeck) return ""

  const cards = player.library
    .map((card) =>
      actionButton({
        action: { type: "moveLibraryCardToHand", instanceId: card.instanceId },
        label: cardFace(card),
        className: "library-search-item",
        preview: card,
        libraryCardName: card.name.toLowerCase(),
      }),
    )
    .join("")

  return `<div class="modal-overlay">
  <section class="modal-card library-search-modal-card" role="dialog" aria-modal="true">
    <h3>Search library</h3>
    <p>Choose a card to move it from your library to your hand.</p>
    <input type="search" placeholder="Filter card names" data-library-filter aria-label="Filter library cards by name" />
    <p class="library-search-feedback" data-library-search-count role="status" aria-live="polite">${player.library.length} cards</p>
    <div class="library-search-list">${cards}</div>
    ${actionButton({ action: { type: "closeDeckSearch" }, label: "Close", className: "modal-cancel-button" })}
  </section>
</div>`
}

function renderGameResult(context: ComponentRenderContext): string {
  const room = context.payload.space
  if (!room) return ""

  const current = room.players.find((player) => player.seat === context.seat)
  const opponents = room.players.filter((player) => player.seat !== context.seat)
  if (current && current.life <= 0) {
    return `<div class="game-result-banner lose" aria-live="polite"><p class="game-result-banner-text">YOU LOSE</p></div>`
  }
  if (opponents.length > 0 && room.players.length === (room.maxPlayers ?? 2) && opponents.every((player) => player.life <= 0)) {
    return `<div class="game-result-banner win" aria-live="polite"><p class="game-result-banner-text">YOU WIN</p></div>`
  }
  return ""
}

function actionButton(options: {
  action: GameAction
  label: string
  className?: string
  title?: string
  accessibleName?: string
  preview?: PublicCard
  libraryCardName?: string
  cssStyle?: string
}): string {
  const className = options.className ? ` class="${attribute(options.className)}"` : ""
  // Only renderer-generated numeric CSS variables are supplied by renderHand.
  const style = options.cssStyle ? ` style="${attribute(options.cssStyle)}"` : ""
  const describedName = options.accessibleName ?? options.title
  const title = describedName ? ` data-tooltip="${attribute(describedName)}"` : ""
  const label = describedName ? ` aria-label="${attribute(describedName)}"` : ""
  const preview = options.preview ? ` ${previewAttributes(options.preview)}` : ""
  const filter = options.libraryCardName
    ? ` data-library-card-name="${attribute(options.libraryCardName)}"`
    : ""

  return `<button type="button"${className}${style}${title}${label}${preview}${filter} data-game-action="${jsonAttribute(options.action)}">${options.label}</button>`
}

function previewAttributes(card: PublicCard): string {
  return `data-preview-image="${attribute(card.imageUrl)}" data-preview-name="${attribute(card.name)}"`
}

function cardFace(card: PublicCard): string {
  const image = card.imageUrl
    ? `<img loading="lazy" src="${attribute(card.imageUrl)}" alt="${attribute(card.name)}" />`
    : `<span class="hidden-card-face"></span>`
  return `${image}<span>${escapeHtml(card.name)}</span>`
}
