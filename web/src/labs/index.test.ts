import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { GROUPS, LABS, LESSON_LABS, labAt } from './index.ts'

test('every lab has a unique id, a known group and text in both modes', () => {
  assert.equal(new Set(LABS.map((l) => l.id)).size, LABS.length)
  for (const l of LABS) {
    assert.ok(GROUPS.includes(l.group), l.id)
    assert.ok(l.title && l.plain && l.blurb && l.plainBlurb, l.id)
    assert.match(l.id, /^[a-z0-9-]+$/)
  }
})

test('every lesson link points at a real lab', () => {
  const ids = new Set(LABS.map((l) => l.id))
  for (const [n, list] of Object.entries(LESSON_LABS)) for (const id of list) assert.ok(ids.has(id), `lesson ${n}: ${id}`)
})

test('labAt reads #labs/<id> and nothing else', () => {
  assert.equal(labAt('#labs/virtual-memory')?.id, 'virtual-memory')
  assert.equal(labAt('labs/virtual-memory')?.id, 'virtual-memory')
  assert.equal(labAt('#labs'), null)
  assert.equal(labAt('#labs/'), null)
  assert.equal(labAt('#labs/nope'), null)
  assert.equal(labAt('#learn/08'), null)
})

test('the registry and the lab files agree', () => {
  const files = readdirSync(new URL('.', import.meta.url)).filter((f) => /^[A-Z]\w+\.tsx$/.test(f))
  assert.equal(files.length, LABS.length, files.join(', '))
})

test('no em or en dashes or curly quotes in lab text', () => {
  for (const l of LABS) for (const t of [l.title, l.plain, l.blurb, l.plainBlurb]) assert.doesNotMatch(t, /[–—‘’“”]/, l.id)
})
