import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanAll } from '../src/scan.ts'
import { renderRulesBlock } from '../src/render.ts'
import { resolveRequested } from '../src/tool-read-rules.ts'

/**
 * Scenario tests across agent conventions and edge cases.
 *
 * Each case builds a real fixture tree on disk, scans it, and asserts the
 * end-to-end outcome (classification, state, and what reaches the prompt).
 */
let root: string

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dshrm-scn-'))
  await mkdir(join(dir, '.git'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return dir
}

beforeEach(() => { root = '' })
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })

describe('scenario: a CodeBuddy-only project', () => {
  it('classifies all three states and renders the expected sections', async () => {
    root = await project({
      '.codebuddy/rules/always.mdc': '---\ndescription: discipline\nalwaysApply: true\n---\nALWAYS BODY\n',
      '.codebuddy/rules/on-demand.mdc': '---\ndescription: for TS edits\nalwaysApply: false\n---\nONDEMAND BODY\n',
      '.codebuddy/rules/off.mdc': '---\ndescription: rare\nalwaysApply: false\nenabled: false\n---\nOFF BODY\n',
    })
    const { rules } = await scanAll(root)
    expect(rules.length).toBe(3)

    const block = renderRulesBlock(rules, { projectRoot: root })
    expect(block).toContain('ALWAYS BODY')
    expect(block).toContain('for TS edits')
    expect(block).not.toContain('ONDEMAND BODY')
    expect(block).not.toContain('OFF BODY')
    expect(block).toContain('<agent_requestable_workspace_rules')
  })
})

describe('scenario: a Cursor-only project', () => {
  it('reads .mdc under .cursor/rules and keeps globs without attaching', async () => {
    root = await project({
      '.cursor/rules/ts.mdc': '---\ndescription: TS conventions\nglobs: "src/**/*.ts"\nalwaysApply: false\n---\nTS BODY\n',
      '.cursor/rules/always.mdc': '---\ndescription: always on\nglobs: "**/*"\nalwaysApply: true\n---\nALWAYS\n',
    })
    const { rules } = await scanAll(root)
    const ts = rules.find((r) => r.name === 'ts')
    expect(ts?.family).toBe('cursor')
    expect(ts?.patterns).toEqual(['src/**/*.ts'])
    expect(ts?.type).toBe('requested')

    // The glob is retained but does not by itself put the body in the prompt.
    const block = renderRulesBlock(rules, { projectRoot: root })
    expect(block).not.toContain('TS BODY')
    expect(block).toContain('ALWAYS')
  })
})

describe('scenario: a Claude Code-only project', () => {
  it('reads .claude/rules with a paths block list', async () => {
    root = await project({
      '.claude/rules/api.md': '---\npaths:\n  - "src/api/**"\n---\nAPI BODY\n',
    })
    const { rules } = await scanAll(root)
    expect(rules.length).toBe(1)
    expect(rules[0]?.family).toBe('claude')
    // Claude Code loads a rule when a matching file is touched, so a rule that
    // is scoped by paths is on demand even without a description.
    expect(rules[0]?.type).toBe('requested')
    const block = renderRulesBlock(rules, { projectRoot: root })
    expect(block).not.toContain('API BODY')
  })

  it('treats a description as making it requestable', async () => {
    root = await project({
      '.claude/rules/api.md': '---\ndescription: API rules\npaths: "src/api/**"\n---\nAPI BODY\n',
    })
    const { rules } = await scanAll(root)
    expect(rules[0]?.type).toBe('requested')
    expect(rules[0]?.patterns).toEqual(['src/api/**'])
  })
})

describe('scenario: all three conventions in one project', () => {
  beforeEach(async () => {
    root = await project({
      '.codebuddy/rules/cb.mdc': '---\ndescription: cb\nalwaysApply: true\n---\nCB\n',
      '.cursor/rules/cur.mdc': '---\ndescription: cur\nglobs: "**/*.ts"\n---\nCUR\n',
      '.claude/rules/cla.md': '---\ndescription: cla\npaths: "src/**"\n---\nCLA\n',
    })
  })

  it('discovers one rule from each convention with the right family', async () => {
    const { rules } = await scanAll(root)
    const byName = new Map(rules.map((r) => [r.name, r]))
    expect(byName.get('cb')?.family).toBe('codebuddy')
    expect(byName.get('cur')?.family).toBe('cursor')
    expect(byName.get('cla')?.family).toBe('claude')
  })

  it('orders by source rank, so CodeBuddy precedes Cursor precedes Claude', async () => {
    const { rules } = await scanAll(root)
    expect(rules.map((r) => r.name)).toEqual(['cb', 'cur', 'cla'])
  })

  it('renders all three into one block', async () => {
    const { rules } = await scanAll(root)
    const block = renderRulesBlock(rules, { projectRoot: root })
    expect(block).toContain('CB')
    expect(block).toContain('cur')
    expect(block).toContain('cla')
    // cb is always-on; the other two are requestable only.
    expect(block).not.toContain('CUR\n')
  })
})

describe('scenario: hostile and broken input', () => {
  it('survives an unterminated frontmatter fence', async () => {
    root = await project({
      '.codebuddy/rules/broken.mdc': '---\ndescription: never closed\n\nbody without closing fence\n',
    })
    const { rules } = await scanAll(root)
    // No closing fence means no frontmatter was parsed, so nothing is admitted.
    expect(rules.length).toBe(0)
  })

  it('survives an empty file', async () => {
    root = await project({ '.codebuddy/rules/empty.mdc': '' })
    const { rules, diagnostics } = await scanAll(root)
    expect(rules.length).toBe(0)
    expect(diagnostics.length).toBeGreaterThan(0)
  })

  it('survives a file of only a fence', async () => {
    root = await project({ '.codebuddy/rules/only.mdc': '---\n---\n' })
    const { rules } = await scanAll(root)
    expect(rules.length).toBe(0)
  })

  it('survives binary-ish content with a valid extension', async () => {
    root = await project({ '.codebuddy/rules/bin.mdc': '\u0000\u0001\u0002garbage\u0000' })
    const { rules } = await scanAll(root)
    expect(rules.length).toBe(0)
  })

  it('survives a very long single line without hanging', async () => {
    const line = 'x'.repeat(200_000)
    root = await project({ '.codebuddy/rules/long.mdc': `---\ndescription: ${line}\n---\nBODY\n` })
    const started = Date.now()
    const { rules } = await scanAll(root)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(rules[0]?.descriptionTokens).toBeGreaterThan(0)
  })

  it('survives deeply nested YAML-ish noise', async () => {
    const noise = Array.from({ length: 500 }, (_, i) => `  - item${i}`).join('\n')
    root = await project({
      '.codebuddy/rules/noise.mdc': `---\ndescription: d\npaths:\n${noise}\n---\nBODY\n`,
    })
    const { rules } = await scanAll(root)
    expect(rules[0]?.patterns.length).toBe(500)
  })

  it('handles a rule whose name collides across conventions', async () => {
    root = await project({
      '.codebuddy/rules/shared.mdc': '---\ndescription: from codebuddy\nalwaysApply: false\n---\nCB BODY\n',
      '.cursor/rules/shared.mdc': '---\ndescription: from cursor\nglobs: "**/*"\n---\nCUR BODY\n',
    })
    const { rules } = await scanAll(root)
    // Distinct absolute paths, so both are kept (Cursor dedupes by full path too).
    expect(rules.length).toBe(2)
    const index = Object.fromEntries(
      rules.filter((r) => r.type === 'requested').map((r) => [r.path, { path: r.path, name: r.name, body: r.body }]),
    )
    // A bare basename is ambiguous and must be reported, not guessed.
    const res = resolveRequested(index, ['shared.mdc'])
    expect(res.resolved.length).toBe(0)
    expect(res.ambiguous.length).toBe(1)
    expect(res.ambiguous[0]?.candidates.length).toBe(2)
  })
})

describe('scenario: unusual but valid frontmatter', () => {
  it('accepts alwaysApply in the variants YAML allows', async () => {
    root = await project({
      '.codebuddy/rules/a.mdc': '---\nalwaysApply: true\n---\nA\n',
      '.codebuddy/rules/b.mdc': '---\nalwaysApply: "true"\n---\nB\n',
      '.codebuddy/rules/c.mdc': '---\nalwaysApply: false\n---\nC\n',
    })
    const { rules } = await scanAll(root)
    const byName = new Map(rules.map((r) => [r.name, r]))
    expect(byName.get('a')?.type).toBe('always')
    expect(byName.get('b')?.type).toBe('always')   // quoted still parses as true
    expect(byName.get('c')?.type).toBe('manual')
  })

  it('accepts a description containing colons and unicode', async () => {
    root = await project({
      '.codebuddy/rules/u.mdc': '---\ndescription: 处理 http://x.com:8080 的请求\nalwaysApply: false\n---\nB\n',
    })
    const { rules } = await scanAll(root)
    expect(rules[0]?.type).toBe('requested')
    expect(rules[0]?.description).toContain('http://x.com:8080')
    expect(rules[0]?.description).toContain('处理')
  })

  it('accepts CRLF throughout', async () => {
    root = await project({
      '.codebuddy/rules/crlf.mdc': '---\r\ndescription: hi\r\nalwaysApply: true\r\n---\r\nBODY\r\n',
    })
    const { rules } = await scanAll(root)
    expect(rules[0]?.type).toBe('always')
    expect(rules[0]?.body).toContain('BODY')
  })

  it('ignores comments in frontmatter', async () => {
    root = await project({
      '.codebuddy/rules/c.mdc': '---\n# a comment\ndescription: d\nalwaysApply: false\n---\nB\n',
    })
    const { rules } = await scanAll(root)
    expect(rules[0]?.description).toBe('d')
  })

  it('accepts uppercase extensions', async () => {
    root = await project({ '.codebuddy/rules/UP.MDC': '---\ndescription: upper\n---\nB\n' })
    const { rules } = await scanAll(root)
    expect(rules.length).toBe(1)
  })
})

describe('scenario: empty and absent trees', () => {
  it('handles a project with no rule directories', async () => {
    root = await project({ 'src/index.ts': 'export {}\n' })
    const { rules, truncated } = await scanAll(root)
    expect(rules).toEqual([])
    expect(truncated).toBe(false)
  })

  it('handles an empty rules directory', async () => {
    root = await project({ '.codebuddy/rules/.keep': '' })
    const { rules } = await scanAll(root)
    expect(rules).toEqual([])
  })

  it('skips dot-directories inside a rules root', async () => {
    root = await project({
      '.codebuddy/rules/.hidden/x.mdc': '---\ndescription: hidden\n---\nH\n',
      '.codebuddy/rules/visible.mdc': '---\ndescription: visible\n---\nV\n',
    })
    const { rules } = await scanAll(root)
    expect(rules.map((r) => r.name)).toEqual(['visible'])
  })
})
