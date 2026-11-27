import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupBySource, optimistic } from '../src/client/group.ts'
import { installPanelStyles } from '../src/client/styles.ts'
import type { RuleRow, RuleSourceRow, RulesAction, RulesPayload } from '../src/panel.ts'

/**
 * The host-side states the client half has to survive.
 *
 * Each case here covers one arm the panel's own fixtures never take: a host
 * list that repeats a source key, a switch that must not revive what it does
 * not own, and a document with no head element.
 */

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  path: 'D:/repo/.codebuddy/rules/a.mdc', name: 'a', type: 'always', description: 'd',
  descriptionTokens: 1, bodyTokens: 2, bodyLength: 2, enabled: true, active: true, disabledBy: null,
  sourceKey: 'codebuddy', sourceLabel: 'CodeBuddy', scope: 'project',
  family: 'codebuddy', patterns: [], attached: false, diagnostics: [], ...over,
})

const source = (over: Partial<RuleSourceRow> = {}): RuleSourceRow => ({
  key: 'codebuddy', label: 'CodeBuddy', scope: 'project', path: 'D:/repo/.codebuddy/rules',
  enabled: true, ruleCount: 1, activeRuleCount: 1, ...over,
})

const payload = (rules: readonly RuleRow[], sources: readonly RuleSourceRow[]): RulesPayload => ({
  rules, sources, scannedAt: 1, workspace: { path: 'D:/repo', source: 'last-scan' }, entryLocation: 'both',
})

describe('groupBySource — a host list that repeats a key', () => {
  it('keeps one group per key and scope, not one per listed entry', () => {
    // The host may publish the same root twice; a second group with the same id
    // would render two switches for one source and let them disagree.
    const groups = groupBySource(
      [rule()],
      [source(), source({ path: 'D:/repo/.codebuddy/rules' }), source({ scope: 'user' })],
    )
    expect(groups.map((group) => group.key)).toEqual(['project:codebuddy', 'user:codebuddy'])
    expect(groups[0]?.rules).toHaveLength(1)
    expect(groups[1]?.rules).toHaveLength(0)
  })
})

describe('optimistic — switching a source back on', () => {
  const action: RulesAction = { action: 'setSource', key: 'codebuddy', enabled: true }

  it('keeps a rule this panel switched off switched off', () => {
    const next = optimistic(payload([rule({ active: false, disabledBy: 'state' })], [source()]), action)
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('state')
  })

  it('treats a rule the file never enables as held off by the file', () => {
    // Switching the source back on reads only the three reasons it knows; a
    // rule that nothing enables falls back to the file's own switch.
    const next = optimistic(payload([rule({ active: false, enabled: false, disabledBy: 'source' })], [source()]), action)
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('frontmatter')
  })

  it('marks the rules of a source that is switched off as held off by it', () => {
    const off: RulesAction = { action: 'setSource', key: 'codebuddy', enabled: false }
    const next = optimistic(payload([rule()], [source()]), off)
    expect(next.sources[0]?.enabled).toBe(false)
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('source')
  })

  it('restores an enabled rule that nothing was holding off', () => {
    const next = optimistic(payload([rule({ active: false, disabledBy: null })], [source()]), action)
    expect(next.rules[0]?.active).toBe(true)
    expect(next.rules[0]?.disabledBy).toBe(null)
  })

  it('keeps a file that disables itself off', () => {
    const next = optimistic(payload([rule({ active: false, enabled: false, disabledBy: 'frontmatter' })], [source()]), action)
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('frontmatter')
  })
})

describe('optimistic — switching a rule back on', () => {
  const action: RulesAction = { action: 'setRule', key: 'codebuddy', path: 'D:/repo/.codebuddy/rules/a.mdc', enabled: true }

  it('keeps a rule its source had switched off switched off', () => {
    const next = optimistic(payload([rule({ active: false, enabled: true, disabledBy: 'source' })], [source()]), action)
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('source')
  })

  it('restores a rule nothing but this panel had switched off', () => {
    const next = optimistic(payload([rule({ active: false, enabled: true, disabledBy: 'state' })], [source()]), action)
    expect(next.rules[0]?.active).toBe(true)
    expect(next.rules[0]?.disabledBy).toBe(null)
  })

  it('keeps a rule the file itself disables off', () => {
    const next = optimistic(payload([rule({ active: false, enabled: false, disabledBy: null })], [source()]), action)
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('frontmatter')
  })
})

describe('installPanelStyles — a document without a head', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('appends the style element to the root element instead', () => {
    // A document stand-in with no head: the append has to fall back to
    // documentElement rather than throwing the stylesheet away, or a panel in
    // that document renders unstyled.
    const atRoot: Array<{ id?: string; textContent?: string }> = []
    const doc = {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      documentElement: { appendChild: (element: { id?: string; textContent?: string }) => { atRoot.push(element) } },
    }
    vi.stubGlobal('document', doc)

    installPanelStyles()

    expect(atRoot).toHaveLength(1)
    expect(atRoot[0]?.id).toBe('dsh-rules-manager-style')
  })
})
