import {
  SolidObjectsBrowserClient,
  SolidObjectsComponentRegistry,
} from "/vendor/live/browser/index.js"
import { renderComponent } from "/shared/server/render/components.ts"
import { cardPoint, dragOffset, dragPosition, rotationFromTransform } from "./drag-math.js"
import { morph } from "./morph.js"

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
  wireDeckForms(game, actorId)
  wireCardPreview()
  wireLibraryFilter()
  wireZoneInspector(game)
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

function beginDrag(event, game) {
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

  if (cardOverlapsPile(current.element)) {
    current.element.style.left = `${current.startLeft}px`
    current.element.style.top = `${current.startTop}px`
    showToast("Move cancelled: card piles occupy this area.")
    return
  }
  void sendAction(actorId, {
    type: "moveBattlefieldCard",
    instanceId: current.instanceId,
    x: position.left,
    y: position.top,
  })
}

function cancelDrag() {
  drag?.element?.classList.remove("is-dragging")
  removeCounterGhost()
  drag = null
}

function belongsToCurrentPlayer(card, game) {
  return card.closest(".player-section")?.dataset.currentPlayer === "true" && Boolean(game)
}

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


function wireLibraryFilter() {
  document.addEventListener("input", (event) => {
    if (!event.target.matches("[data-library-filter]")) return

    const query = event.target.value.trim().toLowerCase()
    for (const card of document.querySelectorAll("[data-library-card-name]")) {
      card.hidden = !card.dataset.libraryCardName.includes(query)
    }
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

    title.textContent = `${label} (${cards.length})`

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

  search.addEventListener("input", renderResults)

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

    // Right-clicking the same card closes the menu
    if (openCard === card) {
      closeCardTools()
      return
    }

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
