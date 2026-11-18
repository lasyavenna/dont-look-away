// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8')

describe('docs/EXECUTION.md (Req 16.1-16.5)', () => {
  const doc = read('docs/EXECUTION.md')

  it('states the Web Worker is not a security sandbox', () => {
    expect(doc).toMatch(/web worker/i)
    expect(doc).toMatch(/not a security sandbox/i)
  })
  it('states player code can make network requests', () => {
    expect(doc).toMatch(/network requests/i)
  })
  it('states only code typed by the player in the same session is supported', () => {
    expect(doc).toMatch(/only code typed by the player in the same session/i)
    expect(doc).toMatch(/untrusted/i)
  })
  it('states the 3000 ms timeout', () => {
    expect(doc).toMatch(/3000 (milliseconds|ms)/i)
  })
  it('describes termination and timeout reporting', () => {
    expect(doc).toMatch(/terminated/i)
    expect(doc).toMatch(/`timeout`/)
    expect(doc).toMatch(/timed out/i)
  })
})

describe('README.md (Req 16.6, 16.9)', () => {
  const readme = read('README.md')

  it('is non-empty and links to the docs', () => {
    expect(readme.trim().length).toBeGreaterThan(0)
    expect(readme).toContain('docs/EXECUTION.md')
    expect(readme).toContain('docs/PLAYTEST.md')
  })
  it('documents the scripts', () => {
    for (const cmd of ['npm run dev', 'npm run build', 'npm run test', 'npm run typecheck', 'npm run verify:build']) {
      expect(readme).toContain(cmd)
    }
  })
  it('keeps the Page Visibility, no-camera and sound opt-in disclosures', () => {
    expect(readme).toMatch(/Page Visibility/i)
    expect(readme).toMatch(/no camera/i)
    expect(readme).toMatch(/sound is opt-in/i)
  })
})

describe('repository files', () => {
  it('has a non-empty LICENSE', () => {
    expect(readFileSync(resolve(root, 'LICENSE'), 'utf8').trim().length).toBeGreaterThan(0)
  })

  it('.gitignore does not ignore .kiro', () => {
    const lines = read('.gitignore')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    const bad = new Set(['.kiro', '.kiro/', '/.kiro', '/.kiro/', '.kiro/*', '.kiro/**', '/.kiro/*', '/.kiro/**', '**/.kiro', '**/.kiro/'])
    for (const line of lines) {
      expect(bad.has(line), `pattern ${line}`).toBe(false)
      expect(/^\/?\.kiro(\/|$)/.test(line), `pattern ${line}`).toBe(false)
    }
  })

  it('package.json has the required scripts and script files exist', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    for (const name of ['dev', 'build', 'test', 'typecheck', 'verify:build']) {
      expect(scripts[name], name).toBeTruthy()
    }
    expect(existsSync(resolve(root, 'scripts/verify-build.mjs'))).toBe(true)
    expect(existsSync(resolve(root, 'scripts/check-bundle.mjs'))).toBe(true)
  })
})

describe('docs/PLAYTEST.md checklist', () => {
  it('has only passed|failed|untested statuses', () => {
    expect(existsSync(resolve(root, 'docs/PLAYTEST.md'))).toBe(true)
    const lines = read('docs/PLAYTEST.md').split(/\r?\n/)
    const allowed = new Set(['passed', 'failed', 'untested'])
    const statuses: string[] = []

    // Table rows: find the Status column from each header row.
    let col = -1
    for (const line of lines) {
      if (!line.trim().startsWith('|')) {
        col = -1
        continue
      }
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const idx = cells.findIndex((c) => /^status$/i.test(c.replace(/[*_`]/g, '')))
      if (idx >= 0) {
        col = idx
        continue
      }
      if (col < 0 || cells.every((c) => /^:?-+:?$/.test(c))) continue
      statuses.push((cells[col] ?? '').replace(/[*_`]/g, '').toLowerCase())
    }
    // List items: "Status: x" or "[status]" style.
    for (const line of lines) {
      const m = /^\s*(?:[-*]|\d+\.)\s.*\bstatus:\s*\**`?([A-Za-z-]+)/i.exec(line)
      if (m) statuses.push(m[1].toLowerCase())
    }

    expect(statuses.length).toBeGreaterThanOrEqual(5)
    for (const s of statuses) expect(allowed.has(s), `status "${s}"`).toBe(true)
  })
})
