import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderRulesBlock } from '../src/render.ts'
import { scanAll } from '../src/scan.ts'
import { createReadRulesTool } from '../src/tool-read-rules.ts'
import { readState, setStateDir, statePath, writeState, defaultState } from '../src/state.ts'
import { Config, type Config as RulesManagerConfig } from '../src/config.ts'
import type { Rule } from '../src/types.ts'

function rule(over: Partial<Rule> & Pick<Rule, 'name' | 'type'>): Rule {
  const { name, type, ...rest } = over
  const base: Rule = {
    path: `/repo/.codebuddy/rules/${name}.mdc`,
    name,
    type,
    enabled: true,
    description: '',
    body: 'BODY',
    family: 'codebuddy',
    scope: 'project',
    sourceKey: 'codebuddy',
    patterns: [],
    descriptionTokens: 1,
    bodyTokens: 1,
    diagnostics: [],
    ...rest,
  }
  return base
}

/** Resolve the schemastery schema the way the host does, yielding defaults. */
function resolveConfig(value: Record<string, unknown>): RulesManagerConfig {
  return (Config as unknown as (v: unknown) => RulesManagerConfig)(value)
}

describe('Config defaults (schemastery)', () => {
  // `Config` is the schemastery schema; resolving it yields the defaults the
  // plugin actually runs with when no `config:` block is present.
  const resolved = resolveConfig({})

  it('defaults match the documented values', () => {
    expect(resolved.perRuleMax).toBe(8000)
    expect(resolved.userRulesTotal).toBe(6000)
    expect(resolved.projectRulesTotal).toBe(12000)
    expect(resolved.readRulesOutput).toBe(60000)
    expect(resolved.maxScanDepth).toBe(6)
    expect(resolved.injectRules).toBe(true)
  })

  it('leaves stateDir empty by default, so the fallback chain still applies', () => {
    // Empty is the "unpinned" sentinel. schemastery cannot tell a computed
    // default from an explicit value (measured), so resolving the home here
    // would make `apply` pin the directory on every run and
    // `DSH_RULES_MANAGER_HOME` could never take effect.
    expect(resolved.stateDir).toBe('')
  })

  it('accepts an explicit stateDir pin', () => {
    expect(resolveConfig({ stateDir: 'X:/pinned' }).stateDir).toBe('X:/pinned')
  })

  it('accepts an override', () => {
    const custom = resolveConfig({ perRuleMax: 1234, injectRules: false })
    expect(custom.perRuleMax).toBe(1234)
    expect(custom.injectRules).toBe(false)
  })
})

describe('Config bounds (schemastery)', () => {
  // The bounds are there because a typo used to pass straight through: measured
  // before them, `perRuleMax: -1` was accepted and truncated every rule at
  // `-1 chars`, `NaN` skipped truncation entirely, and `maxScanDepth: -3` made
  // the scan return zero rules with no diagnostic at all.
  it('refuses a cap below its floor', () => {
    expect(() => resolveConfig({ perRuleMax: -1 })).toThrow(/expected number >= 100/)
    expect(() => resolveConfig({ maxScanDepth: -3 })).toThrow(/expected number >= 0/)
    expect(() => resolveConfig({ readRulesOutput: 0 })).toThrow(/expected number >= 1000/)
  })

  it('refuses a cap past its ceiling', () => {
    expect(() => resolveConfig({ perRuleMax: 2_000_001 })).toThrow(/expected number <= 2000000/)
    expect(() => resolveConfig({ maxScanDepth: 101 })).toThrow(/expected number <= 100/)
  })

  it('refuses a fraction and a NaN, which used to disable truncation', () => {
    // Measured: the floor is checked before the step, so a fraction below it
    // reports the floor. Both messages still refuse the value, which is the
    // part that matters; the step is asserted on a value inside the bounds.
    expect(() => resolveConfig({ perRuleMax: 8000.5 })).toThrow(/multiple of 1/)
    expect(() => resolveConfig({ perRuleMax: 1.5 })).toThrow(/expected number >= 100/)
    expect(() => resolveConfig({ perRuleMax: Number.NaN })).toThrow(/expected number/)
    expect(() => resolveConfig({ perRuleMax: '8000' })).toThrow(/expected number/)
  })

  it('resolves null to the default, so a half-written block still loads', () => {
    // Measured: `.default()` swallows both undefined and null. That is the
    // behaviour worth keeping: a block that writes `perRuleMax:` with no value
    // must degrade to the default rather than refuse to load the plugin.
    expect(resolveConfig({ perRuleMax: null }).perRuleMax).toBe(8000)
    expect(resolveConfig({ maxScanDepth: null }).maxScanDepth).toBe(6)
  })

  it('still accepts a pin inside the bounds, including the bounds themselves', () => {
    expect(resolveConfig({ perRuleMax: 100 }).perRuleMax).toBe(100)
    expect(resolveConfig({ perRuleMax: 2_000_000 }).perRuleMax).toBe(2_000_000)
    expect(resolveConfig({ maxScanDepth: 0 }).maxScanDepth).toBe(0)
    expect(resolveConfig({ userRulesTotal: 0 }).userRulesTotal).toBe(0)
  })
})

describe('renderRulesBlock honors configurable budgets', () => {
  // 12000 body bytes exceeds the 8000 default cap, so the default path is
  // exercised; it also fits under the 12000 project total, so only truncation
  // (not omission) applies.
  const big = rule({ name: 'big', type: 'always', body: 'x'.repeat(12000) })

  it('uses the built-in per-rule cap by default', () => {
    const out = renderRulesBlock([big], { projectRoot: '/repo' })
    expect(out).toContain('rule truncated at 8000 chars')
  })

  it('honors a smaller per-rule cap', () => {
    const out = renderRulesBlock([big], { projectRoot: '/repo', perRuleMax: 100 })
    expect(out).toContain('rule truncated at 100 chars')
    // 100-char body plus the truncation note, and nothing like the full body.
    expect(out.length).toBeLessThan(1000)
  })

  it('honors a smaller project total, omitting whole rules', () => {
    const a = rule({ name: 'a', type: 'always', body: 'a'.repeat(300) })
    const b = rule({ name: 'b', type: 'always', body: 'b'.repeat(300) })
    const out = renderRulesBlock([a, b], {
      projectRoot: '/repo', perRuleMax: 10_000, projectRulesTotal: 400,
    })
    expect(out).toContain('rule(s) omitted due to context budget')
  })

  it('honors a smaller user total for user-scope rules', () => {
    const u = rule({ name: 'u', type: 'always', body: 'u'.repeat(300), path: '/home/me/.codebuddy/rules/u.mdc' })
    const out = renderRulesBlock([u], {
      projectRoot: '/repo', perRuleMax: 10_000, userRulesTotal: 100,
    })
    // Regression: a tier whose every rule is dropped must still render, so the
    // omission notice survives. Otherwise the rules vanish silently.
    expect(out).toContain('<always_applied_user_rules')
    expect(out).toContain('rule(s) omitted due to context budget')
    expect(out).toContain('u (')
  })
})

describe('scanAll honors maxDepth', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dshrm-depth-'))
    await mkdir(join(root, '.git'), { recursive: true })
    const base = join(root, '.codebuddy', 'rules')
    await mkdir(join(base, 'l1', 'l2'), { recursive: true })
    await writeFile(join(base, 'top.mdc'), '---\ndescription: top\n---\nT\n', 'utf8')
    await writeFile(join(base, 'l1', 'mid.mdc'), '---\ndescription: mid\n---\nM\n', 'utf8')
    await writeFile(join(base, 'l1', 'l2', 'deep.mdc'), '---\ndescription: deep\n---\nD\n', 'utf8')
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('finds all three with the default depth', async () => {
    const names = (await scanAll(root)).rules.map((r) => r.name)
    expect(names).toContain('top')
    expect(names).toContain('mid')
    expect(names).toContain('deep')
  })

  it('stops earlier with a smaller maxDepth', async () => {
    const names = (await scanAll(root, { maxDepth: 1 })).rules.map((r) => r.name)
    expect(names).toContain('top')
    expect(names).toContain('mid')
    expect(names).not.toContain('deep')
  })

  it('still finds the top level with maxDepth 0', async () => {
    const names = (await scanAll(root, { maxDepth: 0 })).rules.map((r) => r.name)
    expect(names).toContain('top')
    expect(names).not.toContain('mid')
  })
})

describe('createReadRulesTool honors the output cap', () => {
  const index = {
    '/p/a.mdc': { path: '/p/a.mdc', name: 'a', body: 'A'.repeat(500) },
  }

  it('applies a custom cap', async () => {
    const tool = createReadRulesTool(() => index, 100) as unknown as {
      execute(args: unknown, exec: unknown): Promise<{ content: string }>
    }
    const out = await tool.execute({ ruleNames: ['/p/a.mdc'] }, { agent: undefined })
    expect(out.content).toContain('read_rules output budget')
    expect(out.content.length).toBeLessThan(400)
  })

  it('serves the whole body under a generous cap', async () => {
    const tool = createReadRulesTool(() => index, 10_000) as unknown as {
      execute(args: unknown, exec: unknown): Promise<{ content: string }>
    }
    const out = await tool.execute({ ruleNames: ['/p/a.mdc'] }, { agent: undefined })
    expect(out.content).not.toContain('output budget')
    expect(out.content).toContain('A'.repeat(500))
  })
})

describe('setStateDir precedence', () => {
  let home: string
  const prev = process.env['DSH_RULES_MANAGER_HOME']

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dshrm-dir-'))
    process.env['DSH_RULES_MANAGER_HOME'] = join(home, 'from-env')
  })
  afterEach(async () => {
    setStateDir('')
    if (prev === undefined) delete process.env['DSH_RULES_MANAGER_HOME']
    else process.env['DSH_RULES_MANAGER_HOME'] = prev
    await rm(home, { recursive: true, force: true })
  })

  it('uses the environment variable when nothing is configured', () => {
    expect(statePath().replace(/\\/g, '/')).toContain('from-env/state.json')
  })

  it('prefers an explicit configuration over the environment variable', () => {
    setStateDir(join(home, 'from-config'))
    expect(statePath().replace(/\\/g, '/')).toContain('from-config/state.json')
  })

  it('falls back to the environment variable when cleared', () => {
    setStateDir(join(home, 'from-config'))
    setStateDir('')
    expect(statePath().replace(/\\/g, '/')).toContain('from-env/state.json')
  })

  it('round-trips through the configured directory', async () => {
    setStateDir(join(home, 'from-config'))
    await writeState({ ...defaultState(), entryLocation: 'sidebar' })
    expect((await readState()).entryLocation).toBe('sidebar')
  })
})

describe('stateDir precedence (the pollution root cause)', () => {
  const prev = process.env['DSH_RULES_MANAGER_HOME']
  afterEach(() => {
    setStateDir('')
    if (prev === undefined) delete process.env['DSH_RULES_MANAGER_HOME']
    else process.env['DSH_RULES_MANAGER_HOME'] = prev
  })

  it('lets DSH_RULES_MANAGER_HOME win when config leaves stateDir unset', () => {
    // The measured defect: the schema default used to be the resolved home, so
    // `apply` always pinned it and this variable could never take effect.
    process.env['DSH_RULES_MANAGER_HOME'] = 'X:/from-env'
    const cfg = resolveConfig({})
    setStateDir(cfg.stateDir)
    expect(statePath().replace(/\\/g, '/')).toContain('from-env/state.json')
  })

  it('still lets an explicit config pin win over the variable', () => {
    process.env['DSH_RULES_MANAGER_HOME'] = 'X:/from-env'
    const cfg = resolveConfig({ stateDir: 'X:/from-config' })
    setStateDir(cfg.stateDir)
    expect(statePath().replace(/\\/g, '/')).toContain('from-config/state.json')
  })
})
