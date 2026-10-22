import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { GROUPS, LABS, LESSON_LABS, labAt, labLesson } from './index.ts'

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

test('labs run in course order: groups as listed, Foundations first', () => {
  assert.equal(GROUPS[0], 'Foundations')
  const order = LABS.map((l) => GROUPS.indexOf(l.group))
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
})

test('every lab goes with the first lesson that lists it', () => {
  for (const l of LABS) assert.ok(labLesson(l.id) != null, l.id)
  assert.equal(labLesson('core-xray'), 2)
  assert.equal(labLesson('packets'), 13)
  assert.equal(labLesson('nope'), null)
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
