/**
 * A small Markdown parser for the course in docs/learn. It covers what the lessons use (headings, paragraphs,
 * lists, fenced code, tables, blockquotes, inline code, bold and links) and returns a tree that React renders
 * as text nodes, so nothing in a lesson can become HTML.
 */

export type Inline = { t: 'text'; v: string } | { t: 'code'; v: string } | { t: 'strong'; c: Inline[] } | { t: 'link'; href: string; c: Inline[] }
export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'quote'; c: Block[] }

/** Where a link in a lesson may go. Anything else renders as its text. */
export type Target = { kind: 'web'; href: string } | { kind: 'lesson'; n: number } | { kind: 'home' }

export function linkTarget(href: string): Target | null {
  if (/^https:\/\/[^\s"<>]+$/i.test(href)) return { kind: 'web', href }
  const lesson = /^(\d\d)-[\w-]+\.md(#[\w-]*)?$/.exec(href)
  if (lesson) return { kind: 'lesson', n: +lesson[1] }
  if (/^(glossary|sources|README)\.md(#[\w-]*)?$/.test(href)) return { kind: 'home' }
  return null
}

/** Inline spans. Unclosed markers stay as literal text. */
export function inline(s: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: 'code', v: s.slice(i + 1, end) })
        i = end + 1
        continue
      }
    } else if (ch === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: 'strong', c: inline(s.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    } else if (ch === '[') {
      const link = linkAt(s, i)
      if (link) {
        flush()
        out.push({ t: 'link', href: link.href, c: inline(link.label) })
        i = link.end
        continue
      }
    } else if (ch === '\\' && i + 1 < s.length && /[\\`*[\]()_#|>-]/.test(s[i + 1])) {
      text += s[i + 1]
      i += 2
      continue
    }
    text += ch
    i++
  }
  flush()
  return out
}

/** `[label](href)` starting at i, with brackets inside the label and parentheses inside the href balanced. */
function linkAt(s: string, i: number): { label: string; href: string; end: number } | null {
  let depth = 0
  let j = i
  for (; j < s.length; j++) {
    if (s[j] === '`') {
      // A code span in the label can hold brackets.
      const end = s.indexOf('`', j + 1)
      if (end < 0) return null
      j = end
    } else if (s[j] === '[') depth++
    else if (s[j] === ']' && --depth === 0) break
  }
  if (j >= s.length || s[j + 1] !== '(') return null
  let k = j + 2
  for (let d = 1; k < s.length; k++) {
    if (s[k] === '(') d++
    else if (s[k] === ')' && --d === 0) break
    else if (s[k] === ' ') return null
  }
  if (k >= s.length) return null
  return { label: s.slice(i + 1, j), href: s.slice(j + 2, k), end: k + 1 }
}

/** Splits a table row on pipes that are outside code spans. */
function cells(line: string): string[] {
  const row = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const out: string[] = []
  let cur = ''
  let code = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '\\' && row[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '`') {
      code = !code
      cur += ch
    } else if (ch === '|' && !code) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const NUMBER = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const startsBlock = (l: string) => HEADING.test(l) || FENCE.test(l) || BULLET.test(l) || NUMBER.test(l) || /^\s{0,3}>/.test(l)

export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      // Closed by a fence of the same character, at least as long; an unclosed fence runs to the end.
      const close = new RegExp(`^\\s{0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`)
      const body: string[] = []
      i++
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++])
      i++
      out.push({ t: 'code', lang: fence[2], v: body.join('\n') })
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      out.push({ t: 'h', level: h[1].length, c: inline(h[2]) })
      i++
      continue
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
      out.push({ t: 'quote', c: parse(body.join('\n')) })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && RULE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const r = cells(lines[i++])
        rows.push(head.map((_, c) => inline(r[c] ?? '')))
      }
      out.push({ t: 'table', head: head.map(inline), rows })
      continue
    }
    const list = BULLET.test(line) ? BULLET : NUMBER.test(line) ? NUMBER : null
    if (list) {
      const items: string[] = []
      const start = list === NUMBER ? +NUMBER.exec(line)![1] : 1
      while (i < lines.length) {
        const m = list.exec(lines[i])
        if (m) items.push(m[m.length - 1])
        // An indented line continues the item above it.
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ' ' + lines[i].trim()
        else break
        i++
      }
      const parsed = items.map(inline)
      out.push(list === NUMBER ? { t: 'ol', start, items: parsed } : { t: 'ul', items: parsed })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i]))) para.push(lines[i++].trim())
    out.push({ t: 'p', c: inline(para.join(' ')) })
  }
  return out
}

/** The plain text of some spans, for ids, labels and search. */
export const plainText = (c: Inline[]): string => c.map((x) => (x.t === 'text' || x.t === 'code' ? x.v : plainText(x.c))).join('')

/** `---` front matter: `key: value` lines, with `[a, b]` read as a list. */
export function frontMatter(src: string): { data: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { data: {}, body: src }
  const data: Record<string, string | string[]> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const v = kv[2].trim()
    data[kv[1]] = /^\[.*\]$/.test(v)
      ? v
          .slice(1, -1)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : v.replace(/^(['"])(.*)\1$/, '$2')
  }
  return { data, body: src.slice(m[0].length) }
}

/** Splits a document on `## ` headings, outside code fences. Text before the first one is the intro. */
export function sections(md: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [{ title: '', body: '' }]
  let fence = false
  for (const line of md.split('\n')) {
    if (FENCE.test(line)) fence = !fence
    const h = !fence && /^## (.*)$/.exec(line)
    if (h) out.push({ title: h[1].trim(), body: '' })
    else out[out.length - 1].body += line + '\n'
  }
  return out.filter((s, i) => i > 0 || s.body.trim())
}
