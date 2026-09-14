import test from 'node:test'
import assert from 'node:assert/strict'
import init from 'sql.js'
import { SessionStore } from '../dist/auth/session-store.js'

const SQL = await init()
function setup(t) {
  const database = new SQL.Database()
  database.run('CREATE TABLE sessions (id TEXT PRIMARY KEY,user_id TEXT,created_at TEXT,expires_at TEXT,last_activity_at TEXT,trusted_family_id TEXT)')
  const store = new SessionStore(database); store.initialize(); t.after(() => database.close())
  return { store, database }
}
test('repeated authenticated login replaces same browser and revokes old sessions', t => {
  const { store } = setup(t)
  const first = store.createTrustedDevice('alice', 'Macintosh', 'browser-one')
  const session = store.createSession('alice', undefined, store.trustedFamilyId(first))
  let current = first
  for (let i = 0; i < 20; i++) current = store.createTrustedDevice('alice', 'Macintosh', 'browser-one', current)
  assert.equal(store.listTrustedDevices('alice', current).length, 1)
  assert.equal(store.listTrustedDevices('alice', current)[0].current, true)
  assert.equal(store.touchSession(session), false)
  assert.equal(store.rotateTrustedDevice(first).status, 'revoked')
})
test('same user agent never merges separate browsers or different users', t => {
  const { store } = setup(t)
  store.createTrustedDevice('alice', 'Macintosh', 'browser-one')
  const second = store.createTrustedDevice('alice', 'Macintosh', 'browser-two')
  store.createTrustedDevice('bob', 'Macintosh', 'browser-two', second)
  assert.equal(store.listTrustedDevices('alice', second).length, 2)
  assert.equal(store.listTrustedDevices('bob', '').length, 1)
})
test('rotation preserves registration time and identity without accumulating visible devices', t => {
  const { store } = setup(t)
  const original = store.createTrustedDevice('alice', 'Windows', 'browser-one')
  const created = store.listTrustedDevices('alice', original)[0].createdAt
  let current = original
  for (let i = 0; i < 8; i++) {
    const rotation = store.rotateTrustedDevice(current, 'Windows')
    assert.equal(rotation.status, 'ok'); current = rotation.trustedToken
    assert.equal(store.listTrustedDevices('alice', current).length, 1)
    assert.equal(store.listTrustedDevices('alice', current)[0].createdAt, created)
  }
  const next = store.createTrustedDevice('alice', 'Windows', 'browser-one')
  assert.equal(store.listTrustedDevices('alice', next).length, 1)
})
test('legacy current token is migrated without merging unknown historical devices', t => {
  const { store } = setup(t)
  const legacy = store.createTrustedDevice('alice', 'Windows')
  store.createTrustedDevice('alice', 'Windows')
  const current = store.createTrustedDevice('alice', 'Windows', 'browser-one', legacy)
  assert.equal(store.listTrustedDevices('alice', current).length, 2)
  assert.equal(store.listTrustedDevices('alice', current)[0].current, true)
})
test('replay protection and remote device revocation remain effective', t => {
  const { store } = setup(t)
  const first = store.createTrustedDevice('alice', 'Android', 'browser-one')
  const rotated = store.rotateTrustedDevice(first)
  assert.equal(store.rotateTrustedDevice(first).status, 'replayed')
  assert.equal(store.touchSession(rotated.sessionToken), false)
  const current = store.createTrustedDevice('alice', 'Android', 'browser-one')
  const other = store.createTrustedDevice('alice', 'Windows', 'browser-two')
  const otherId = store.listTrustedDevices('alice', current).find(d => !d.current).id
  assert.equal(store.revokeDeviceById('bob', otherId), false)
  assert.equal(store.revokeOtherDevices('alice', current), true)
  assert.equal(store.rotateTrustedDevice(other).status, 'revoked')
  assert.equal(store.listTrustedDevices('alice', current).length, 1)
})
