import { describe, expect, it } from 'vitest'
import { CATALOG_PROJECT_TOTAL_MAX, CATALOG_USER_TOTAL_MAX, costOfRule, costOfRules } from '../src/cost.ts'
import { renderRulesBlock } from '../src/render.ts'
import { estimateTokens } from '../src/token-count.ts'
import type { CostLine, CostReport, CostRule } from '../src/cost.ts'
import type { Rule } from '../src/types.ts'

const PROJECT = '/repo'
const HOME = '/home/me'

/** A panel-side rule: the handful of numbers `RuleRow` can produce. */
function costRule(over: Partial<CostRule> & Pick<CostRule, 'name' | 'type'>): CostRule {
  const base: CostRule = {
    path: `/repo/.codebuddy/rules/${over.name}.mdc`,
    name: over.name,
    type: over.type,
    active: over.active ?? true,
    description: over.description ?? '',
    descriptionTokens: over.descriptionTokens ?? 1,
    bodyTokens: over.bodyTokens ?? 1,
    bodyLength: over.bodyLength ?? 4,
  }
  return { ...base, ...over }
}

/** The same rule again, but as the host half sees it before rendering. */
function hostRule(over: Partial<Rule> & Pick<Rule, 'name' | 'type'>): Rule {
  return {
    path: over.path ?? `/repo/.codebuddy/rules/${over.name}.mdc`,
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
}

function lineAt(report: CostReport, index: number): CostLine {
  const line = report.lines[index]
  if (line === undefined) throw new Error(`expected a line at ${index}`)
  return line
}

/** The injected catalog row, written out by hand so it is an independent oracle. */
function rowText(path: string, description: string): string {
  return `- ${path}: ${description}`
}

describe('costOfRules — what each type really costs', () => {
  it('charges an always-on rule its body and never its description', () => {
    // The host injects the body alone for this bucket, so a description that
    // never reaches the prompt must not appear in the resident total.
    const r = costRule({ name: 'discipline', type: 'always', bodyTokens: 42, descriptionTokens: 999 })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).resident).toBe(42)
    expect(report.resident).toBe(42)
    expect(report.onDemand).toBe(0)
  })

  it('charges a requested rule the tokens of its own catalog line, plus the body on demand', () => {
    const r = costRule({ name: 'a', type: 'requested', description: 'when editing TS', descriptionTokens: 999, bodyTokens: 300 })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).resident).toBe(estimateTokens(rowText(r.path, 'when editing TS')))
    expect(lineAt(report, 0).onDemand).toBe(300)
    expect(report.resident).toBe(lineAt(report, 0).resident)
    expect(report.onDemand).toBe(300)
  })

  it('charges a manual rule nothing at all, because no path reaches it', () => {
    // render.ts:44 partitions manual rules out of the prompt, and the host's
    // requestable index only holds `requested` rules, so `read_rules` cannot
    // return this body either. Counting it as "on demand" would promise tokens
    // that are never spent.
    const r = costRule({ name: 'seldom', type: 'manual', bodyTokens: 120 })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).resident).toBe(0)
    expect(lineAt(report, 0).onDemand).toBe(0)
    expect(report.resident).toBe(0)
    expect(report.onDemand).toBe(0)
  })

  it('zeroes every figure for a rule that is not active, but still lists it', () => {
    const r = costRule({ name: 'off', type: 'always', active: false, bodyTokens: 50 })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0)).toMatchObject({ active: false, resident: 0, onDemand: 0, truncated: false, omitted: false })
    expect(report.lines).toHaveLength(1)
    expect(report).toMatchObject({ resident: 0, onDemand: 0, truncated: [], omitted: [] })
  })

  it('keeps every line in input order and sums them', () => {
    const rules = [
      costRule({ name: 'a', type: 'always', bodyTokens: 11 }),
      costRule({ name: 'b', type: 'requested', description: 'd', bodyTokens: 9 }),
      costRule({ name: 'c', type: 'manual', bodyTokens: 3 }),
    ]
    const report = costOfRules(rules, PROJECT)
    expect(report.lines.map((l) => l.name)).toEqual(['a', 'b', 'c'])
    expect(report.lines.map((l) => l.key)).toEqual(rules.map((r) => r.path))
    expect(report.resident).toBe(11 + estimateTokens(rowText(rules[1]?.path ?? '', 'd')) + 0)
    expect(report.onDemand).toBe(0 + 9 + 0)
  })
})

describe('costOfRule — the single-rule view', () => {
  it('never reports a rule as omitted, because nothing precedes it', () => {
    const r = costRule({ name: 'a', type: 'always', bodyLength: 9000 })
    expect(costOfRule(r, PROJECT).omitted).toBe(false)
  })

  it('agrees with the report it feeds', () => {
    const rules = [costRule({ name: 'a', type: 'always', bodyTokens: 5 }), costRule({ name: 'b', type: 'manual', bodyTokens: 7 })]
    const report = costOfRules(rules, PROJECT)
    expect(report.lines).toEqual(rules.map((r) => costOfRule(r, PROJECT)))
  })
})

describe('costOfRules — the two tiers', () => {
  it('calls a rule under the project root project-scoped and anything else user-scoped', () => {
    const inside = costRule({ name: 'in', type: 'always' })
    const outside = costRule({ name: 'out', type: 'always', path: `${HOME}/.codebuddy/rules/out.mdc` })
    const report = costOfRules([inside, outside], PROJECT)
    expect(lineAt(report, 0).scope).toBe('project')
    expect(lineAt(report, 1).scope).toBe('user')
  })

  it('treats every rule as user-scoped when there is no project root', () => {
    const report = costOfRules([costRule({ name: 'a', type: 'always' })], null)
    expect(lineAt(report, 0).scope).toBe('user')
  })
})

describe('costOfRules — budgets', () => {
  it('marks an always-on body past the per-rule cap as truncated', () => {
    const r = costRule({ name: 'huge', type: 'always', bodyLength: 9000, bodyTokens: 2000 })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).truncated).toBe(true)
    expect(report.truncated).toEqual([r.path])
  })

  it('leaves a body exactly at the cap alone', () => {
    const r = costRule({ name: 'edge', type: 'always', bodyLength: 8000 })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).truncated).toBe(false)
    expect(report.truncated).toEqual([])
  })

  it('charges the tier in characters, not tokens', () => {
    // Two 4000-character bodies cost 6000 tokens between them, well under any
    // token budget — but the host's cap counts characters, so the second is
    // dropped anyway.
    const rules = [
      costRule({ name: 'a', type: 'always', bodyLength: 4000, bodyTokens: 3000, path: `${HOME}/a.mdc` }),
      costRule({ name: 'b', type: 'always', bodyLength: 4000, bodyTokens: 3000, path: `${HOME}/b.mdc` }),
    ]
    const report = costOfRules(rules, PROJECT)
    expect(lineAt(report, 1).omitted).toBe(true)
  })

  it('drops a whole rule past the tier total and does not charge the budget for it', () => {
    // 4000 + 4000 breaks the user cap of 6000, so the second rule is omitted —
    // and because it is dropped whole, the third rule still fits afterwards.
    const rules = [
      costRule({ name: 'a', type: 'always', bodyLength: 4000, bodyTokens: 1000, path: `${HOME}/a.mdc` }),
      costRule({ name: 'b', type: 'always', bodyLength: 4000, bodyTokens: 1000, path: `${HOME}/b.mdc` }),
      costRule({ name: 'c', type: 'always', bodyLength: 1000, bodyTokens: 250, path: `${HOME}/c.mdc` }),
    ]
    const report = costOfRules(rules, PROJECT)
    expect(lineAt(report, 0).omitted).toBe(false)
    expect(lineAt(report, 1).omitted).toBe(true)
    expect(lineAt(report, 1).resident).toBe(0)
    expect(lineAt(report, 2).omitted).toBe(false)
    expect(report.omitted).toEqual([rules[1]?.path])
    expect(report.resident).toBe(1000 + 250)
  })

  it('keeps the user and project budgets independent', () => {
    const rules = [
      costRule({ name: 'u1', type: 'always', bodyLength: 4000, path: `${HOME}/u1.mdc` }),
      costRule({ name: 'u2', type: 'always', bodyLength: 4000, path: `${HOME}/u2.mdc` }),
      costRule({ name: 'p1', type: 'always', bodyLength: 4000 }),
      costRule({ name: 'p2', type: 'always', bodyLength: 4000, path: `${PROJECT}/.codebuddy/rules/p2.mdc` }),
    ]
    const report = costOfRules(rules, PROJECT)
    // User: 4000 kept, the second exceeds 6000. Project: 8000 is still under 12000.
    expect(lineAt(report, 1).omitted).toBe(true)
    expect(lineAt(report, 3).omitted).toBe(false)
    expect(report.omitted).toEqual([rules[1]?.path])
  })

  it('lets overrides replace the per-rule cap and both tier totals', () => {
    const rules = [
      costRule({ name: 'a', type: 'always', bodyLength: 50, path: `${HOME}/a.mdc` }),
      costRule({ name: 'b', type: 'always', bodyLength: 10, path: `${HOME}/b.mdc` }),
    ]
    const capped = costOfRules(rules, PROJECT, { perRuleMax: 10 })
    expect(lineAt(capped, 0).truncated).toBe(true)
    expect(lineAt(capped, 1).truncated).toBe(false)
    const tight = costOfRules(rules, PROJECT, { userTotal: 15 })
    // 50 characters alone is past a 15-character tier, so it is dropped whole —
    // and because a dropped rule charges nothing, the 10-char rule still fits.
    expect(tight.omitted).toEqual([rules[0]?.path])
    expect(lineAt(tight, 1).omitted).toBe(false)
    const roomy = costOfRules(rules, PROJECT, { userTotal: 60 })
    expect(roomy.omitted).toEqual([])
  })

  it('honours a project-total override', () => {
    const rules = [costRule({ name: 'p', type: 'always', bodyLength: 4000 })]
    expect(costOfRules(rules, PROJECT, { projectTotal: 100 }).omitted).toEqual([rules[0]?.path])
    expect(costOfRules(rules, PROJECT, { projectTotal: 8000 }).omitted).toEqual([])
  })

  it('exposes the host defaults', () => {
    expect(CATALOG_USER_TOTAL_MAX).toBe(6000)
    expect(CATALOG_PROJECT_TOTAL_MAX).toBe(12000)
  })
})

describe('costOfRules — a file-attached rule is billed as resident', () => {
  it('charges the body, not the catalog line, once the rule is attached', () => {
    // render.ts moves the rule into the always-on section, so the row cost
    // disappears while the whole body starts riding in every request. Billing
    // the row here would understate the prompt by the body's tokens.
    const r = costRule({ name: 'a', type: 'requested', description: 'when editing TS', bodyTokens: 300 })
    const plain = costOfRules([r], PROJECT)
    expect(lineAt(plain, 0).resident).toBe(estimateTokens(rowText(r.path, 'when editing TS')))
    expect(lineAt(plain, 0).onDemand).toBe(300)

    const attached = costOfRules([r], PROJECT, { attached: new Set([r.path]) })
    expect(lineAt(attached, 0).resident).toBe(300)
    expect(lineAt(attached, 0).onDemand).toBe(0)
  })

  it('drops the attached rule out of the catalog', () => {
    // The catalog is the scaffolding around the requestable rows. With the only
    // requestable rule attached there are no rows left, so there is no section
    // to scaffold — charging one would bill a section the host never renders.
    const r = costRule({ name: 'a', type: 'requested', description: 'when editing TS' })
    const plain = costOfRules([r], PROJECT)
    expect(plain.catalog).toBeGreaterThan(0)
    const attached = costOfRules([r], PROJECT, { attached: new Set([r.path]) })
    expect(attached.catalog).toBe(0)
    expect(attached.resident).toBe(r.bodyTokens)
    expect(attached.onDemand).toBe(0)
  })

  it('leaves an always-on rule and an unattached sibling alone', () => {
    const always = costRule({ name: 'w', type: 'always', bodyTokens: 11 })
    const requested = costRule({ name: 'r', type: 'requested', description: 'd', bodyTokens: 22 })
    const other = costRule({ name: 'o', type: 'requested', description: 'd', bodyTokens: 33 })
    const report = costOfRules([always, requested, other], PROJECT, { attached: new Set([requested.path]) })
    expect(lineAt(report, 0).resident).toBe(11)
    expect(lineAt(report, 1).resident).toBe(22)
    expect(lineAt(report, 2).onDemand).toBe(33)
    expect(report.catalog).toBeGreaterThan(0)
  })

  it('ignores an attachment for a rule that is not requestable', () => {
    // The set is a list of paths, so it can name anything; only a requested,
    // active rule can change bucket.
    const always = costRule({ name: 'w', type: 'always', bodyTokens: 11, description: 'd' })
    const manual = costRule({ name: 'm', type: 'manual', bodyTokens: 12 })
    const report = costOfRules([always, manual], PROJECT, { attached: new Set([always.path, manual.path]) })
    expect(lineAt(report, 0).resident).toBe(11)
    expect(lineAt(report, 1).resident).toBe(0)
    expect(lineAt(report, 1).onDemand).toBe(0)
  })

  it('still charges nothing for an attached rule that is switched off', () => {
    const off = costRule({ name: 'a', type: 'requested', active: false, description: 'd', bodyTokens: 40 })
    const report = costOfRules([off], PROJECT, { attached: new Set([off.path]) })
    expect(lineAt(report, 0).resident).toBe(0)
    expect(lineAt(report, 0).onDemand).toBe(0)
  })
})

describe('costOfRules — the catalog', () => {
  it('plus the per-rule rows is exactly the section the host renders', () => {
    // Cross-check against the renderer itself: the catalog is only the
    // scaffolding, so adding the row costs back must reproduce the section
    // verbatim, token for token.
    const rules = [
      costRule({ name: 'a', type: 'requested', description: 'when editing TS' }),
      costRule({ name: 'b', type: 'requested', description: 'when editing CSS' }),
    ]
    const report = costOfRules(rules, PROJECT)
    const block = renderRulesBlock(rules.map((r) => hostRule({ name: r.name, type: 'requested', description: r.description })), { projectRoot: PROJECT })
    const start = block.indexOf('<agent_requestable_workspace_rules')
    const end = block.lastIndexOf('</rules>')
    expect(start).toBeGreaterThan(-1)
    const section = block.slice(start, end)
    const rows = report.lines.reduce((sum, line) => sum + line.resident, 0)
    expect(report.catalog + rows).toBe(estimateTokens(section))
  })

  it('is zero when nothing is requestable', () => {
    const rules = [costRule({ name: 'a', type: 'always' }), costRule({ name: 'm', type: 'manual' })]
    expect(costOfRules(rules, PROJECT).catalog).toBe(0)
  })

  it('ignores requestable rules that are not active', () => {
    const rules = [costRule({ name: 'a', type: 'requested', active: false, description: 'd' })]
    expect(costOfRules(rules, PROJECT).catalog).toBe(0)
    expect(renderRulesBlock([hostRule({ name: 'a', type: 'requested', enabled: false, description: 'd' })], { projectRoot: PROJECT })).toBe('')
  })
})

describe('the catalog row — clamped and escaped', () => {
  it('escapes &, < and > in the description', () => {
    const r = costRule({ name: 'a', type: 'requested', description: 'a & b <c>' })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).resident).toBe(estimateTokens(rowText(r.path, 'a &amp; b &lt;c&gt;')))
  })

  it('escapes the path too', () => {
    const r = costRule({ name: 'a', type: 'requested', description: 'd', path: '/repo/a&b<c>.mdc' })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).resident).toBe(estimateTokens(rowText('/repo/a&amp;b&lt;c&gt;.mdc', 'd')))
  })

  it('collapses whitespace so a description cannot open a new row', () => {
    const r = costRule({ name: 'a', type: 'requested', description: 'first\n  second\tthird' })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).resident).toBe(estimateTokens(rowText(r.path, 'first second third')))
  })

  it('clamps a description to the 500-character catalog cap', () => {
    const long = 'x'.repeat(600)
    const r = costRule({ name: 'a', type: 'requested', description: long })
    const report = costOfRules([r], PROJECT)
    expect(lineAt(report, 0).resident).toBe(estimateTokens(rowText(r.path, `${'x'.repeat(497)}...`)))
  })
})

describe('costOfRules — an explicit scope beats the path prefix', () => {
  it('charges a rule to the tier the caller names, not the one its path implies', () => {
    // The panel's workspace need not be the host's project root, so a prefix
    // test can file a rule under the wrong tier. `scope` is the host's own
    // verdict from the scan root, and it has to win.
    const r = costRule({ name: 'a', type: 'always', bodyLength: 4000, scope: 'user' })
    expect(costOfRules([r], PROJECT, { userTotal: 100, projectTotal: 8000 }).omitted).toEqual([r.path])
    expect(costOfRules([r], PROJECT, { userTotal: 8000, projectTotal: 100 }).omitted).toEqual([])
  })

  it('reads one rule into either tier, 6000 characters apart', () => {
    // 7000 characters fits the 12000-character project tier and not the
    // 6000-character user tier, so the same rule lands differently by scope.
    const big = { name: 'big', type: 'always' as const, bodyLength: 7000 }
    const asUser = costRule({ ...big, scope: 'user' })
    const asProject = costRule({ ...big, scope: 'project' })
    expect(costOfRules([asUser], null).omitted).toEqual([asUser.path])
    expect(costOfRules([asProject], null).omitted).toEqual([])
    // 5000 characters is inside both, so only the crossing case differs.
    const smaller = costRule({ ...big, bodyLength: 5000, scope: 'user' })
    expect(costOfRules([smaller], null).omitted).toEqual([])
  })

  it('still infers the tier from the path when no scope is given', () => {
    const user = costRule({ name: 'u', type: 'always', bodyLength: 7000, path: `${HOME}/u.mdc` })
    const project = costRule({ name: 'p', type: 'always', bodyLength: 7000, path: `${PROJECT}/p.mdc` })
    expect(costOfRules([user], PROJECT).omitted).toEqual([user.path])
    expect(costOfRules([project], PROJECT).omitted).toEqual([])
    // With no project root at all, the same fallback makes everything user.
    expect(costOfRules([project], null).omitted).toEqual([project.path])
  })
})
