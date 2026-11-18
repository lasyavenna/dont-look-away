import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative, sep } from 'node:path'

// Layering boundary test (Requirements 22.1, 3.3).
// Pragmatic approach: a small scanner blanks out comments (and, for the identifier
// check, string/template literal contents) before regex matching, so prose that
// mentions `window` etc. does not fail. Import specifiers are read from the
// comment-stripped source with strings intact.

const ROOT = resolve(__dirname, '..')
const SRC = join(ROOT, 'src')
const CORE = join(SRC, 'core')
const TESTS = join(ROOT, 'tests')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(name)) out.push(p)
  }
  return out
}

/** Replace comments (and optionally string contents) with spaces, keeping other code. */
function strip(src: string, blankStrings: boolean): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
      out += ' '
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c
      out += q
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          out += blankStrings ? '  ' : src.slice(i, i + 2)
          i += 2
          continue
        }
        out += blankStrings && src[i] !== '\n' ? ' ' : src[i]
        i++
      }
      out += q
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

function importSpecifiers(src: string): string[] {
  const code = strip(src, false)
  const specs: string[] = []
  const patterns = [
    /\bfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  ]
  for (const re of patterns) for (const m of code.matchAll(re)) specs.push(m[2])
  return specs
}

function resolvesInto(file: string, spec: string, dir: string): boolean {
  if (!spec.startsWith('.')) return false
  const target = resolve(dirname(file), spec)
  const rel = relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep))
}

const coreFiles = walk(CORE)
const srcFiles = walk(SRC)
const rel = (f: string) => relative(ROOT, f)

describe('layering boundaries', () => {
  it('finds core files to scan', () => {
    expect(coreFiles.length).toBeGreaterThan(0)
  })

  it('src/core does not import react, react-dom, src/app, or src/audio', () => {
    const violations: string[] = []
    for (const f of coreFiles) {
      for (const spec of importSpecifiers(readFileSync(f, 'utf8'))) {
        const bad =
          /^react(\/|$)/.test(spec) ||
          /^react-dom(\/|$)/.test(spec) ||
          resolvesInto(f, spec, join(SRC, 'app')) ||
          resolvesInto(f, spec, join(SRC, 'audio')) ||
          /^(\/)?src\/(app|audio)(\/|$)/.test(spec)
        if (bad) violations.push(`${rel(f)} imports '${spec}'`)
      }
    }
    expect(violations).toEqual([])
  })

  it('src/core does not reference browser globals', () => {
    const re = /\b(window|document|navigator|localStorage|sessionStorage)\b/g
    const violations: string[] = []
    for (const f of coreFiles) {
      const code = strip(readFileSync(f, 'utf8'), true)
      for (const m of code.matchAll(re)) violations.push(`${rel(f)} uses '${m[1]}'`)
    }
    expect(violations).toEqual([])
  })

  it('src does not import from tests/', () => {
    const violations: string[] = []
    for (const f of srcFiles) {
      for (const spec of importSpecifiers(readFileSync(f, 'utf8'))) {
        if (
          resolvesInto(f, spec, TESTS) ||
          /^(\/)?tests(\/|$)/.test(spec) ||
          /referenceSolution/.test(spec)
        )
          violations.push(`${rel(f)} imports '${spec}'`)
      }
    }
    expect(violations).toEqual([])
  })
})
