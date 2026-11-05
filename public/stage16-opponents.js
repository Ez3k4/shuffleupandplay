/** Stage 16 — only one opponent board is displayed, but all seats remain live. */
export function mountStage16OpponentSelector(game) {
  const area = game?.querySelector('#players-area')
  if (!area) return () => {}
  const roster = area.querySelector('#component-opponentRoster')
  if (!roster) return () => {}
  let selectedSeat = null
  let scheduled = false

  function sync() {
    const choices = [...roster.querySelectorAll('[data-stage16-select-seat]')]
    const seats = choices.map((choice) => choice.dataset.stage16SelectSeat)
    if (!seats.includes(selectedSeat)) selectedSeat = seats[0] ?? null

    for (const panel of area.querySelectorAll('[data-stage16-opponent-panel]')) {
      panel.hidden = !selectedSeat || panel.dataset.stage16OpponentPanel !== selectedSeat
    }
    for (const choice of choices) {
      const active = choice.dataset.stage16SelectSeat === selectedSeat
      choice.classList.toggle('stage16-active', active)
      choice.setAttribute('aria-pressed', String(active))
    }
  }

  function onClick(event) {
    const button = event.target.closest?.('[data-stage16-select-seat]')
    if (!button || !roster.contains(button)) return
    selectedSeat = button.dataset.stage16SelectSeat
    sync()
    // Battlefield resize logic recalculates for the newly visible opponent.
    window.dispatchEvent(new Event('resize'))
  }

  const observer = new MutationObserver((mutations) => {
    // Ignore unrelated battlefield activity (drag, tap, counters, wallpapers).
    if (!mutations.some((mutation) => roster === mutation.target || roster.contains(mutation.target))) return
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; sync() })
  })
  roster.addEventListener('click', onClick)
  observer.observe(roster, { subtree: true, childList: true, characterData: true })
  sync()
  return () => { observer.disconnect(); roster.removeEventListener('click', onClick) }
}
