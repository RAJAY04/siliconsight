import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { frontMatter, inline, linkTarget, parse, plainText, sections, type Block } from './md.ts'
import { LESSON_TOPICS, buildCourse, coveredIn, glossary, lessonNo, nextLesson, quiz, readProgress } from './course.ts'
import { TOPICS } from './learn.ts'

test('inline: code spans hide markers, unclosed markers stay literal', () => {
  assert.deepEqual(inline('run `2**63 [x](y)` now'), [
    { t: 'text', v: 'run ' },
    { t: 'code', v: '2**63 [x](y)' },
    { t: 'text', v: ' now' },
  ])
  assert.deepEqual(inline('a ** b and `c'), [{ t: 'text', v: 'a ** b and `c' }])
  assert.deepEqual(inline('**bold `x`**'), [{ t: 'strong', c: [{ t: 'text', v: 'bold ' }, { t: 'code', v: 'x' }] }])
  assert.deepEqual(inline('[no link] (here)'), [{ t: 'text', v: '[no link] (here)' }])
  assert.deepEqual(inline('\\*\\*not bold\\*\\*'), [{ t: 'text', v: '**not bold**' }])
})

test('inline: links keep balanced parentheses and code in the label', () => {
  assert.deepEqual(inline('see [the `lab/` dir](https://x.org/a_(b)).'), [
    { t: 'text', v: 'see ' },
    { t: 'link', href: 'https://x.org/a_(b)', c: [{ t: 'text', v: 'the ' }, { t: 'code', v: 'lab/' }, { t: 'text', v: ' dir' }] },
    { t: 'text', v: '.' },
  ])
})

test('links: https only, lessons and course pages map inside the app, everything else is text', () => {
  assert.deepEqual(linkTarget('https://eclecticlight.co/x'), { kind: 'web', href: 'https://eclecticlight.co/x' })
  assert.deepEqual(linkTarget('02-cpu-cores.md'), { kind: 'lesson', n: 2 })
  assert.deepEqual(linkTarget('sources.md'), { kind: 'home' })
  for (const bad of ['http://x.org', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', '../how-it-works.md', 'lab/', '//evil.org', 'https://x.org/"onmouseover="a']) {
    assert.equal(linkTarget(bad), null, bad)
  }
})

const as = <T extends Block['t']>(b: Block, t: T) => {
  assert.equal(b.t, t)
  return b as Extract<Block, { t: T }>
}

test('blocks: headings, lists, fences, tables and quotes', () => {
  const b = parse(
    [
      '### Step one',
      'A paragraph',
      'over two lines.',
      '- one',
      '  continued',
      '- two',
      '',
      '3. third',
      '4. fourth',
      '',
      '```bash',
      'echo "<b>" | grep -v x',
      '',
      '## not a heading',
      '```',
      '| a | `b|c` |',
      '|---|:---:|',
      '| 1 |',
      '> quoted **bold**',
      '> - item',
    ].join('\n'),
  )
  assert.deepEqual(
    b.map((x) => x.t),
    ['h', 'p', 'ul', 'ol', 'code', 'table', 'quote'],
  )
  assert.equal(plainText(as(b[1], 'p').c), 'A paragraph over two lines.')
  assert.deepEqual(as(b[2], 'ul').items.map(plainText), ['one continued', 'two'])
  assert.equal(as(b[3], 'ol').start, 3)
  assert.deepEqual(b[4], { t: 'code', lang: 'bash', v: 'echo "<b>" | grep -v x\n\n## not a heading' })
  const table = as(b[5], 'table')
  assert.deepEqual(table.head.map(plainText), ['a', 'b|c'])
  // Short rows are padded to the header's width.
  assert.deepEqual(table.rows[0].map(plainText), ['1', ''])
  assert.deepEqual(as(b[6], 'quote').c.map((x) => x.t), ['p', 'ul'])
})

test('an unclosed fence runs to the end instead of swallowing nothing', () => {
  assert.deepEqual(parse('```\nline'), [{ t: 'code', lang: '', v: 'line' }])
})

test('front matter and sections ignore ## inside code', () => {
  const { data, body } = frontMatter('---\nid: 01-x\nminutes: 25\nlive: [a.b, c]\ntitle: "Quoted"\n---\n## One\ntext\n```\n## code\n```\n## Two\n')
  assert.deepEqual(data, { id: '01-x', minutes: '25', live: ['a.b', 'c'], title: 'Quoted' })
  assert.deepEqual(
    sections(body).map((s) => s.title),
    ['One', 'Two'],
  )
})

test('quiz pairs Q and A lines and drops a question with no answer', () => {
  const q = quiz('Q: First?\nA: Yes.\n\nQ: Long\nquestion?\nA: Answer `x`\nruns on.\n\nQ: Orphan?\n')
  assert.equal(q.length, 2)
  assert.equal(plainText(q[1].q), 'Long question?')
  assert.equal(plainText(q[1].a), 'Answer x runs on.')
})

test('glossary skips the intro and reads lesson references', () => {
  const g = glossary('# Glossary\n\nEvery term. The lesson is in brackets.\n\nAES engine. Encrypts data. [11]\n\nUser interactive, utility. QoS classes. [3, 8]\n\nBandwidth. See memory bandwidth.\n')
  assert.deepEqual(
    g.map((x) => [x.term, plainText(x.def), x.lessons]),
    [
      ['AES engine', 'Encrypts data.', [11]],
      ['User interactive, utility', 'QoS classes.', [3, 8]],
      ['Bandwidth', 'See memory bandwidth.', []],
    ],
  )
})

test('progress survives junk in storage, and Continue picks a sensible lesson', () => {
  assert.deepEqual(readProgress('not json'), { done: [], quiz: {}, last: null })
  assert.deepEqual(readProgress('{"done":[1,"2",3.5],"quiz":{"2":[0,"x"]},"last":"4"}'), { done: [1], quiz: { 2: [0] }, last: null })
  assert.equal(nextLesson({ done: [], quiz: {}, last: null }, 16), 1)
  assert.equal(nextLesson({ done: [1, 2], quiz: {}, last: 5 }, 16), 5)
  assert.equal(nextLesson({ done: [1, 2, 5], quiz: {}, last: 5 }, 16), 3)
  assert.equal(lessonNo('#learn/07'), 7)
  assert.equal(lessonNo('#learn/7'), null)
})

test('the real course parses: 16 lessons, all sections, a quiz each, glossary and sources', () => {
  const dir = new URL('../../docs/learn/', import.meta.url)
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]))
  const c = buildCourse(files)
  assert.equal(c.lessons.length, 16)
  assert.equal(c.lessons.reduce((n, l) => n + l.minutes, 0), 480)
  for (const l of c.lessons) {
    assert.deepEqual(
      l.sections.map((s) => s.title),
      ['In plain words', 'The idea', 'Watch it live', 'Try it', 'Check yourself', 'Go deeper'],
      l.id,
    )
    assert.ok(l.quiz.length >= 3, `${l.id} quiz`)
    // Every Q/A line became a question, so none is left as a stray paragraph.
    const lines = files[`${l.id}.md`].match(/^Q:/gm)!.length
    assert.equal(l.quiz.length, lines, `${l.id} lost a question`)
  }
  assert.ok(c.glossary.length > 100)
  assert.ok(c.glossary.every((g) => g.lessons.every((n) => n >= 1 && n <= 16)))
  assert.ok(c.readme.some((s) => s.title === 'A one-day schedule'))
  assert.ok(c.sources.length > 5)
})

test('lesson topics exist, and every topic explainer belongs to at least one lesson', () => {
  const mapped = new Set(Object.values(LESSON_TOPICS).flat())
  for (const id of mapped) assert.ok(TOPICS[id], `unknown topic ${id}`)
  const loose = Object.keys(TOPICS).filter((id) => !mapped.has(id))
  assert.ok(loose.length <= 8, `topics with no lesson: ${loose.join(', ')}`)
})

test('topics name the lessons that cover them', () => {
  assert.equal(coveredIn('neural-engine'), 'Covered in lesson 7')
  assert.equal(coveredIn('swap'), 'Covered in lessons 8 and 11')
  assert.equal(coveredIn('trackpad'), 'Covered in lessons 14 and 15')
})
