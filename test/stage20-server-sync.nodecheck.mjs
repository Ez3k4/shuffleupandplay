/**
 * Stage 20: prefer the authoritative server for online multiplayer.
 * Run: node --test test/stage20-server-sync.nodecheck.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../public/shuffle.js', import.meta.url), 'utf8')
const actionSource = source.slice(
  source.indexOf('async function postAction('),
  source.indexOf('\nfunction newGestureKey()', source.indexOf('async function postAction(')),
)

function makePostAction(fetch) {
  const toasts = []
  const connections = []
  const action = runInNewContext(`(${actionSource})`, {
    fetch,
    showToast: (message) => toasts.push(message),
    setConnectionState: (value) => connections.push(value),
    JSON,
  })
  return { action, toasts, connections }
}

test('online mode is the default; the persistent worker is only explicitly opted in', () => {
  assert.match(source, /const USE_LOCAL_MOVE_QUEUE = new URLSearchParams\(window\.location\.search\)\.get\("localMirror"\) === "1"/)
  assert.match(source, /if \(USE_LOCAL_MOVE_QUEUE\) \{\s*void startMirror\(/)
  assert.match(source, /else \{\s*\/\/ No browser SQLite, worker, or speculative edits/)
})

test('socket opening does not stop recovery polling in online mode', () => {
  assert.match(source, /if \(USE_LOCAL_MOVE_QUEUE\) fallback\.stop\(\)\s*else fallback\.startLater\(\)/)
  assert.match(source, /fallback\.observe\(envelope\)/)
  assert.match(source, /registry\.invalidate\(envelope\)/)
})

test('HTTP actions retain idempotency keys and are acknowledged before returning success', async () => {
  const sent = []
  const { action } = makePostAction(async (...args) => {
    sent.push(args)
    return { ok: true }
  })
  assert.equal(await action('ABCD', { type: 'changeLife', delta: -1 }, 'gesture-123'), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], '/api/tables/ABCD/actions')
  assert.equal(sent[0][1].headers['idempotency-key'], 'gesture-123')
  assert.deepEqual(JSON.parse(sent[0][1].body), { action: { type: 'changeLife', delta: -1 } })
})

test('rejected and disconnected HTTP actions do not claim success or silently re-send', async () => {
  const denied = makePostAction(async () => ({ ok: false, status: 403 }))
  assert.equal(await denied.action('ABCD', {}, 'gesture-123'), false)
  assert.equal(denied.toasts.length, 1)

  let attempts = 0
  const offline = makePostAction(async () => {
    attempts++
    throw new Error('disconnected')
  })
  assert.equal(await offline.action('ABCD', {}, 'gesture-123'), false)
  assert.equal(attempts, 1)
  assert.equal(offline.connections[0], 'reconnecting')
  assert.match(offline.toasts[0], /check the table/i)
})
