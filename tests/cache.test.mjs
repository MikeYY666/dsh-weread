import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCache } from '../lib/host/store/cache.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

for (const invalidate of ['invalidate', 'invalidatePrefix', 'clear']) {
  test(`cache ${invalidate} prevents an older in-flight request from replacing new data`, async () => {
    const cache = createCache()
    const pending = deferred()
    const old = cache.get('weread:notes', 60_000, () => pending.promise)
    cache[invalidate]('weread:notes')
    assert.equal(await cache.get('weread:notes', 60_000, async () => 'new account'), 'new account')
    pending.resolve('old account')
    assert.equal(await old, 'old account')
    assert.equal(await cache.get('weread:notes', 60_000, async () => 'unexpected'), 'new account')
  })
}

test('concurrent cache readers share a single producer', async () => {
  const cache = createCache()
  const pending = deferred()
  let calls = 0
  const produce = () => { calls += 1; return pending.promise }
  const first = cache.get('same', 60_000, produce)
  const second = cache.get('same', 60_000, produce)
  pending.resolve('value')
  assert.deepEqual(await Promise.all([first, second]), ['value', 'value'])
  assert.equal(calls, 1)
})
