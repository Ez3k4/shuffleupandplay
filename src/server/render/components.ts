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
  }
}

function renderTableStatus(context: ComponentRenderContext): string {
  const room = context.payload.space
  const opponentSeat = context.seat === 1 ? 2 : 1
  if (room?.players.some((player) => player.seat === opponentSeat)) return ""

  const shareUrl = `${context.shareUrl}`
  return `<section class="panel waiting-panel">
    <h2>Waiting for your opponent</h2>
    <p>Send the invite link. Opening it fills in the table code automatically, so your opponent only types a name.</p>
    <div class="waiting-actions">
      <button type="button" class="primary-action" data-copy-text="${attribute(shareUrl)}">Copy invite link</button>
      <button type="button" class="secondary-action" data-share-url="${attribute(shareUrl)}" data-share-hidden hidden>Share…</button>
    </div>
    <p class="waiting-code">Table code <strong>${escapeHtml(context.roomCode)}</strong></p>
    <p class="waiting-count">${room?.players.length ?? 1} of 2 players connected</p>
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



// Stage 9: this panel uses only the viewer's own hand; no private card data
// is emitted into the opponent's DOM. It disappears after the hand is kept.
function renderStage9Opening(player: PublicPlayer, isCurrentPlayer: boolean): string {
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
    ${isCurrentPlayer ? actionButton({ action: { type: "adjustLife", delta: -1 }, label: "−" }) : ""}
    <span class="life-value">${player.life}</span>
    ${isCurrentPlayer ? actionButton({ action: { type: "adjustLife", delta: 1 }, label: "+" }) : ""}
    ${isCurrentPlayer ? actionButton({ action: { type: "resetLife" }, label: "Reset" }) : ""}
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

const lifeControls = `
  <div class="life-controls">
    ${
      isCurrentPlayer
        ? actionButton({
            action: { type: "adjustLife", delta: -1 },
            label: "−"
          })
        : ""
    }

    <span class="life-value">${player.life}</span>

    ${
      isCurrentPlayer
        ? actionButton({
            action: { type: "adjustLife", delta: 1 },
            label: "+"
          })
        : ""
    }

    ${
      isCurrentPlayer
        ? actionButton({
            action: { type: "resetLife" },
            label: "Reset"
          })
        : ""
    }
  </div>
`

    
  const actions =
    isCurrentPlayer && player.deckName
      ? `<div class="zone-summary-actions">
          ${actionButton({
            action: { type: "untapAll" },
            label: "Untap all"
          })}
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


function renderHand(player: PublicPlayer): string {
  const cards = [...player.hand]
    .reverse()
    .map((card) =>
      actionButton({
        action: { type: "playFromHand", instanceId: card.instanceId },
        label: cardFace(card),
        className: "hand-card",
        preview: card,
      }),
    )
    .join("")

  return `<div class="hand-strip">${cards}</div>`
}

function renderBattlefield(options: {
  player: PublicPlayer
  isCurrentPlayer: boolean
}): string {
  const cards = options.player.battlefield
    .filter((card) => !isLandCard(card))
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
  const lands = renderLandZone(options)

  return `<div class="battlefield"><div class="battlefield-canvas" data-battlefield-player-id="${attribute(options.player.id)}">${cards}${lands}</div></div>`
}

function renderBattlefieldCard(options: {
  card: PublicBattlefieldCard
  isCurrentPlayer: boolean
  landStackIndex?: number
  hasAttachments?: boolean
  attachmentIndex?: number
}): string {
  const { card, isCurrentPlayer } = options
  const tools = isCurrentPlayer ? renderCardTools(card) + renderStage8AttachmentTool(card) : ""
  const counters = card.counters
    .map((counter) => {
      const controls = isCurrentPlayer
        ? actionButton({
            action: {
              type: "updateCounterValue",
              instanceId: card.instanceId,
              counterId: counter.id,
              delta: -1,
            },
            label: "−",
          }) +
          actionButton({
            action: {
              type: "updateCounterValue",
              instanceId: card.instanceId,
              counterId: counter.id,
              delta: 1,
            },
            label: "+",
          })
        : ""
      return `<div class="counter-chip" data-counter-id="${attribute(counter.id)}" data-instance-id="${attribute(card.instanceId)}" style="left:${counter.x}px;top:${counter.y}px">${controls}<span class="counter-value">${counter.value}</span></div>`
    })
    .join("")

  const isLandStackCard = options.landStackIndex !== undefined
  const position = isLandStackCard
    ? `--stage7-stack-index:${options.landStackIndex}`
    : `left:calc(var(--tabletop-travel-x) * ${card.x / 1200});top:calc(var(--tabletop-travel-y) * ${card.y / 700})`
  const landClass = isLandStackCard ? " stage7-land-card" : ""
  return `<div class="battlefield-card${card.tapped ? " tapped" : ""}${landClass}${card.attachedTo ? " stage8-attached" : ""}${options.hasAttachments ? " stage8-attachment-host" : ""}" data-instance-id="${attribute(card.instanceId)}" data-stage8b-attachable="${card.isAttachment === true ? "true" : "false"}" ${previewAttributes(card)} style="${position};--stage8c-attach-x:${23 + Math.min(options.attachmentIndex ?? 0, 8) * 26}px;--stage8c-attach-y:${31 + Math.min(options.attachmentIndex ?? 0, 8) * 16}px">
  <img loading="lazy" src="${attribute(card.imageUrl)}" alt="${attribute(card.name)}" />
  <div class="card-tools">${tools}</div>${counters}
</div>`
}

// Land is a subtype-independent card type, NOT the same as "produces mana".
// A non-land mana rock must remain on the ordinary battlefield.
function isLandCard(card: PublicBattlefieldCard): boolean {
  // Always recognize basic lands, including decks imported with isLand: false.
  if (/^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest|Wastes)$/i.test(card.name.trim())) return true
  // Avoid treating mana-producing nonlands (such as Sol Ring) as lands.
  return card.isLand === true
}

// Only the HTML layout is grouped. Every card keeps its instanceId, tap state,
// counters and independent move actions in the shared player.battlefield array.
function renderLandZone(options: {
  player: PublicPlayer
  isCurrentPlayer: boolean
}): string {
  const groups = new Map<string, PublicBattlefieldCard[]>()
  for (const card of options.player.battlefield) {
    if (!isLandCard(card)) continue
    const key = card.name.trim().toLocaleLowerCase("en")
    const group = groups.get(key) ?? []
    group.push(card)
    groups.set(key, group)
  }
  if (!groups.size) return ""

  const stacks = [...groups.values()].map((cards) => {
    // Render tapped copies at the back so untapped copies are easy to select.
    const sorted = [...cards].sort((a, b) => Number(b.tapped) - Number(a.tapped))
    const faces = sorted
      .map((card, index) => renderBattlefieldCard({
        card,
        isCurrentPlayer: options.isCurrentPlayer,
        landStackIndex: Math.min(index, 3),
      }))
      .join("")
    const tappedCount = cards.filter((card) => card.tapped).length
    return `<div class="stage7-land-stack" title="${attribute(cards[0]?.name ?? "Land")}" aria-label="${attribute(cards[0]?.name ?? "Land")}, ${cards.length} copies, ${tappedCount} tapped">
      ${faces}
      <span class="stage7-land-count">${tappedCount ? `${tappedCount}/` : ""}${cards.length}</span>
    </div>`
  }).join("")
  const total = [...groups.values()].reduce((sum, cards) => sum + cards.length, 0)
  return `<div class="stage7-land-zone" aria-label="Land area">
    <div class="stage7-land-title"><span>Lands</span><span>${total}</span></div>
    <div class="stage7-land-row">${stacks}</div>
  </div>`
}

function renderStage8AttachmentTool(card: PublicBattlefieldCard): string {
  const name = attribute(card.name)
  return card.attachedTo
    ? `<button type="button" class="card-tool stage8-tool" data-stage8-detach="true" title="Detach ${name}">Unlink</button>`
    : `<button type="button" class="card-tool stage8-tool" data-stage8-attach-start="true" title="Attach ${name} to another card">Attach</button>`
}

function renderCardTools(card: PublicBattlefieldCard): string {
  const name = card.name

  return [
    actionButton({
      action: { type: "addCounter", instanceId: card.instanceId, x: 8, y: 8, label: "+1/+1" },
      label: "➕",
      className: "card-tool",
      accessibleName: `Add a counter to ${name}`,
    }),
    actionButton({
      action: {
        type: "moveCardZone",
        instanceId: card.instanceId,
        from: "battlefield",
        to: "hand",
      },
      label: "🖐️",
      className: "card-tool",
      accessibleName: `Move ${name} to hand`,
    }),
    actionButton({
      action: {
        type: "moveToDeck",
        instanceId: card.instanceId,
        from: "battlefield",
        position: "shuffle",
      },
      label: "🔀",
      className: "card-tool",
      accessibleName: `Shuffle ${name} into library`,
    }),
    actionButton({
      action: {
        type: "moveCardZone",
        instanceId: card.instanceId,
        from: "battlefield",
        to: "graveyard",
      },
      label: "🪦",
      className: "card-tool",
      accessibleName: `Move ${name} to graveyard`,
    }),
    actionButton({
      action: {
        type: "moveCardZone",
        instanceId: card.instanceId,
        from: "battlefield",
        to: "exile",
      },
      label: "✨",
      className: "card-tool",
      accessibleName: `Move ${name} to exile`,
    }),
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
    <input type="search" placeholder="Filter card names" data-library-filter />
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
  if (opponents.some((player) => player.life <= 0)) {
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
}): string {
  const className = options.className ? ` class="${attribute(options.className)}"` : ""
  const describedName = options.accessibleName ?? options.title
  const title = describedName ? ` data-tooltip="${attribute(describedName)}"` : ""
  const label = describedName ? ` aria-label="${attribute(describedName)}"` : ""
  const preview = options.preview ? ` ${previewAttributes(options.preview)}` : ""
  const filter = options.libraryCardName
    ? ` data-library-card-name="${attribute(options.libraryCardName)}"`
    : ""

  return `<button type="button"${className}${title}${label}${preview}${filter} data-game-action="${jsonAttribute(options.action)}">${options.label}</button>`
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
