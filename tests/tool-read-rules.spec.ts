import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanAll } from '../src/scan.ts'
import { createReadRulesTool, formatResolved, resolveRequested, type RequestableIndex } from '../src/tool-read-rules.ts'
import { READ_RULES_OUTPUT_MAX } from '../src/budget.ts'

const index: RequestableIndex = {
  '/repo/.codebuddy/rules/ts-standard.mdc': { path: '/repo/.codebuddy/rules/ts-standard.mdc', name: 'ts-standard', body: 'TS BODY' },
  '/repo/.codebuddy/rules/css-standard.mdc': { path: '/repo/.codebuddy/rules/css-standard.mdc', name: 'css-standard', body: 'CSS BODY' },
  '/repo/.cursor/rules/api.mdc': { path: '/repo/.cursor/rules/api.mdc', name: 'api-guidelines', body: 'API BODY' },
  '/repo/dup/a/shared.mdc': { path: '/repo/dup/a/shared.mdc', name: 'shared-a', body: 'A' },
  '/repo/dup/b/shared.mdc': { path: '/repo/dup/b/shared.mdc', name: 'shared-b', body: 'B' },
}

describe('resolveRequested — the four tiers', () => {
  it('tier 1: an exact absolute path', () => {
    const r = resolveRequested(index, ['/repo/.codebuddy/rules/ts-standard.mdc'])
    expect(r.resolved.length).toBe(1)
    expect(r.resolved[0]?.body).toBe('TS BODY')
  })

  it('tier 2: a case-insensitive path', () => {
    const r = resolveRequested(index, ['/REPO/.CODEBUDDY/RULES/TS-STANDARD.MDC'])
    expect(r.resolved.length).toBe(1)
    expect(r.resolved[0]?.name).toBe('ts-standard')
  })

  it('tier 3: a unique basename', () => {
    const r = resolveRequested(index, ['ts-standard.mdc'])
    expect(r.resolved.length).toBe(1)
    expect(r.resolved[0]?.name).toBe('ts-standard')
  })

  it('tier 4: a unique rule name', () => {
    const r = resolveRequested(index, ['api-guidelines'])
    expect(r.resolved.length).toBe(1)
    expect(r.resolved[0]?.path).toBe('/repo/.cursor/rules/api.mdc')
  })

  it('reports an unknown key as notFound', () => {
    const r = resolveRequested(index, ['nope.mdc'])
    expect(r.resolved).toEqual([])
    expect(r.notFound).toEqual(['nope.mdc'])
  })

  it('reports an ambiguous basename with its candidates instead of guessing', () => {
    const r = resolveRequested(index, ['shared.mdc'])
    expect(r.resolved).toEqual([])
    expect(r.ambiguous.length).toBe(1)
    expect(r.ambiguous[0]?.candidates.length).toBe(2)
  })

  it('resolves the ambiguous key when the exact path is given', () => {
    const r = resolveRequested(index, ['/repo/dup/a/shared.mdc'])
    expect(r.resolved.length).toBe(1)
    expect(r.resolved[0]?.body).toBe('A')
  })

  it('deduplicates a key requested twice', () => {
    const r = resolveRequested(index, ['ts-standard.mdc', '/repo/.codebuddy/rules/ts-standard.mdc'])
    expect(r.resolved.length).toBe(1)
  })

  it('ignores blank entries', () => {
    const r = resolveRequested(index, ['', '   '])
    expect(r.resolved).toEqual([])
    expect(r.notFound).toEqual([])
  })

  it('handles a mixed batch', () => {
    const r = resolveRequested(index, ['ts-standard.mdc', 'api-guidelines', 'nope', 'shared.mdc'])
    expect(r.resolved.length).toBe(2)
    expect(r.notFound).toEqual(['nope'])
    expect(r.ambiguous.length).toBe(1)
  })

  it('resolves nothing against an empty index', () => {
    const r = resolveRequested({}, ['anything'])
    expect(r.resolved).toEqual([])
    expect(r.notFound).toEqual(['anything'])
  })
})

describe('formatResolved', () => {
  it('wraps each rule in a <rule> block naming its path', () => {
    const r = resolveRequested(index, ['ts-standard.mdc'])
    const out = formatResolved(r)
    expect(out).toContain('<rule name="ts-standard"')
    expect(out).toContain('path="/repo/.codebuddy/rules/ts-standard.mdc"')
    expect(out).toContain('TS BODY')
  })

  it('appends a not-found note', () => {
    const r = resolveRequested(index, ['nope'])
    const out = formatResolved(r)
    expect(out).toContain('[Not found (not in the requestable rules list): nope]')
  })

  it('lists every candidate absolute path and a retry hint for an ambiguous basename', () => {
    const r = resolveRequested(index, ['shared.mdc'])
    const out = formatResolved(r)
    expect(out).toContain('shared.mdc')
    expect(out).toContain('/repo/dup/a/shared.mdc')
    expect(out).toContain('/repo/dup/b/shared.mdc')
    expect(out).toContain('Retry with one exact absolute path')
    expect(out).not.toContain('<rule')
  })

  it('truncates past the output budget and says so', () => {
    const huge: RequestableIndex = {
      '/p/huge.mdc': { path: '/p/huge.mdc', name: 'huge', body: 'x'.repeat(READ_RULES_OUTPUT_MAX * 2) },
    }
    const r = resolveRequested(huge, ['/p/huge.mdc'])
    const out = formatResolved(r)
    expect(out).toContain('read_rules output budget')
    expect(out.length).toBeLessThan(READ_RULES_OUTPUT_MAX + 400)
  })

  it('serves earlier rules in full and truncates the later one', () => {
    const big: RequestableIndex = {
      '/p/a.mdc': { path: '/p/a.mdc', name: 'a', body: 'A'.repeat(40000) },
      '/p/b.mdc': { path: '/p/b.mdc', name: 'b', body: 'B'.repeat(40000) },
    }
    const r = resolveRequested(big, ['/p/a.mdc', '/p/b.mdc'])
    const out = formatResolved(r)
    expect(out).toContain('A'.repeat(100))
    expect(out).toContain('read_rules output budget')
  })

  it('returns an empty string for an empty resolution', () => {
    expect(formatResolved({ resolved: [], notFound: [], ambiguous: [] })).toBe('')
  })
})

describe('createReadRulesTool — an ambiguous key reaches the model', () => {
  const tool = createReadRulesTool(() => index) as unknown as {
    description: string
    execute(args: unknown, exec: unknown): Promise<{
      content: string
      resolvedCount: number
      notFoundCount: number
      ambiguousCount: number
    }>
  }

  it('reports the candidates and the retry hint instead of a silent empty result', async () => {
    const out = await tool.execute({ ruleNames: ['shared.mdc'] }, { agent: undefined })
    expect(out.ambiguousCount).toBe(1)
    expect(out.resolvedCount).toBe(0)
    expect(out.notFoundCount).toBe(0)
    expect(out.content).toContain('/repo/dup/a/shared.mdc')
    expect(out.content).toContain('/repo/dup/b/shared.mdc')
    expect(out.content).toContain('Retry with one exact absolute path')
    expect(out.content).not.toContain('<rule')
  })

  it('counts two ambiguous keys in one call', async () => {
    const out = await tool.execute({ ruleNames: ['shared.mdc', 'shared.mdc'] }, { agent: undefined })
    expect(out.ambiguousCount).toBe(2)
  })

  it('still resolves a unique basename normally', async () => {
    const out = await tool.execute({ ruleNames: ['ts-standard.mdc'] }, { agent: undefined })
    expect(out.resolvedCount).toBe(1)
    expect(out.ambiguousCount).toBe(0)
    expect(out.notFoundCount).toBe(0)
    expect(out.content).toContain('<rule name="ts-standard"')
    expect(out.content).toContain('TS BODY')
  })

  it('reports both candidates from a scanned on-disk catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshrm-rules-ambiguous-'))
    try {
      await mkdir(join(root, '.codebuddy', 'rules', 'a'), { recursive: true })
      await mkdir(join(root, '.codebuddy', 'rules', 'b'), { recursive: true })
      const body = (name: string): string => ['---', `description: ${name}`, '---', `BODY ${name}`, ''].join('\n')
      await writeFile(join(root, '.codebuddy', 'rules', 'a', 'shared.mdc'), body('alpha'), 'utf8')
      await writeFile(join(root, '.codebuddy', 'rules', 'b', 'shared.mdc'), body('beta'), 'utf8')

      const scanned = await scanAll(root)
      const discovered: Record<string, { path: string; name: string; body: string }> = {}
      for (const rule of scanned.rules) discovered[rule.path] = { path: rule.path, name: rule.name, body: rule.body }
      const scannedTool = createReadRulesTool(() => discovered as RequestableIndex) as unknown as {
        execute(args: unknown, exec: unknown): Promise<{ content: string; ambiguousCount: number; resolvedCount: number }>
      }

      const out = await scannedTool.execute({ ruleNames: ['shared.mdc'] }, { agent: undefined })
      expect(out.ambiguousCount).toBe(1)
      expect(out.resolvedCount).toBe(0)
      for (const rule of scanned.rules) expect(out.content).toContain(rule.path)
      expect(out.content).toContain('Retry with one exact absolute path')
      expect(out.content).not.toContain('<rule')

      const exact = await scannedTool.execute({ ruleNames: [scanned.rules[0]!.path] }, { agent: undefined })
      expect(exact.resolvedCount).toBe(1)
      expect(exact.ambiguousCount).toBe(0)
      expect(exact.content).toContain('<rule name=')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('tells the model in its description to retry ambiguous keys with an exact path', () => {
    expect(tool.description).toContain('candidates')
    expect(tool.description).toContain('exact absolute path')
  })
})
