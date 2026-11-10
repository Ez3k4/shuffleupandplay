/* Stage 28B: optional browser adapter for the isolated engine. No manual-card actions. */
const POLL_INTERVAL_MS = 2500

export function engineUiModel(view, viewerId, seat) {
  if (!view || view.status !== "active") {
    return {
      active: false,
      canStart: seat === 1,
      canPass: false,
      canDraw: false,
      caption: "Not started",
      message: seat === 1 ? "Load both players' decks, then start the engine test." : "Waiting for the host to start the engine test.",
      turn: "—", step: "—", activePlayer: "—", priority: "—", stack: "—", cards: "—",
    }
  }
  const label = (id) => id === viewerId ? "You" : "Opponent"
  const link = view.bridge
  const linkText = !link ? "Not linked (older session)" :
    link.status === "synced" ? `${link.linkedCardCount} cards linked` : "Out of sync — manual cards changed"
  return {
    active: true,
    canStart: false,
    canPass: view.priorityPlayerId === viewerId,
    canDraw: view.priorityPlayerId === viewerId && Number.isSafeInteger(view.roomVersion) && link?.status === "synced" &&
      (view.zones?.hiddenZones?.find((zone) => zone.playerId === viewerId && zone.zone === "library")?.count ?? 0) > 0,
    caption: `Turn ${view.turnNumber}`,
    message: link?.status === "out_of_sync" ?
      "Manual cards have changed since the engine started. This prototype will not synchronize them automatically." :
      (view.priorityPlayerId === viewerId ? "You have priority." : "Waiting for your opponent to pass priority."),
    turn: String(view.turnNumber),
    step: view.step.replaceAll("_", " "),
    activePlayer: label(view.activePlayerId),
    priority: label(view.priorityPlayerId),
    stack: String(view.stack.length),
    cards: linkText,
  }
}

function mountEnginePanel() {
  const panel = document.querySelector("[data-stage28b-engine]")
  const game = document.querySelector("[data-game]")
  if (!panel || !game) return

  const code = game.dataset.tableCode
  const viewerId = game.dataset.currentPlayerId
  const seat = Number(game.dataset.seat)
  const find = (name) => panel.querySelector(`[data-engine-${name}]`)
  const start = find("start")
  const pass = find("pass")
  const draw = find("draw")
  const refreshButton = find("refresh")
  const error = find("error")
  const message = find("message")
  let pending = false
  let fetching = false
  let generation = 0
  let lastView = { status: "inactive" }

  function render(view) {
    lastView = view
    const model = engineUiModel(view, viewerId, seat)
    find("caption").textContent = model.caption
    message.textContent = model.message
    start.hidden = !model.canStart
    pass.hidden = !model.active
    draw.hidden = !model.active
    start.disabled = pending
    pass.disabled = pending || !model.canPass
    draw.disabled = pending || !model.canDraw
    refreshButton.disabled = pending
    find("details").hidden = !model.active
    for (const name of ["turn", "step", "active", "priority", "stack", "cards"]) {
      const key = name === "active" ? "activePlayer" : name
      find(name).textContent = model[key]
    }
  }

  function setError(value) {
    error.textContent = value
    error.hidden = !value
  }

  async function json(endpoint, method = "GET", deduplicationKey = null, expectedRoomVersion = null) {
    const response = await fetch(`/api/tables/${encodeURIComponent(code)}/engine${endpoint}`, {
      method,
      credentials: "same-origin",
      headers: { accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}),
        ...(deduplicationKey ? { "idempotency-key": deduplicationKey } : {}) },
      ...(method === "POST" ? { body: endpoint === "/draw" ? JSON.stringify({ expectedRoomVersion }) : "{}" } : {}),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Server returned HTTP ${response.status}`)
    return data
  }

  async function refresh({ force = false } = {}) {
    if (pending || fetching || (!force && document.visibilityState === "hidden")) return
    fetching = true
    const expectedGeneration = generation
    try {
      const view = await json("")
      if (expectedGeneration !== generation) return
      render(view)
      setError("")
    } catch (cause) {
      if (expectedGeneration === generation) setError(`Engine connection: ${cause.message}`)
    } finally {
      fetching = false
    }
  }

  async function command(endpoint) {
    if (pending) return
    pending = true
    generation += 1 // Discard an older, possibly stale GET when this POST returns.
    setError("")
    render(lastView)
    try {
      // One unique key per button press. Repeated transport attempts with the
      // same key are handled once by the server-side actor runtime.
      const key = endpoint === "/draw" ? `stage28d-${crypto.randomUUID()}` : null
      const expectedRoomVersion = endpoint === "/draw" ? lastView.roomVersion : null
      render(await json(endpoint, "POST", key, expectedRoomVersion))
    } catch (cause) {
      setError(cause.message)
    } finally {
      pending = false
      render(lastView)
    }
  }

  start.addEventListener("click", () => void command("/start"))
  pass.addEventListener("click", () => void command("/priority"))
  draw.addEventListener("click", () => void command("/draw"))
  refreshButton.addEventListener("click", () => void refresh({ force: true }))
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh({ force: true })
  })
  // Simple independent polling for the first browser milestone. Later we can
  // subscribe to engine-specific invalidations instead of polling.
  const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true })
  void refresh({ force: true })
}

if (typeof document !== "undefined") mountEnginePanel()
