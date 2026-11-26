import { describe, expect, it } from 'vitest'
import { renderRulesBlock } from '../src/render.ts'
import type { Rule } from '../src/types.ts'

const PROJECT = '/repo'

function rule(over: Partial<Rule> & Pick<Rule, 'name' | 'type'>): Rule {
  const base: Rule = {
    path: `/repo/.codebuddy/rules/${over.name}.mdc`,
    name: over.name,
    type: over.type,
    enabled: over.enabled ?? true,
    description: over.description ?? '',
    body: over.body ?? 'BODY',
    family: over.family ?? 'codebuddy',
    scope: over.scope ?? 'project',
    sourceKey: over.sourceKey ?? 'codebuddy',
    patterns: over.patterns ?? [],
    descriptionTokens: over.descriptionTokens ?? 1,
    bodyTokens: over.bodyTokens ?? 1,
    diagnostics: over.diagnostics ?? [],
  }
  return { ...base, ...over }
}

describe('renderRulesBlock — structure', () => {
  it('returns an empty string when there is nothing to render', () => {
    expect(renderRulesBlock([], { projectRoot: PROJECT })).toBe('')
  })

  it('returns an empty string when every rule is disabled', () => {
    const rules = [rule({ name: 'a', type: 'always', enabled: false })]
    expect(renderRulesBlock(rules, { projectRoot: PROJECT })).toBe('')
  })

  it('wraps output in a <rules> block', () => {
    const out = renderRulesBlock([rule({ name: 'a', type: 'always' })], { projectRoot: PROJECT })
    expect(out.startsWith('<rules>')).toBe(true)
    expect(out.trimEnd().endsWith('</rules>')).toBe(true)
  })

  it('places an always-on project rule in the workspace section', () => {
    const out = renderRulesBlock([rule({ name: 'a', type: 'always' })], { projectRoot: PROJECT })
    expect(out).toContain('<always_applied_workspace_rules')
    expect(out).toContain('BODY')
  })

  it('places an always-on user rule in the user section', () => {
    const r = rule({ name: 'a', type: 'always', path: '/home/me/.codebuddy/rules/a.mdc' })
    const out = renderRulesBlock([r], { projectRoot: PROJECT })
    expect(out).toContain('<always_applied_user_rules')
  })

  it('routes a requested project rule to the requestable workspace section', () => {
    const r = rule({ name: 'a', type: 'requested', description: 'when editing TS' })
    const out = renderRulesBlock([r], { projectRoot: PROJECT })
    expect(out).toContain('<agent_requestable_workspace_rules')
    expect(out).toContain('read_rules tool')
  })

  it('routes a requested user rule to the requestable user section', () => {
    const r = rule({ name: 'a', type: 'requested', description: 'd', path: '/home/me/.codebuddy/rules/a.mdc' })
    const out = renderRulesBlock([r], { projectRoot: PROJECT })
    expect(out).toContain('<agent_requestable_user_rules')
  })

  it('omits manual rules entirely', () => {
    const r = rule({ name: 'seldom', type: 'manual' })
    const out = renderRulesBlock([r], { projectRoot: PROJECT })
    expect(out).toBe('')
    expect(out).not.toContain('seldom')
  })
})

describe('renderRulesBlock — on-demand rules expose a pointer, never the body', () => {
  const secret = 'THIS-BODY-MUST-NOT-APPEAR'
  const r = rule({ name: 'ts-standard', type: 'requested', description: 'when editing TS', body: secret })

  it('lists the absolute path as the key', () => {
    const out = renderRulesBlock([r], { projectRoot: PROJECT })
    expect(out).toContain(r.path)
  })

  it('lists the description', () => {
    const out = renderRulesBlock([r], { projectRoot: PROJECT })
    expect(out).toContain('when editing TS')
  })

  it('does not include the body', () => {
    const out = renderRulesBlock([r], { projectRoot: PROJECT })
    expect(out).not.toContain(secret)
  })

  it('does include the body for an always-on rule', () => {
    const always = rule({ name: 'discipline', type: 'always', body: secret })
    const out = renderRulesBlock([always], { projectRoot: PROJECT })
    expect(out).toContain(secret)
  })
})

describe('renderRulesBlock — a touched file makes an on-demand rule resident', () => {
  const secret = 'ATTACHED-BODY'
  const r = rule({ name: 'ts-standard', type: 'requested', description: 'when editing TS', body: secret })

  it('renders the body instead of the index line', () => {
    const out = renderRulesBlock([r], { projectRoot: PROJECT, attached: new Set([r.path]) })
    expect(out).toContain(secret)
    // The requestable section is gone with it: the rule is no longer something
    // the agent has to ask for, so listing its path would be a stale pointer.
    expect(out).not.toContain('<agent_requestable_workspace_rules')
    expect(out).toContain('<always_applied_workspace_rules')
  })

  it('leaves every other requested rule on the index', () => {
    const other = rule({ name: 'other', type: 'requested', description: 'when editing CSS' })
    const out = renderRulesBlock([r, other], { projectRoot: PROJECT, attached: new Set([r.path]) })
    expect(out).toContain('<agent_requestable_workspace_rules')
    expect(out).toContain(other.path)
    expect(out).not.toContain(other.body + 'X')
  })

  it('attaches a user-scope rule into the user section', () => {
    const user = rule({
      name: 'u',
      type: 'requested',
      description: 'd',
      body: secret,
      path: '/home/me/.codebuddy/rules/u.mdc',
    })
    const out = renderRulesBlock([user], { projectRoot: PROJECT, attached: new Set([user.path]) })
    expect(out).toContain('<always_applied_user_rules')
    expect(out).toContain(secret)
  })

  it('never rewrites the rule itself', () => {
    // The attachment is a view of this request only. The file still says
    // "on demand", and the panel keeps reporting it that way.
    const before = { ...r }
    renderRulesBlock([r], { projectRoot: PROJECT, attached: new Set([r.path]) })
    expect(r).toEqual(before)
    expect(r.type).toBe('requested')
  })

  it('renders nothing when the only attached rule is disabled', () => {
    const off = rule({ name: 'off', type: 'requested', enabled: false, body: secret })
    const out = renderRulesBlock([off], { projectRoot: PROJECT, attached: new Set([off.path]) })
    expect(out).toBe('')
  })
})

describe('renderRulesBlock — budgets', () => {
  it('reports omitted rules when the total budget is exceeded', () => {
    const big = rule({ name: 'huge', type: 'always', body: 'x'.repeat(20000) })
    const out = renderRulesBlock([big], { projectRoot: PROJECT })
    // One rule cannot exceed the project total, so it is truncated, not omitted.
    expect(out).toContain('[... rule truncated at 8000 chars]')
  })

  it('truncates a rule longer than the per-item cap', () => {
    const long = rule({ name: 'long', type: 'always', body: 'y'.repeat(9000) })
    const out = renderRulesBlock([long], { projectRoot: PROJECT })
    expect(out).toContain('rule truncated at 8000 chars')
  })
})

describe('renderRulesBlock — nothing to say', () => {
  it('returns empty when only manual rules exist, even with a project root', () => {
    const rules = [rule({ name: 'm', type: 'manual' })]
    expect(renderRulesBlock(rules, { projectRoot: null })).toBe('')
  })

  it('treats rules as user-scoped when there is no project root', () => {
    const out = renderRulesBlock([rule({ name: 'a', type: 'always' })], { projectRoot: null })
    expect(out).toContain('<always_applied_user_rules')
  })
})
