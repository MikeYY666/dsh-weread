import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** The repo-root files are the two places a version lives; they must agree. */
const readRoot = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

test('VERSION matches package.json version', () => {
  const version = readRoot('VERSION').trim()
  const { version: declared } = JSON.parse(readRoot('package.json'))
  assert.equal(version, declared)
})

test('VERSION is a plain semver string', () => {
  const version = readRoot('VERSION').trim()
  assert.match(version, /^\d+\.\d+\.\d+$/)
})

test('CHANGELOG documents the current version', () => {
  const version = readRoot('VERSION').trim()
  const changelog = readRoot('CHANGELOG.md')
  assert.ok(
    changelog.includes(`## [${version}]`),
    `CHANGELOG.md is missing a "## [${version}]" section`,
  )
})
