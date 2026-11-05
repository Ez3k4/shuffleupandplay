import {
  SolidObjectsBrowserClient,
  SolidObjectsComponentRegistry,
} from "/vendor/live/browser/index.js"
import { renderComponent } from "/shared/server/render/components.ts"
import { cardPoint, dragOffset, dragPosition, rotationFromTransform } from "./drag-math.js"
import { morph } from "./morph.js"
import { mountStage12SpellOverlay } from "./stage12-spells.js"
import { findStage13DropTarget } from "./stage13-drop-target.js"
import { mountStage13Wallpapers, mountStage14LobbyWallpaper } from "./stage13-wallpapers.js"

/*
 * SHUFFLE.JS MAINTAINER GUIDE
 * - start() / startMirror()          websocket refresh, session-owned mirror
 * - wireActions() / sendAction()    dispatch game actions to the server
 * - beginDrag() / finishDrag()      pointer dragging and logical coordinates
 * - wireDeckForms()                 Archidekt search/import controls
 * - wireCardPreview()               full printed card hover preview
 * - wireLibraryFilter()             library search filtering
 * - wireZoneInspector()             graveyard and exile inspector
 * - wireCardTools()                 basic right-click menu
 * - Stage 3 / Stage 7               library and land/utility-stack menus
 * - Stage 8                         attaching Auras and Equipment
 * - Stage 9 / Stage 10              mulligans (disabled server-side), Commander
 * - Stage 11                        resize based on nonland battlefield count
 * - Stage 08                        foreground cards and fanned hand visuals
 * - Stage 09                        hand drag-to-play, quick-zone icons, life clicks
 * - Stage 11                        drag-only hand; spells remain pending until Resolve
 * - Stage 12                        central spell overlay; fixed-placed planeswalkers and utilities
 * - Stage 13                        cross-board hand drop; subtle individual battlefield wallpapers
 *
 * Card classification and location are SERVER-rendered in
 * src/server/render/components.ts; importer metadata lives in
 * src/archidekt/client.ts. Keep both aligned when adding new card types.
 */

const MIRROR_COMPONENTS = ["player", "playerControls", "librarySearch"]
const SETTLE_INTERVAL_MILLISECONDS = 1000
const FALLBACK_DELAY_MILLISECONDS = 6000
const FALLBACK_RETRY_MILLISECONDS = 3000
const FALLBACK_TIMEOUT_MILLISECONDS = 25000
const TOOLTIP_DELAY_MILLISECONDS = 90
const TAP_SLOP_PIXELS = 10
const COUNTER_GRAB = { x: 18, y: 12 }
const DECK_COLORS = ["W", "U", "B", "R", "G", "C"]

const game = document.querySelector("[data-game]")
if (game) start(game)
// Stage 14: initial create/join page (not the in-game tabletop).
const lobbyPanel = document.querySelector('.lobby-panel')
if (lobbyPanel && !game) mountStage14LobbyWallpaper(lobbyPanel)

let mirror = null

function start(game) {
  const actorType = game.dataset.tableType
  const actorId = game.dataset.tableCode
  const declarations = JSON.parse(game.dataset.components)
  const seat = Number(game.dataset.seat)
  const currentPlayerId = game.dataset.currentPlayerId
  const workerUrl = game.dataset.workerUrl

  const registry = new SolidObjectsComponentRegistry({
    refresh: async ({ actorType, actorId, instanceId, revision, batch, components, signal }) => {
      const response = await fetch("/api/components/refresh", {
        method: "POST",
        signal,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actorType, actorId, instanceId, revision, batch, components }),
      })
      if (!response.ok) throw new Error(`component refresh failed with ${response.status}`)
      return response.json()
    },
    apply: ({ component, rendered }) => {
      if (mirror?.owns(component.target)) return

      const target = document.getElementById(component.target)
      if (!target) return
      if (component.strategy === "morph") return morph(target, rendered)
      target.innerHTML = rendered
    },
    onError: () => showToast("The table could not refresh. It retries on the next change."),
  })

  for (const declaration of declarations) {
    registry.register({
      actorType,
      actorId,
      target: targetIdFor(declaration),
      name: declaration.name,
      ...(declaration.key === undefined ? {} : { key: declaration.key }),
      observes: declaration.observes,
      ...(declaration.batch === undefined ? {} : { batch: declaration.batch }),
      strategy: declaration.strategy,
    })
  }

  const url = new URL("/live", window.location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("roomCode", actorId)

  const fallback = createChangeFallback({ actorId, registry })

  const client = new SolidObjectsBrowserClient({
    url,
    createWebSocket: (target) => {
      const socket = new WebSocket(target)
      socket.addEventListener("open", () => {
        fallback.stop()
        setConnectionState("connected")
      })
      socket.addEventListener("close", () => {
        fallback.startLater()
        setConnectionState("reconnecting")
      })
      return socket
    },
    onInvalidation: (envelope) => {
      fallback.observe(envelope)
      setConnectionState("connected")
      registry.invalidate(envelope)
      void mirror?.reconcile()
    },
    onPayload: () => {
      setConnectionState("connected")
    },
    onError: () => {
      fallback.startLater()
      setConnectionState("reconnecting")
    },
  })

  fallback.startLater()

  window.addEventListener("offline", () => setConnectionState("offline"))
  window.addEventListener("online", () => setConnectionState("reconnecting"))

  client.subscribe({ actorType, actorId, payloads: ["game"] })
  client.connect()

  void startMirror({ actorId, seat, currentPlayerId, workerUrl }).then((started) => {
    mirror = started
  })

  wireActions(game, actorId)
  wireStage09HandDrag(game, actorId)
  wireStage09LifeControl(actorId)
  wireStage08BringToFront(game)
  wireStage9Mulligan(actorId)
  wireStage10Commander(actorId)
  wireLandStackTap(actorId)
  wireStage8cCardMenu()
  wireStage8Attachments(actorId)
  wireDeckForms(game, actorId)
  wireCardPreview()
  wireLibraryFilter()
  wireZoneInspector(game)
  mountStage12SpellOverlay(game)
  mountStage13Wallpapers(game)
  wireCopyButton()
  wireTooltips()
  wireCardTools(game)
  wireLibraryPeek(game)
  wireLibraryControls(game, actorId)
  wireLibraryCardTools(game)
}

async function startMirror({ actorId, seat, currentPlayerId, workerUrl }) {
  if (!workerUrl || !currentPlayerId || !window.Worker) return null

  try {
    const worker = new Worker(workerUrl, { type: "module" })
    const send = workerSender(worker)
    await send({ command: "start", roomCode: actorId, playerId: currentPlayerId })

    const targets = new Set(MIRROR_COMPONENTS.map((name) => `component-${name}-${seat}`))
    let payload = await fetchState(actorId)
    const own = ownPlayer({ payload, currentPlayerId })
    if (!own) throw new Error("this session holds no seat at the table")

    let settling = 0

    const mirror = {
      owns: (target) => targets.has(target),
      apply: async (action) => {
        const state = await send({ command: "apply", action })
        draw({ state, payload, actorId, seat })
        settle()
        return state
      },
      reconcile: async () => {
        payload = await fetchState(actorId)
        const player = ownPlayer({ payload, currentPlayerId })
        if (!player) return null

        const state = await send({ command: "reconcile", player })
        draw({ state, payload, actorId, seat })
        if (state.pendingCount === 0) stopSettling()
        return state
      },
    }

    function settle() {
      if (settling) return
      settling = window.setInterval(() => {
        void mirror.reconcile().catch(() => undefined)
      }, SETTLE_INTERVAL_MILLISECONDS)
    }

    function stopSettling() {
      window.clearInterval(settling)
      settling = 0
    }

    const seeded = await send({ command: "seed", player: own })
    draw({ state: seeded, payload, actorId, seat, currentPlayerId })
    return mirror
  } catch {
    showToast("This table runs without a local move queue.")
    return null
  }
}

function workerSender(worker) {
  return (request) =>
    new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const onMessage = (event) => {
        if (event.data.requestId !== requestId) return
        worker.removeEventListener("message", onMessage)
        if (event.data.ok) return resolve(event.data.value)
        reject(new Error(event.data.message))
      }
      worker.addEventListener("message", onMessage)
      worker.postMessage({ requestId, ...request })
    })
}

async function fetchState(actorId) {
  const response = await fetch(`/api/tables/${actorId}/state`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error(`the table state is unavailable (${response.status})`)
  return response.json()
}

function ownPlayer({ payload, currentPlayerId }) {
  return payload?.space?.players.find((player) => player.id === currentPlayerId) ?? null
}

function draw({ state, payload, actorId, seat }) {
  if (!state?.player || !payload?.space) return

  const context = {
    payload: {
      ...payload,
      space: {
        ...payload.space,
        players: payload.space.players.map((player) =>
          player.id === state.player.id ? state.player : player,
        ),
      },
    },
    roomCode: actorId,
    seat,
    shareUrl: window.location.href,
  }

  for (const name of MIRROR_COMPONENTS) {
    const target = document.getElementById(`component-${name}-${seat}`)
    if (!target) continue
    morph(target, renderComponent({ name, key: String(seat), context }))
  }

  showQueuedMoves(state.pendingCount)
}

function showQueuedMoves(pendingCount) {
  const element = document.querySelector("[data-queued-moves]")
  if (!element) return

  element.hidden = pendingCount === 0
  element.textContent = pendingCount === 1 ? "1 move waiting" : `${pendingCount} moves waiting`
}

function createChangeFallback({ actorId, registry }) {
  let revision = "0"
  let running = false
  let timer = 0

  const observe = (envelope) => {
    if (BigInt(envelope.revision) > BigInt(revision)) revision = String(envelope.revision)
  }

  const stop = () => {
    window.clearTimeout(timer)
    timer = 0
    running = false
  }

  const startLater = () => {
    if (running || timer) return
    timer = window.setTimeout(() => {
      timer = 0
      running = true
      void poll()
    }, FALLBACK_DELAY_MILLISECONDS)
  }

  const poll = async () => {
    while (running) {
      const waited = await pollOnce()
      if (!running) return
      if (waited) continue

      await new Promise((resolve) => window.setTimeout(resolve, FALLBACK_RETRY_MILLISECONDS))
    }
  }

  const pollOnce = async () => {
    const query = `since=${encodeURIComponent(revision)}&timeout=${FALLBACK_TIMEOUT_MILLISECONDS}`
    try {
      const response = await fetch(`/api/tables/${actorId}/changes?${query}`, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      })
      if (response.status === 204) return true
      if (!response.ok) return false

      const envelope = await response.json()
      observe(envelope)
      registry.invalidate(envelope)
      void mirror?.reconcile()
      setConnectionState("connected")
      return true
    } catch {
      return false
    }
  }

  return { observe, stop, startLater }
}

function wireTooltips() {
  let element = null
  let timer = 0

  const hide = () => {
    window.clearTimeout(timer)
    element?.remove()
    element = null
  }

  const show = (control) => {
    const text = control.dataset.tooltip
    if (!text) return

    hide()
    timer = window.setTimeout(() => {
      element = document.createElement("div")
      element.className = "tooltip"
      element.setAttribute("role", "presentation")
      element.textContent = text
      document.body.append(element)
      placeTooltip(element, control)
    }, TOOLTIP_DELAY_MILLISECONDS)
  }

  document.addEventListener("pointerover", (event) => {
    const control = event.target.closest?.("[data-tooltip]")
    if (control) return show(control)
    if (element) hide()
  })
  document.addEventListener("pointerdown", hide)
  document.addEventListener("focusin", (event) => {
    const control = event.target.closest?.("[data-tooltip]")
    if (control) show(control)
  })
  document.addEventListener("focusout", hide)
  window.addEventListener("scroll", hide, true)
}

function placeTooltip(element, control) {
  const anchor = control.getBoundingClientRect()
  const box = element.getBoundingClientRect()
  const margin = 8

  const left = Math.min(
    Math.max(margin, anchor.left + anchor.width / 2 - box.width / 2),
    window.innerWidth - box.width - margin,
  )
  const above = anchor.top - box.height - margin
  const top = above > margin ? above : anchor.bottom + margin

  element.style.left = `${Math.round(left)}px`
  element.style.top = `${Math.round(top)}px`
}

function targetIdFor(declaration) {
  return declaration.key === undefined
    ? `component-${declaration.name}`
    : `component-${declaration.name}-${declaration.key}`
}

const CONNECTION_LABELS = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  offline: "Offline — actions are unavailable",
}

let connectionState = "connecting"

function setConnectionState(state) {
  if (!CONNECTION_LABELS[state] || state === connectionState) return

  const previous = connectionState
  connectionState = state

  const element = document.querySelector("[data-connection-status]")
  if (element) {
    element.dataset.state = state
    const label = element.querySelector("[data-connection-label]")
    if (label) label.textContent = CONNECTION_LABELS[state]
  }

  if (state === "connected" && previous !== "connecting") showToast("Connection restored")
}

function showToast(message) {
  const region = document.querySelector("[data-toast-region]")
  if (!region) return

  const toast = document.createElement("p")
  toast.className = "toast"
  toast.textContent = message
  region.append(toast)
  window.setTimeout(() => toast.remove(), 4000)
}


// ===== Game actions: delegated buttons and network transport =====
// Most buttons carry data-game-action. Queued actions may pass through the
// optimistic mirror; server-only actions bypass it. The server is authoritative.
function wireActions(game, actorId) {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-game-action]")
    if (!button) return

    event.preventDefault()
    button.disabled = true
    try {
      await sendAction(actorId, JSON.parse(button.dataset.gameAction))
    } finally {
      button.disabled = false
    }
  })

  document.addEventListener("pointerdown", (event) => beginDrag(event, game))
  document.addEventListener("pointermove", moveDrag)
  document.addEventListener("pointerup", (event) => finishDrag(event, actorId))
  document.addEventListener("pointercancel", cancelDrag)
}

async function sendAction(actorId, action, gestureKey = newGestureKey()) {
  if (mirror) return queueAction(action)

  return postAction(actorId, action, gestureKey)
}

async function queueAction(action) {
  try {
    await mirror.apply(action)
    return true
  } catch {
    showToast("That action was not accepted. Try again.")
    return false
  }
}

async function postAction(actorId, action, gestureKey) {
  const response = await fetch(`/api/tables/${actorId}/actions`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      prefer: "respond-async",
      "idempotency-key": gestureKey,
    },
    body: JSON.stringify({ action }),
  })
  if (!response.ok) showToast("That action was not accepted. Try again.")
  return response.ok
}

function newGestureKey() {
  return crypto.randomUUID()
}

let drag = null

// ===== Stage 13: drag cards from hand to either battlefield / spell midpoint =====
// Hand cards deliberately have NO click-to-play action. Only a valid drop
// submits playFromHand; the server/renderer continues to
// route lands and noncreature artifacts/enchantments into their correct lanes.
// The original hand button stays in place; only a visual ghost follows the
// pointer, preventing accidental card disappearance or manual DOM state edits.
function wireStage09HandDrag(game, actorId) {
  const threshold = 12
  let held = null
  // Consume any synthetic click after releasing a pointer on a hand card.
  // The cards have no data-game-action, so the game cannot play on click.

  function clear() {
    if (!held) return
    held.button.classList.remove("stage09-hand-dragging")
    held.ghost?.remove()
    held.highlight?.classList.remove("stage09-drop-over")
    held = null
  }

  function targetAt(event) {
    return findStage13DropTarget(game, event.clientX, event.clientY)
  }

  function updateGhost(ghost, event) {
    ghost.style.left = `${event.clientX}px`
    ghost.style.top = `${event.clientY}px`
  }

  // Belt-and-suspenders safety: a click on a hand card never plays it.
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".your-seat .hand-card")) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)

  document.addEventListener("dragstart", (event) => {
    if (event.target.closest?.(".your-seat .hand-card")) event.preventDefault()
  }, true)

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return
    const button = event.target.closest?.(".your-seat .hand-card[data-hand-play-instance-id]")
    if (!button || !game.contains(button)) return
    const instanceId = button.dataset.handPlayInstanceId
    if (!instanceId) return
    const seat = button.closest(".your-seat")
    if (!seat) return
    held = {
      button, seat, instanceId,
      battlefield: seat.querySelector(".battlefield"),
      pointerId: event.pointerId,
      x: event.clientX, y: event.clientY,
      moved: false, ghost: null,
    }
    try { button.setPointerCapture(event.pointerId) } catch {}
  })

  document.addEventListener("pointermove", (event) => {
    if (!held || event.pointerId !== held.pointerId) return
    if (!held.moved && Math.hypot(event.clientX - held.x, event.clientY - held.y) < threshold) return
    if (!held.moved) {
      held.moved = true
      const ghost = document.createElement("img")
      ghost.className = "stage09-hand-drag-ghost"
      ghost.src = held.button.querySelector("img")?.src ?? ""
      ghost.alt = ""
      ghost.setAttribute("aria-hidden", "true")
      document.body.append(ghost)
      held.ghost = ghost
      held.button.classList.add("stage09-hand-dragging")
      held.battlefield?.classList.add("stage09-hand-drag-active")
    }
    event.preventDefault()
    updateGhost(held.ghost, event)
    const target = targetAt(event)
    if (held.highlight !== target) {
      held.highlight?.classList.remove("stage09-drop-over")
      target?.classList.add("stage09-drop-over")
      held.highlight = target
    }
  })

  document.addEventListener("pointerup", (event) => {
    if (!held || event.pointerId !== held.pointerId) return
    const wasDrag = held.moved
    const drop = wasDrag ? targetAt(event) : null
    const instanceId = held.instanceId
    held.battlefield?.classList.remove("stage09-hand-drag-active")
    clear()
    if (!wasDrag) return
    if (drop) {
      void sendAction(actorId, { type: "playFromHand", instanceId })
    } else {
      showToast("Drop onto either battlefield or the shared spell area to play.")
    }
  })

  document.addEventListener("pointercancel", () => {
    held?.battlefield?.classList.remove("stage09-hand-drag-active")
    clear()
  })
}

// ===== Stage 09B: compact life button: left +1, right -1 =====
// Left clicks use data-game-action through wireActions(). Only right-click is
// handled here, sending the same adjustLife action with a negative delta.
function wireStage09LifeControl(actorId) {
  document.addEventListener("contextmenu", (event) => {
    const button = event.target.closest?.(".your-seat .stage09-life-button")
    if (!button) return
    event.preventDefault()
    event.stopPropagation()
    void sendAction(actorId, { type: "adjustLife", delta: -1 })
  }, true)
}

// ===== Stage 08: bring last touched/dragged battlefield card to front =====
// Presentation-only state, scoped by player ID. On server/mirror rerenders the
// HTML nodes can be replaced, so a child-list observer restores the front class.
// Don't raise attached Auras/Equipment over their hosts: attachment layering
// is handled separately by Stage 8A/8B/8C.
function wireStage08BringToFront(game) {
  const lastCardByPlayer = new Map()
  let repaintScheduled = false

  function restore() {
    repaintScheduled = false
    for (const canvas of game.querySelectorAll(".battlefield-canvas[data-battlefield-player-id]")) {
      const lastId = lastCardByPlayer.get(canvas.dataset.battlefieldPlayerId)
      if (!lastId) continue
      for (const card of canvas.querySelectorAll(":scope > .battlefield-card")) {
        card.classList.toggle("stage08-front-card", card.dataset.instanceId === lastId && !card.classList.contains("stage8-attached"))
      }
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 2) return
    const card = event.target.closest?.(".battlefield-canvas > .battlefield-card")
    if (!card || card.classList.contains("stage8-attached")) return
    const canvas = card.closest(".battlefield-canvas")
    const playerId = canvas?.dataset.battlefieldPlayerId
    if (!playerId || !card.dataset.instanceId) return
    lastCardByPlayer.set(playerId, card.dataset.instanceId)
    restore()
  }, true)

  const observer = new MutationObserver(() => {
    if (repaintScheduled) return
    repaintScheduled = true
    window.requestAnimationFrame(restore)
  })
  // morph() can preserve the card node but replace its class attribute, too.
  // Observe classes as well as child nodes; restore() is idempotent.
  observer.observe(game, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] })
}

// ===== Pointer drag: card movement and board coordinates =====
// Floating land/utility cards are excluded from this generic drag handler;
// their individual controls are handled by wireLandStackTap() below.
function beginDrag(event, game) {
  // Stage 8C fix: a menu click must not initiate a battlefield drag.
  if (event.target.closest?.(".card-tools")) return
  // Land stacks are fixed UI objects; their copy is selected by clicking.
  if (event.target.closest?.(".compact-special-lanes, .stage7-land-zone")) return
  if (event.button !== 0) return
  const palette = event.target.closest("[data-counter-palette]")
  if (palette) {
    drag = { kind: "counterPalette", ghost: showCounterGhost(event, palette) }
    event.preventDefault()
    return
  }

  const counter = event.target.closest(".counter-chip")
  if (counter && !event.target.closest("button")) {
    const frame = cardFrame(counter.closest(".battlefield-card"))
    const grab = cardPoint({ pointer: { x: event.clientX, y: event.clientY }, frame })
    drag = {
      kind: "counter",
      element: counter,
      instanceId: counter.dataset.instanceId,
      counterId: counter.dataset.counterId,
      frame,
      offset: { x: grab.x - counter.offsetLeft, y: grab.y - counter.offsetTop },
    }
    counter.setPointerCapture(event.pointerId)
    return
  }

  const card = event.target.closest(".battlefield-card")
  if (!card || event.target.closest("button, .counter-chip")) return
  if (!belongsToCurrentPlayer(card, game)) return

  const canvas = card.closest(".battlefield-canvas").getBoundingClientRect()
  drag = {
    kind: "card",
    element: card,
    instanceId: card.dataset.instanceId,
    stage8bManual: event.shiftKey,
    stage8bStartLeft: card.style.left,
    stage8bStartTop: card.style.top,
    startLeft: card.offsetLeft,
    startTop: card.offsetTop,
    canvas,
    offset: dragOffset({
      pointer: { x: event.clientX, y: event.clientY },
      canvas,
      card: { left: card.offsetLeft, top: card.offsetTop },
    }),
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  }
  card.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function moveDrag(event) {
  if (!drag) return

  if (drag.kind === "counterPalette") {
    moveCounterGhost(drag.ghost, event)
    return
  }

  if (drag.kind === "card") {
    const travelled = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY)
    if (!drag.moved && travelled < TAP_SLOP_PIXELS) return
    if (!drag.moved) drag.element.classList.add("is-dragging")
    drag.moved = true
  }

  const position = positionFor({ held: drag, event })
  drag.element.style.left = `${position.left}px`
  drag.element.style.top = `${position.top}px`
  stage8bMove(event)
}

function positionFor(options) {
  const { held, event } = options
  const pointer = { x: event.clientX, y: event.clientY }
  if (held.kind !== "counter") {
    return dragPosition({ pointer, canvas: held.canvas, offset: held.offset })
  }

  const point = cardPoint({ pointer, frame: held.frame })
  return {
    left: Math.max(0, Math.round(point.x - held.offset.x)),
    top: Math.max(0, Math.round(point.y - held.offset.y)),
  }
}

function cardFrame(card) {
  const rectangle = card.getBoundingClientRect()

  return {
    center: {
      x: rectangle.left + rectangle.width / 2,
      y: rectangle.top + rectangle.height / 2,
    },
    size: { width: card.offsetWidth, height: card.offsetHeight },
    rotation: rotationFromTransform(window.getComputedStyle(card).transform),
  }
}

function showCounterGhost(event, palette) {
  const ghost = document.createElement("div")
  ghost.className = "counter-ghost"
  ghost.textContent = palette.textContent?.trim() || "+1/+1"
  ghost.setAttribute("aria-hidden", "true")
  document.body.append(ghost)
  moveCounterGhost(ghost, event)
  return ghost
}

function moveCounterGhost(ghost, event) {
  if (!ghost) return
  ghost.style.left = `${event.clientX}px`
  ghost.style.top = `${event.clientY}px`
}

function removeCounterGhost() {
  document.querySelector(".counter-ghost")?.remove()
}

function finishDrag(event, actorId) {
  if (!drag) return

  const current = drag
  drag = null
  current.element?.classList.remove("is-dragging")

  if (current.kind === "counterPalette") {
    removeCounterGhost()
    const card = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest(".battlefield-card")
    if (!card) return

    const point = cardPoint({
      pointer: { x: event.clientX, y: event.clientY },
      frame: cardFrame(card),
    })
    return void sendAction(actorId, {
      type: "addCounter",
      instanceId: card.dataset.instanceId,
      counterId: crypto.randomUUID(),
      x: Math.max(0, Math.round(point.x - COUNTER_GRAB.x)),
      y: Math.max(0, Math.round(point.y - COUNTER_GRAB.y)),
      label: "+1/+1",
    })
  }

  if (stage8bDrop(current, event, actorId)) return

  const position = positionFor({ held: current, event })

  if (current.kind === "counter") {
    return void sendAction(actorId, {
      type: "moveCounter",
      instanceId: current.instanceId,
      counterId: current.counterId,
      x: position.left,
      y: position.top,
    })
  }

  if (!current.moved) {
    return void sendAction(actorId, { type: "toggleTap", instanceId: current.instanceId })
  }

  if (cardOverlapsPile(current.element) || cardOverlapsLandZone(current.element)) {
    current.element.style.left = `${current.startLeft}px`
    current.element.style.top = `${current.startTop}px`
    showToast("Move cancelled: card piles occupy this area.")
    return
  }
  const logicalPosition = tabletopLogicalPosition(current.element, position)
  void sendAction(actorId, {
    type: "moveBattlefieldCard",
    instanceId: current.instanceId,
    x: logicalPosition.x,
    y: logicalPosition.y,
  })
}

function cancelDrag() {
  stage8bReset()
  drag?.element?.classList.remove("is-dragging")
  removeCounterGhost()
  drag = null
}

function belongsToCurrentPlayer(card, game) {
  return card.closest(".player-section")?.dataset.currentPlayer === "true" && Boolean(game)
}

// ===== Deck browser: search and import from Archidekt =====
function wireDeckForms(game, actorId) {
  document.addEventListener("submit", async (event) => {
    const searchForm = event.target.closest("[data-deck-search]")
    if (searchForm) {
      event.preventDefault()
      await runDeckSearch(new FormData(searchForm).get("q"))
      return
    }

    const loadForm = event.target.closest("[data-deck-load]")
    if (!loadForm) return

    event.preventDefault()
    await loadDeck(actorId, new FormData(loadForm).get("deckId"))
  })

  document.addEventListener("click", async (event) => {
    const term = event.target.closest("[data-deck-term]")
    if (term) return void runDeckSearch(term.dataset.deckTerm)

    const result = event.target.closest("[data-deck-id]")
    if (result) return void loadDeck(actorId, result.dataset.deckId)
  })
}

async function runDeckSearch(query) {
  const results = document.querySelector("[data-deck-results]")
  if (!results || !query) return

  results.textContent = "Searching…"
  const response = await fetch(`/api/archidekt/search?q=${encodeURIComponent(query)}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  })
  if (!response.ok) {
    results.textContent = "Archidekt is unavailable"
    return
  }

  const { decks } = await response.json()
  results.replaceChildren(...decks.slice(0, 40).map(deckResultElement))
}

function deckResultElement(deck) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "deck-result-item"
  button.dataset.deckId = String(deck.id)
  button.append(deckCoverElement(deck), deckContentElement(deck))
  return button
}

function deckCoverElement(deck) {
  const source = safeImageUrl(deck.featuredUrl)
  if (!source) {
    const placeholder = document.createElement("span")
    placeholder.className = "deck-result-cover"
    return placeholder
  }

  const cover = document.createElement("img")
  cover.className = "deck-result-cover"
  cover.loading = "lazy"
  cover.alt = ""
  cover.src = source
  return cover
}

function deckContentElement(deck) {
  const content = document.createElement("span")
  content.className = "deck-result-content"

  const name = document.createElement("strong")
  name.textContent = deck.name

  const meta = document.createElement("span")
  meta.className = "meta"
  meta.textContent = [deck.ownerName, `${deck.size} cards`, deck.updatedAt]
    .filter((part) => part)
    .join(" · ")

  content.append(name, meta, deckColorBar(deck.colorBands))
  return content
}

function deckColorBar(bands) {
  const bar = document.createElement("span")
  bar.className = "deck-color-bar"

  const usable = Array.isArray(bands) ? bands.filter((band) => band.weight > 0) : []
  if (usable.length === 0) {
    bar.append(deckColorSegment("C", 100))
    return bar
  }

  const total = usable.reduce((sum, band) => sum + band.weight, 0)
  for (const band of usable) {
    bar.append(deckColorSegment(band.color, (band.weight / total) * 100))
  }
  return bar
}

function deckColorSegment(color, percent) {
  const known = DECK_COLORS.includes(color) ? color : "C"
  const segment = document.createElement("span")
  segment.className = `deck-color-segment color-${known}`
  segment.style.width = `${percent}%`
  segment.textContent = known
  return segment
}

function safeImageUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

async function loadDeck(actorId, deckId) {
  if (!deckId) return

  const response = await fetch(`/api/tables/${actorId}/deck`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ deckId }),
  })
  setConnectionState(response.ok ? "Loading the deck…" : "The deck could not be requested")
}


// Scryfall art crops are not guaranteed for every printing/face.
// Fall back to the original complete card image if an artwork request fails.
document.addEventListener('error', (event) => {
  const image = event.target
  if (!(image instanceof HTMLImageElement)) return
  const fallback = image.dataset.artFallback
  if (!fallback || image.src === fallback) return
  image.removeAttribute('data-art-fallback')
  image.src = fallback
}, true)

// ===== Full-card hover preview (the battlefield face uses art_crop) =====
function wireCardPreview() {
  const preview = document.getElementById("card-hover-preview")
  if (!preview) return

  const image = document.getElementById("card-hover-preview-image")
  const name = document.getElementById("card-hover-preview-name")

  function hide() {
    preview.classList.remove("is-visible")
  }

  function show(event) {
    const card = event.target.closest?.("[data-preview-image]")
    if (!card) return

    // Modal dialogs are in the browser's top layer.
    // Move the preview inside the active dialog.
    const dialog = card.closest("dialog[open]")
    const host = dialog ?? document.body

    if (preview.parentElement !== host) {
      host.appendChild(preview)
    }

    image.src = card.dataset.previewImage
    image.alt = card.dataset.previewName ?? "Card preview"
    name.textContent = card.dataset.previewName ?? ""

    preview.classList.add("is-visible")
  }

  document.addEventListener("mouseover", show)
  document.addEventListener("focusin", show)

  document.addEventListener("mouseout", (event) => {
    const card = event.target.closest?.("[data-preview-image]")
    if (!card) return

    if (event.relatedTarget && card.contains(event.relatedTarget)) {
      return
    }

    hide()
  })

  document.addEventListener("focusout", (event) => {
    if (event.target.closest?.("[data-preview-image]")) {
      hide()
    }
  })

  // Restore the preview to the normal document when
  // a library, graveyard or exile dialog closes.
  document.addEventListener("close", (event) => {
    if (event.target.matches("dialog")) {
      hide()
      document.body.appendChild(preview)
    }
  }, true)
}


// ===== Library search: filter existing buttons, do not change game state =====
function wireLibraryFilter() {
  function filter(input) {
    const modal = input.closest('.library-search-modal-card')
    if (!modal) return
    const query = input.value.trim().toLowerCase()
    const cards = [...modal.querySelectorAll('[data-library-card-name]')]
    let matches = 0
    for (const card of cards) {
      const shown = (card.dataset.libraryCardName ?? '').includes(query)
      card.hidden = !shown
      if (shown) matches += 1
    }
    const count = modal.querySelector('[data-library-search-count]')
    if (count) count.textContent = query ? `${matches} of ${cards.length} matching cards` : `${cards.length} cards`
  }

  document.addEventListener('input', (event) => {
    if (event.target.matches?.('[data-library-filter]')) filter(event.target)
  })
  document.addEventListener('search', (event) => {
    if (event.target.matches?.('[data-library-filter]')) filter(event.target)
  }, true)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !event.target.matches?.('[data-library-filter]')) return
    event.preventDefault()
    filter(event.target)
  })
}

function wireCopyButton() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-text]")
    if (!button) return

    await navigator.clipboard.writeText(button.dataset.copyText)
    const original = button.textContent
    button.textContent = "Copied"
    window.setTimeout(() => {
      button.textContent = original
    }, 1400)
  })
}



// ===== Graveyard / exile inspector: client-side search of visible cards =====
function wireZoneInspector(game) {
  const dialog = document.createElement("dialog")
  dialog.className = "zone-inspector"

  dialog.innerHTML = `
    <div class="zone-inspector-content">
      <div class="zone-inspector-header">
        <h2 data-zone-inspector-title></h2>
        <button
          type="button"
          data-zone-inspector-close
        >Close ✕</button>
      </div>

      <input
        type="search"
        class="zone-inspector-search"
        data-zone-inspector-search
        placeholder="Search cards by name..."
        aria-label="Filter cards by name"
      />

      <div
        class="zone-inspector-results"
        data-zone-inspector-results
      ></div>
    </div>
  `

  document.body.append(dialog)

  const title = dialog.querySelector(
    "[data-zone-inspector-title]"
  )
  const search = dialog.querySelector(
    "[data-zone-inspector-search]"
  )
  const results = dialog.querySelector(
    "[data-zone-inspector-results]"
  )
  const closeButton = dialog.querySelector(
    "[data-zone-inspector-close]"
  )

  let selectedPlayerId = null
  let selectedZone = null

  function getSource() {
    if (!selectedPlayerId || !selectedZone) return null

    const player = [...game.querySelectorAll(".player-section")]
      .find((element) =>
        element.dataset.playerId === selectedPlayerId
      )

    return player?.querySelector(
      `.zone-lane[data-zone="${selectedZone}"] .zone-source`
    ) ?? null
  }

  function renderResults() {
    const cards = [...(getSource()?.children ?? [])]
    const query = search.value.trim().toLowerCase()

    const matching = cards.filter((card) => {
      const name = card.dataset.previewName ?? ""
      return name.toLowerCase().includes(query)
    })

    const label =
      selectedZone === "graveyard" ? "Graveyard" : "Exile"

    title.textContent = query
      ? `${label} (${matching.length} of ${cards.length} matches)`
      : `${label} (${cards.length})`

    if (matching.length === 0) {
      const message = document.createElement("p")
      message.className = "zone-inspector-empty"
      message.textContent = query
        ? "No matching cards."
        : "This zone is empty."

      results.replaceChildren(message)
      return
    }

    results.replaceChildren(
      ...matching.map((card) => card.cloneNode(true))
    )
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-open-zone]")
    if (!trigger) return

    const player = trigger.closest(".player-section")
    if (!player) return

    const zone = trigger.dataset.openZone
    if (zone !== "graveyard" && zone !== "exile") return

    selectedPlayerId = player.dataset.playerId
    selectedZone = zone
    search.value = ""

    renderResults()
    dialog.showModal()
    search.focus()
  })

  search.addEventListener('input', renderResults)
  search.addEventListener('search', renderResults)
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      renderResults()
    }
  })

  closeButton.addEventListener("click", () => {
    dialog.close()
  })

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close()
      return
    }

    // Close after selecting one of your own cards.
    // The existing document-level game-action handler
    // still processes the card action.
    if (event.target.closest("[data-game-action]")) {
      dialog.close()
    }
  })

  // Refresh the displayed cards if multiplayer updates
  // change the underlying graveyard or exile.
  const observer = new MutationObserver(() => {
    if (dialog.open) renderResults()
  })

  observer.observe(game, {
    childList: true,
    subtree: true,
  })
}



// ===== Battlefield right-click menu (ordinary draggable permanents) =====
function wireCardTools(game) {
  let openCard = null

  function closeCardTools() {
    openCard?.classList.remove("card-tools-open")
    openCard = null
  }

  // Open the tools with right-click
  document.addEventListener("contextmenu", (event) => {
    const card = event.target.closest?.(".battlefield-card")

    // Only allow your own cards with available tools
    if (
      !card ||
      !belongsToCurrentPlayer(card, game) ||
      !card.querySelector(".card-tools .card-tool")
    ) {
      closeCardTools()
      return
    }

    // Prevent the normal browser context menu
    event.preventDefault()

    // Close any previously opened card tools
    closeCardTools()

    // Open tools on the selected card
    card.classList.add("card-tools-open")
    openCard = card
  })

  // Close when clicking outside the tools
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !openCard) return

    if (!event.target.closest?.(".card-tools")) {
      closeCardTools()
    }
  })

  // Close after using a card action
  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".card-tools [data-game-action]")) {
      closeCardTools()
    }
  })

  // Close with Escape
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCardTools()
    }
  })

  // Close if the battlefield is scrolled
  document.addEventListener("scroll", closeCardTools, true)
}


function wireLibraryPeek(game) {
  const dialog = document.createElement("dialog")
  dialog.className = "library-peek-dialog"

  dialog.innerHTML = `
    <div class="library-peek-content">
      <div class="library-peek-header">
        <h2>Peek at library</h2>
        <button type="button" data-peek-close>
          Close ✕
        </button>
      </div>

      <label class="library-peek-selector">
        Number of cards to inspect
        <input
          type="number"
          min="1"
          max="100"
          value="3"
          step="1"
          data-peek-count
        />
      </label>

      <p class="library-peek-info"></p>

      <div class="library-peek-results"></div>
    </div>
  `

  document.body.append(dialog)

  const countInput = dialog.querySelector(
    "[data-peek-count]"
  )

  const results = dialog.querySelector(
    ".library-peek-results"
  )

  const info = dialog.querySelector(
    ".library-peek-info"
  )

  function getLibraryCards() {
    const source = game.querySelector(
      '.player-section[data-current-player="true"] ' +
      '.library-peek-source'
    )

    return [...(source?.children ?? [])]
  }

  function renderPeek() {
    const cards = getLibraryCards()
    const total = cards.length

    countInput.max = String(Math.max(total, 1))

    if (total === 0) {
      info.textContent = "Your library is empty."
      results.replaceChildren()
      return
    }

    const requested = Number.parseInt(countInput.value, 10)

    const count = Math.min(
      Math.max(Number.isNaN(requested) ? 1 : requested, 1),
      total
    )

    info.textContent =
      `Showing the top ${count} of ${total} cards, in draw order.`

    results.replaceChildren(
      ...cards.slice(0, count).map((card) =>
        card.cloneNode(true)
      )
    )
  }

  document.addEventListener("library-peek-request", (event) => {
    const trigger = event.target.closest?.(
      ".library-zone-preview"
    )

    if (!trigger) return

    const player = trigger.closest(".player-section")

    if (player?.dataset.currentPlayer !== "true") {
      return
    }

    event.preventDefault()

    countInput.value = "3"
    renderPeek()

    if (!dialog.open) {
      dialog.showModal()
    }
  })

  countInput.addEventListener("input", renderPeek)

  dialog.querySelector("[data-peek-close]")
    .addEventListener("click", () => dialog.close())

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close()
    }
  })
}


function wireLibraryCardTools(game) {
  const menu = document.createElement("div")
  menu.className = "library-card-context"
  menu.hidden = true

  menu.innerHTML = `
    <div class="library-card-context-title"></div>

    <button type="button" data-library-move="hand">
      🖐️ Move to hand
    </button>

    <button type="button" data-library-move="battlefield">
      ⚔️ Move to battlefield
    </button>

    <button type="button" data-library-move="graveyard">
      🪦 Move to graveyard
    </button>

    <button type="button" data-library-move="exile">
      ✨ Move to exile
    </button>
  `

  document.body.appendChild(menu)

  let selectedInstanceId = null

  function closeMenu() {
    menu.hidden = true
    selectedInstanceId = null
  }

  document.addEventListener("contextmenu", (event) => {
    const card = event.target.closest?.(
      ".library-peek-card, .library-search-item"
    )

    if (!card) {
      closeMenu()
      return
    }

    const peekDialog = card.closest(".library-peek-dialog")
    const searchModal = card.closest(".library-search-modal-card")

    if (!peekDialog && !searchModal) return

    // Peek cards have their ID directly on the element.
    let instanceId = card.dataset.instanceId

    // Ordinary library search cards already contain
    // a moveLibraryCardToHand action with their ID.
    if (!instanceId && searchModal) {
      try {
        const action = JSON.parse(card.dataset.gameAction ?? "{}")

        if (action.type === "moveLibraryCardToHand") {
          instanceId = action.instanceId
        }
      } catch {
        return
      }
    }

    if (!instanceId) return

    event.preventDefault()

    selectedInstanceId = instanceId

    menu.querySelector(".library-card-context-title")
      .textContent = card.dataset.previewName ?? "Card actions"

    // Keep the menu inside native modal dialogs.
    // Otherwise it can remain in document.body.
    const host = peekDialog ?? document.body
    host.appendChild(menu)

    menu.hidden = false

    const width = menu.getBoundingClientRect().width
    const height = menu.getBoundingClientRect().height

    menu.style.left = `${
      Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))
    }px`

    menu.style.top = `${
      Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))
    }px`
  })

  menu.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-library-move]")

    if (!button || !selectedInstanceId) return

    event.preventDefault()
    event.stopPropagation()

    const destination = button.dataset.libraryMove
    const instanceId = selectedInstanceId
    const dialog = menu.closest("dialog")

    closeMenu()

    const action = {
      type: "moveCardZone",
      instanceId,
      from: "library",
      to: destination,
      ...(destination === "battlefield"
        ? { x: 48, y: 48 }
        : {})
    }

    const accepted = await sendAction(
      game.dataset.tableCode,
      action
    )

    // Close peek after a successful card move.
    if (accepted && dialog?.open) {
      dialog.close()
    }
  })

  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target)) {
      closeMenu()
    }
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu()
    }
  })
}


// ===== Stage 3: library menu and protected piles =====
// Library left-click draws. Right-click shows choices. This uses the existing
// action transport and does not expose an opponent's hidden library cards.
function wireLibraryControls(game, actorId) {
  const menu = document.createElement("div")
  menu.className = "stage3-library-menu"
  menu.hidden = true
  menu.innerHTML = `
    <strong>Library actions</strong>
    <button type="button" data-library-choice="peek">Look at top X</button>
    <button type="button" data-library-choice="search">Search library</button>
    <button type="button" data-library-choice="shuffle">Shuffle library</button>
  `
  document.body.append(menu)
  let activeLibrary = null

  function ownLibrary(target) {
    const pile = target.closest?.(".library-zone-preview")
    if (!pile) return null
    const seat = pile.closest(".player-section")
    return seat?.dataset.currentPlayer === "true" ? pile : null
  }

  function closeMenu() {
    menu.hidden = true
    activeLibrary = null
  }

  // Capture-phase interception prevents the old openDeckSearch button action.
  document.addEventListener("click", (event) => {
    const pile = ownLibrary(event.target)
    if (!pile) return
    event.preventDefault()
    event.stopImmediatePropagation()
    closeMenu()
    void sendAction(actorId, { type: "drawCard", count: 1 })
  }, true)

  // Capture-phase interception also prevents the old direct-peek right click.
  document.addEventListener("contextmenu", (event) => {
    const pile = ownLibrary(event.target)
    if (!pile) return
    event.preventDefault()
    event.stopImmediatePropagation()
    activeLibrary = pile
    menu.hidden = false
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`
  }, true)

  menu.addEventListener("click", (event) => {
    const choice = event.target.closest?.("[data-library-choice]")?.dataset.libraryChoice
    const pile = activeLibrary
    if (!choice || !pile) return
    closeMenu()

    if (choice === "peek") {
      // Reuse the existing private peek dialog; this does not reorder cards.
      pile.dispatchEvent(new CustomEvent("library-peek-request", { bubbles: true }))
    } else if (choice === "search") {
      void sendAction(actorId, { type: "openDeckSearch" })
    } else if (choice === "shuffle") {
      void sendAction(actorId, { type: "shuffleLibrary" })
    }
  })

  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target)) closeMenu()
  })
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu()
  })
  window.addEventListener("scroll", closeMenu, true)
}

// The piles float above the battlefield. Reject card drops whose visible
// rectangle intersects any of the three fixed piles, not just the library.
function cardOverlapsPile(card) {
  const pileRow = card.closest(".player-section")?.querySelector(".zone-lanes")
  if (!pileRow) return false
  const a = card.getBoundingClientRect()
  const b = pileRow.getBoundingClientRect()
  if (!a.width || !a.height || !b.width || !b.height) return false
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}


// ===== Stage 6: convert a physical mouse drop to the logical board =====
// Match the CSS travel distance. Reserve the right-hand piles on both seats.
// The server already clamps coordinates to 0..1200 and 0..700.
function tabletopLogicalPosition(card, position) {
  const canvas = card.closest('.battlefield-canvas')
  if (!canvas) return { x: position.left, y: position.top }

  const piles = card.closest('.player-section')?.querySelector('.zone-lanes')
  const pileWidth = piles?.getBoundingClientRect().width ?? 0
  const maxLeft = Math.max(0, canvas.clientWidth - card.offsetWidth - pileWidth - 16)
  const maxTop = Math.max(0, canvas.clientHeight - card.offsetHeight)
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  return {
    x: maxLeft ? Math.round(clamp(position.left / maxLeft, 0, 1) * 1200) : 0,
    y: maxTop ? Math.round(clamp(position.top / maxTop, 0, 1) * 700) : 0,
  }
}

// ===== Stage 7 + compact utility lane: stacked permanent actions =====
// Both lands and noncreature artifacts/enchantments use this same handler.
// The individual copies retain their original instanceIds in game state.
// Click a copy to tap/untap. Right-click a stack to select a particular
// copy for the original move/tap/counter actions. Fixed stacks do not drag.
function wireLandStackTap(actorId) {
  const menu = document.createElement('div')
  menu.className = 'stage7-land-menu'
  menu.hidden = true
  menu.innerHTML = `
    <strong class="stage7-land-menu-title">Permanent actions</strong>
    <label>Copy <select class="stage7-land-select"></select></label>
    <div class="stage09-land-zone-shortcuts" role="group" aria-label="Move selected copy to a zone">
      <button type="button" data-land-choice="hand" title="Move to hand" aria-label="Move to hand">🖐️</button>
      <button type="button" data-land-choice="library" title="Shuffle into library" aria-label="Shuffle into library">🔀</button>
      <button type="button" data-land-choice="graveyard" title="Move to graveyard" aria-label="Move to graveyard">🪦</button>
      <button type="button" data-land-choice="exile" title="Move to exile" aria-label="Move to exile">✨</button>
    </div>
    <button type="button" data-land-choice="tap">Tap / Untap</button>
    <button type="button" data-land-choice="counter">Add +1/+1 counter</button>
  `
  document.body.append(menu)
  const selected = menu.querySelector('.stage7-land-select')
  let menuOpen = false

  function closeMenu() {
    menu.hidden = true
    menuOpen = false
  }

  document.addEventListener('click', (event) => {
    if (menuOpen && !menu.contains(event.target)) closeMenu()
    const card = event.target.closest?.('.stage7-land-card')
    if (!card || event.target.closest('.card-tools, .counter-chip, button')) return
    if (card.closest('.player-section')?.dataset.currentPlayer !== 'true') return
    event.preventDefault()
    void sendAction(actorId, { type: 'toggleTap', instanceId: card.dataset.instanceId })
  })

  // Capture right-click before the generic battlefield tool handler.
  document.addEventListener('contextmenu', (event) => {
    const card = event.target.closest?.('.stage7-land-card')
    if (!card || card.closest('.player-section')?.dataset.currentPlayer !== 'true') return
    event.preventDefault()
    event.stopImmediatePropagation()
    const stack = card.closest('.stage7-land-stack')
    const copies = [...stack.querySelectorAll('.stage7-land-card')]
    selected.replaceChildren(...copies.map((copy, i) => {
      const state = copy.classList.contains('tapped') ? 'tapped' : 'untapped'
      return new Option(`Copy ${i + 1} (${state})`, copy.dataset.instanceId)
    }))
    selected.value = card.dataset.instanceId
    menu.querySelector('.stage7-land-menu-title').textContent = card.dataset.previewName ?? 'Permanent actions'
    menu.hidden = false
    menuOpen = true
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`
  }, true)

  menu.addEventListener('click', (event) => {
    const choice = event.target.closest?.('[data-land-choice]')?.dataset.landChoice
    if (!choice || !selected.value) return
    const instanceId = selected.value
    const action = choice === 'tap' ? { type: 'toggleTap', instanceId }
      : choice === 'library' ? { type: 'moveToDeck', instanceId, from: 'battlefield', position: 'shuffle' }
      : choice === 'counter' ? { type: 'addCounter', instanceId, x: 8, y: 8, label: '+1/+1' }
      : { type: 'moveCardZone', instanceId, from: 'battlefield', to: choice }
    closeMenu()
    void sendAction(actorId, action)
  })
  document.addEventListener('pointerdown', (event) => {
    if (menuOpen && !menu.contains(event.target) && !event.target.closest?.('.stage7-land-card')) closeMenu()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu()
  })
  window.addEventListener('scroll', closeMenu, true)
}

// Reject drops behind the floating land lane, just like Stage 3 does for piles.
function cardOverlapsLandZone(card) {
  const zone = card.closest('.player-section')?.querySelector('.compact-special-lanes, .stage7-land-zone')
  if (!zone) return false
  const a = card.getBoundingClientRect()
  const b = zone.getBoundingClientRect()
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

// ===== Stage 8A: persistent attachment selection =====
// This is manual tabletop assistance rather than MTG targeting validation.
// Only cards you control can be targets in this first version.
function wireStage8Attachments(actorId) {
  let sourceId = null
  let sourceSeat = null

  function clearSelection() {
    sourceId = null
    sourceSeat = null
    document.querySelectorAll('.stage8-attach-source, .stage8-attach-target')
      .forEach((card) => card.classList.remove('stage8-attach-source', 'stage8-attach-target'))
  }

  document.addEventListener('click', (event) => {
    const start = event.target.closest?.('[data-stage8-attach-start]')
    if (start) {
      event.preventDefault()
      event.stopImmediatePropagation()
      clearSelection()
      const card = start.closest('.battlefield-card')
      if (!card || card.closest('.player-section')?.dataset.currentPlayer !== 'true') return
      sourceId = card.dataset.instanceId
      sourceSeat = card.closest('.player-section')
      card.classList.add('stage8-attach-source')
      sourceSeat.querySelectorAll('.battlefield-canvas > .battlefield-card')
        .forEach((candidate) => {
          if (candidate.dataset.instanceId !== sourceId &&
              !candidate.classList.contains('stage8-attached')) {
            candidate.classList.add('stage8-attach-target')
          }
        })
      showToast('Choose a permanent on your battlefield to attach to (Esc cancels).')
      return
    }

    const detach = event.target.closest?.('[data-stage8-detach]')
    if (detach) {
      event.preventDefault()
      event.stopImmediatePropagation()
      const card = detach.closest('.battlefield-card')
      if (card?.dataset.instanceId) {
        void sendAction(actorId, {
          type: 'setAttachment', instanceId: card.dataset.instanceId, targetInstanceId: null,
        })
      }
      clearSelection()
      return
    }

    if (!sourceId) return
    const target = event.target.closest?.('.battlefield-canvas > .battlefield-card')
    if (!target || !sourceSeat?.contains(target) || target.dataset.instanceId === sourceId) {
      // Outside click exits select-target mode, but allows other controls to work.
      if (!event.target.closest?.('.card-tools')) clearSelection()
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (target.classList.contains('stage8-attached')) return
    const targetInstanceId = target.dataset.instanceId
    const instanceId = sourceId
    clearSelection()
    void sendAction(actorId, { type: 'setAttachment', instanceId, targetInstanceId })
  }, true)

  // Suppress the ordinary tap-on-pointerup behavior while a target is picked.
  document.addEventListener('pointerdown', (event) => {
    if (!sourceId) return
    const target = event.target.closest?.('.battlefield-canvas > .battlefield-card')
    if (target && sourceSeat?.contains(target) && !event.target.closest('button')) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)
  document.addEventListener('keydown', (event) => {
    if (sourceId && event.key === 'Escape') clearSelection()
  })
}


// ===== Stage 8C: detached floating card menu =====
// The card's real .card-tools element stays inside the card in the DOM,
// preserving Stage 8A's closest('.battlefield-card') action handling.
// A popover renders it in the browser top layer, away from overflow clipping.
function wireStage8cCardMenu() {
  let openTools = null

  function close() {
    if (openTools) {
      try { if (openTools.matches(':popover-open')) openTools.hidePopover() } catch {}
      openTools.closest('.battlefield-card')?.classList.remove('card-tools-open')
    }
    openTools = null
  }

  function isZoneAction(button) {
    try {
      const action = JSON.parse(button.dataset.gameAction ?? '{}')
      return action.type === 'moveCardZone' || action.type === 'moveToDeck'
    } catch { return false }
  }

  function readableLabel(button) {
    const actionLabel = button.getAttribute('aria-label') ||
      button.dataset.tooltip || button.getAttribute('title') || ''
    try {
      const action = JSON.parse(button.dataset.gameAction ?? '{}')
      if (action.type === 'moveCardZone') {
        return ({hand: 'Move to hand', graveyard: 'Move to graveyard',
          exile: 'Move to exile', battlefield: 'Move to battlefield'})[action.to] || actionLabel
      }
      if (action.type === 'moveToDeck') return 'Move to library'
      if (action.type === 'addCounter') return 'Add counter'
    } catch {}
    return actionLabel || button.textContent.trim()
  }

  function decorate(tools, card) {
    if (tools.dataset.stage8cDecorated === 'true') {
      const title = tools.querySelector(':scope > .stage8c-menu-title')
      if (title) title.textContent = card.dataset.previewName || 'Card actions'
      return
    }
    tools.dataset.stage8cDecorated = 'true'
    const title = document.createElement('div')
    title.className = 'stage8c-menu-title'
    title.textContent = card.dataset.previewName || 'Card actions'
    tools.prepend(title)

    // Keep each existing data-game-action intact; buttons now appear as a
    // one-tap icon row instead of a nested "Move to another zone" submenu.
    const zoneButtons = [...tools.children].filter(
      (el) => el.tagName === 'BUTTON' && isZoneAction(el)
    )
    for (const button of tools.querySelectorAll(':scope > button')) {
      if (isZoneAction(button) || button.querySelector('.stage8c-menu-label')) continue
      const label = document.createElement('span')
      label.className = 'stage8c-menu-label'
      label.textContent = readableLabel(button)
      button.append(label)
    }
    if (zoneButtons.length) {
      const row = document.createElement('div')
      row.className = 'stage09-zone-shortcuts'
      row.setAttribute('role', 'group')
      row.setAttribute('aria-label', 'Move to hand, library, graveyard or exile')
      for (const button of zoneButtons) {
        // The buttons already have an aria-label. Add a native tooltip too.
        button.title = readableLabel(button)
        row.append(button)
      }
      title.after(row)
    }
  }

  // Capture before the existing contextmenu listener. A zero-delay task
  // runs after bubbling (microtasks can fire between event listeners).
  document.addEventListener('contextmenu', (event) => {
    const card = event.target.closest?.('.your-seat .battlefield-card')
    if (!card) { window.setTimeout(close, 0); return }
    const x = event.clientX
    const y = event.clientY
    window.setTimeout(() => {
      if (!card.isConnected || !card.classList.contains('card-tools-open')) {
        close()
        return
      }
      const tools = card.querySelector(':scope > .card-tools')
      if (!tools) return
      if (openTools && openTools !== tools) close()
      decorate(tools, card)
      tools.setAttribute('popover', 'manual')
      try {
        if (!tools.matches(':popover-open')) tools.showPopover()
      } catch {
        // Old browser fallback: existing inline right-click tools still work.
        return
      }
      openTools = tools
      // Constrain all edges; avoid a large menu going off the right/bottom.
      const rect = tools.getBoundingClientRect()
      tools.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`
      tools.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`
    }, 0)
  }, true)

  // Register this handler before Stage 8A, which stops propagation when
  // Attach/Unlink is clicked. Defer hiding until existing actions have run.
  document.addEventListener('click', (event) => {
    if (!openTools) return
    if (openTools.contains(event.target)) {
      if (event.target.closest('button')) queueMicrotask(close)
      return
    }
    queueMicrotask(close)
  }, true)
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 2 && openTools && !openTools.contains(event.target)) close()
  }, true)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  }, true)
}


// ===== Stage 8B: drag-and-hold to attach =====
// The server-side setAttachment action from Stage 8A remains authoritative.
// Hover over another one of your cards for 550ms, then release to attach.
// Shift-drag is the fallback for cards imported before isAttachment metadata.
const STAGE8B_HOLD_MS = 550
let stage8bHover = null

function stage8bReset() {
  if (stage8bHover?.timer) clearTimeout(stage8bHover.timer)
  stage8bHover?.target?.classList.remove('stage8b-attach-hover', 'stage8b-attach-ready')
  stage8bHover?.source?.classList.remove('stage8b-attachment-drag')
  stage8bHover = null
}

function stage8bTargetUnderPointer(source, event) {
  if (!source?.isConnected) return null
  const own = source.closest('.player-section')
  if (!own || own.dataset.currentPlayer !== 'true') return null
  const old = source.style.pointerEvents
  // Pointer capture and high z-index otherwise hide the potential target.
  source.style.pointerEvents = 'none'
  let candidate
  try {
    candidate = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest?.('.battlefield-canvas > .battlefield-card')
  } finally {
    source.style.pointerEvents = old
  }
  if (!candidate || !own.contains(candidate) || candidate === source) return null
  if (candidate.classList.contains('stage7-land-card') ||
      candidate.classList.contains('stage8-attached')) return null
  if (candidate.dataset.instanceId === source.dataset.instanceId) return null
  return candidate
}

function stage8bMove(event) {
  if (!drag || drag.kind !== 'card' || !drag.moved || !drag.element) {
    stage8bReset()
    return
  }
  const source = drag.element
  const allowed = (source.dataset.stage8bAttachable === 'true' || drag.stage8bManual) &&
    !source.classList.contains('stage7-land-card') &&
    !source.classList.contains('stage8-attachment-host')
  if (!allowed) {
    stage8bReset()
    return
  }
  source.classList.add('stage8b-attachment-drag')
  const target = stage8bTargetUnderPointer(source, event)
  if (!target) {
    if (stage8bHover) {
      if (stage8bHover.timer) clearTimeout(stage8bHover.timer)
      stage8bHover.target?.classList.remove('stage8b-attach-hover', 'stage8b-attach-ready')
    }
    stage8bHover = { source, target: null, timer: null, ready: false }
    return
  }
  if (stage8bHover?.source === source && stage8bHover.target === target) return
  stage8bReset()
  source.classList.add('stage8b-attachment-drag')
  const hover = { source, target, timer: null, ready: false }
  stage8bHover = hover
  target.classList.add('stage8b-attach-hover')
  hover.timer = setTimeout(() => {
    if (stage8bHover !== hover || !target.isConnected) return
    hover.ready = true
    hover.timer = null
    target.classList.add('stage8b-attach-ready')
  }, STAGE8B_HOLD_MS)
}

function stage8bDrop(current, event, actorId) {
  const hover = stage8bHover
  if (current.kind !== 'card') {
    stage8bReset()
    return false
  }
  const destination = hover?.ready && hover.source === current.element
    ? stage8bTargetUnderPointer(current.element, event)
    : null
  const acceptedTarget = destination && destination === hover.target
    ? destination.dataset.instanceId : null
  stage8bReset()
  if (!current.moved || !acceptedTarget || !current.instanceId) return false
  // Restore the dragged DOM position until the server refreshes the page.
  // Dropping an Aura/Equipment is an attach action, NOT a position change.
  current.element.style.left = current.stage8bStartLeft
  current.element.style.top = current.stage8bStartTop
  void sendAction(actorId, {
    type: 'setAttachment',
    instanceId: current.instanceId,
    targetInstanceId: acceptedTarget,
  })
  return true
}


// ===== Stage 9: London mulligan interaction =====
// We post these multi-card transitions directly to the actor, rather than
// assuming the optional browser-side optimistic mirror knows the new actions.
function wireStage9Mulligan(actorId) {
  document.addEventListener('click', async (event) => {
    const clicked = event.target.closest?.('[data-stage9-start], [data-stage9-redraw], [data-stage9-keep], [data-stage9-finish], [data-stage9-card-id]')
    if (!clicked) return
    const panel = clicked.closest('[data-stage9-panel]')
    if (!panel) return
    event.preventDefault()
    event.stopPropagation()

    if (clicked.hasAttribute('data-stage9-card-id')) {
      const selected = panel._stage9Selected ?? (panel._stage9Selected = [])
      const id = clicked.dataset.stage9CardId
      const position = selected.indexOf(id)
      if (position === -1) selected.push(id)
      else selected.splice(position, 1)
      const required = Number(panel.dataset.stage9Required)
      panel.querySelectorAll('[data-stage9-card-id]').forEach((card) => {
        const index = selected.indexOf(card.dataset.stage9CardId)
        card.classList.toggle('stage9-selected', index !== -1)
        card.setAttribute('aria-pressed', index !== -1 ? 'true' : 'false')
        card.dataset.stage9Order = index === -1 ? '' : String(index + 1)
      })
      const counter = panel.querySelector('[data-stage9-counter]')
      if (counter) counter.textContent = `Selected ${selected.length} / ${required}`
      const finish = panel.querySelector('[data-stage9-finish]')
      if (finish) finish.disabled = selected.length !== required
      return
    }

    let action = null
    if (clicked.hasAttribute('data-stage9-start')) {
      action = { type: 'beginOpeningHand', format: panel.querySelector('[data-stage9-format]')?.value ?? 'commander' }
    } else if (clicked.hasAttribute('data-stage9-redraw')) {
      action = { type: 'redrawOpeningHand' }
    } else if (clicked.hasAttribute('data-stage9-keep')) {
      action = { type: 'keepOpeningHand' }
    } else if (clicked.hasAttribute('data-stage9-finish')) {
      const instanceIds = panel._stage9Selected ?? []
      if (instanceIds.length !== Number(panel.dataset.stage9Required)) return
      action = { type: 'finishOpeningHand', instanceIds }
    }
    if (!action || clicked.disabled) return
    clicked.disabled = true
    try {
      await postAction(actorId, action, newGestureKey())
    } finally {
      if (clicked.isConnected) clicked.disabled = false
    }
  })
}


// ===== Stage 10A: Commander zone client controls =====
// New actions go directly to the server, bypassing the optional offline
// move mirror until it knows how to reconcile command-zone transitions.
function wireStage10Commander(actorId) {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-stage10-designate], [data-stage10-play], [data-stage10-return], [data-stage10-reselect]')
    if (!button) return
    const zone = button.closest('.your-seat [data-stage10-zone]')
    if (!zone || button.disabled) return
    event.preventDefault()
    event.stopPropagation()
    let action = null
    if (button.hasAttribute('data-stage10-designate')) {
      const instanceId = zone.querySelector('[data-stage10-selection]')?.value
      if (!instanceId) return
      action = { type: 'stage10DesignateCommander', instanceId }
    } else if (button.hasAttribute('data-stage10-reselect')) {
      const instanceId = zone.querySelector('[data-stage10-reselection]')?.value
      if (!instanceId) return
      action = { type: 'stage10ReselectCommander', instanceId }
    } else if (button.hasAttribute('data-stage10-play')) {
      action = { type: 'stage10PlayCommander' }
    } else if (button.hasAttribute('data-stage10-return')) {
      action = { type: 'stage10ReturnCommander' }
    }
    if (!action) return
    button.disabled = true
    try {
      await postAction(actorId, action, newGestureKey())
    } finally {
      if (button.isConnected) button.disabled = false
    }
  })
}

// ===== Stage 11E: resize after every three additional nonland permanents =====
// First 6 independent permanents stay large; after that reserve space for
// another group of three: 7-9, 10-12, 13-15, etc. Attached cards and the
// separate land lane do not count as independent board slots.
function wireStage11FourCardTiers(gameRoot) {
  const root = document.documentElement
  const previous = { you: null, opponent: null }
  const observedCanvases = { you: null, opponent: null }
  let scheduled = false
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(schedule)
    : null

  function tierFor(count) {
    return count <= 6 ? 0 : Math.ceil((count - 6) / 3)
  }

  // At 7-9 cards, retain the prior 10-slot shrink; 10-12 cards use 14 slots.
  // Cards are NOT automatically rearranged: this is the space they COULD use.
  function targetSlots(tier) {
    return tier === 0 ? 6 : 6 + 4 * tier
  }

  function widthFor(canvas, seat, tier) {
    // Keep the original Stage 11C large-card limit, including viewport height.
    const largeLimit = Math.max(72, Math.min(
      window.innerWidth * 0.12,
      window.innerHeight * 0.21,
      176
    ))
    if (tier === 0) return Math.round(largeLimit)

    // Match Stage 6's drag boundary: canvas width minus actual piles and 16px.
    const piles = seat.querySelector('.zone-lanes')
    const pileWidth = piles?.getBoundingClientRect().width ?? 0
    const usableWidth = Math.max(0, canvas.clientWidth - pileWidth - 16)
    const slots = targetSlots(tier)
    const gap = 4 // modest separation between adjacent card images
    const fitWidth = Math.floor((usableWidth - (slots - 1) * gap) / slots)

    // Protect readability on very narrow boards. Beyond this limit, a single
    // horizontal row cannot hold every card; players can use multiple rows.
    return Math.round(Math.max(44, Math.min(largeLimit, fitWidth)))
  }

  function update() {
    const locations = [
      ['you', '#players-area .your-seat', 'Your'],
      ['opponent', '#players-area .opponent-seat', 'Opponent']
    ]
    for (const [key, seatSelector, label] of locations) {
      const seat = gameRoot.querySelector(seatSelector)
      const canvas = seat?.querySelector('.battlefield-canvas')
      if (!canvas) continue

      if (resizeObserver && observedCanvases[key] !== canvas) {
        if (observedCanvases[key]) resizeObserver.unobserve(observedCanvases[key])
        resizeObserver.observe(canvas)
        observedCanvases[key] = canvas
      }

      const count = canvas.querySelectorAll(
        ':scope > .battlefield-card:not(.stage7-land-card):not(.stage8-attached)'
      ).length

      // During partial DOM replacement the canvas can briefly be empty.
      // Keep the existing size on the persistent root until cards reappear.
      if (count === 0 && previous[key] !== null) continue

      const tier = tierFor(count)
      const width = widthFor(canvas, seat, tier)
      if (!previous[key] || previous[key].tier !== tier || previous[key].width !== width) {
        previous[key] = { tier, width }
        // The root survives Turbo player-section replacements, preventing
        // the old momentary resize when drawing from the library.
        root.style.setProperty(`--stage11c-${key}-width`, `${width}px`)
        root.dataset[`stage11d${label}Tier`] = String(tier)
        root.dataset[`stage11c${label}Tier`] = String(tier)
      }
    }
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      update()
    })
  }

  update()
  // Observe additions/removals, not attribute or style changes.
  new MutationObserver(schedule).observe(gameRoot, { childList: true, subtree: true })
  window.addEventListener('resize', schedule)
}

const stage11dGame = document.querySelector('[data-game]')
if (stage11dGame) wireStage11FourCardTiers(stage11dGame)
