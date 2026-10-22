import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Detail.tsx is JSX, which the test runner cannot load, so this reads its source. Every text size is either a named
// size (LABEL, VALUE, f for u * LABEL or v for u * VALUE) or u times a factor at least LABEL (1.25).
test('close-up labels are never drawn smaller than the label size', () => {
  const src = readFileSync(new URL('./Detail.tsx', import.meta.url), 'utf8')
  assert.ok(!/textUnit\('/.test(src), 'sizes go through unit(), which corrects for the zoom cap')
  for (const m of src.matchAll(/const f = (.+)/g)) assert.equal(m[1].trim(), 'u * LABEL')
  for (const m of src.matchAll(/const v = (.+)/g)) assert.equal(m[1].trim(), 'u * VALUE')
  const sizes = [...src.matchAll(/\ss=\{([^}]+)\}/g)].map((m) => m[1].trim())
  assert.ok(sizes.length > 40)
  for (const s of sizes) {
    if (s === 'f' || s === 'v' || s === 's' || s === 'u * LABEL' || s === 'u * VALUE') continue
    const k = /^u \* ([\d.]+)$/.exec(s)
    assert.ok(k && Number(k[1]) >= 1.25, `text size ${s} is below the label size`)
  }
})
