import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Point DSH_HOME at a scratch dir BEFORE importing config (it reads env lazily per call).
const home = mkdtempSync(join(tmpdir(), 'dsh-weread-test-'))
process.env.DSH_HOME = home

const { configPath, getAuthStatus, maskKey, readConfig, setApiKey, writeConfig } = await import(
  '../lib/host/config.js'
)

test('readConfig returns empty default when absent', () => {
  assert.deepEqual(readConfig(), { apiKey: '' })
  assert.equal(getAuthStatus().state, 'unset')
})

test('setApiKey persists, masks, and sets mode 600', () => {
  const status = setApiKey('wrk-abcdef1234')
  assert.equal(status.state, 'unknown')
  assert.equal(status.masked, 'wrk-****1234')
  assert.ok(existsSync(configPath()))
  const onDisk = JSON.parse(readFileSync(configPath(), 'utf8'))
  assert.equal(onDisk.apiKey, 'wrk-abcdef1234')
  // owner-only permissions
  assert.equal(statSync(configPath()).mode & 0o777, 0o600)
})

test('setApiKey("") clears the key', () => {
  setApiKey('wrk-x')
  const cleared = setApiKey('')
  assert.equal(cleared.state, 'unset')
  assert.equal(readConfig().apiKey, '')
})

test('maskKey keeps only the last 4 chars', () => {
  assert.equal(maskKey('wrk-1234567890'), 'wrk-****7890')
  assert.equal(maskKey(''), '')
})

test('writeConfig round-trips proxy and ai overrides', () => {
  writeConfig({ apiKey: 'k', proxy: 'http://127.0.0.1:7899', aiProvider: 'magpie', aiModel: 'm' })
  assert.deepEqual(readConfig(), {
    apiKey: 'k',
    proxy: 'http://127.0.0.1:7899',
    aiProvider: 'magpie',
    aiModel: 'm',
  })
})
