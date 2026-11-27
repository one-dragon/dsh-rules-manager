import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  applyTabs, disabledReasonKey, filterByScope, filterRules, format, groupBySource, noteKeyOf, optimistic,
  residentTokens, ruleCost, ruleSourceId, scopeIn, sortByCost, sourceId, sourceKeyOf, statusCounts, statusIn, statusOf,
  tabStep, totalResidentTokens,
} from '../src/client/group.ts'
import { BRAND_ICONS } from '../src/client/brand-icons.ts'
import { RuleItem, RulesPanel, ScanDiagnosticRow, TokenBreakdown, resolveText, TEXT, useRules } from '../src/client/index.tsx'
import { SOURCES } from '../src/scan.ts'
import type { RuleDiagnosticRow, RuleRow, RuleSourceRow } from '../src/panel.ts'

/**
 * Panel behavior: the grouping/sorting/filtering logic as pure functions, and
 * the rendered output as real markup.
 *
 * Rendering runs through `react-dom/server`, so the assertions are about what
 * the panel actually emits rather than about a shallow-mocked component.
 */

const NOOP = () => {}
const t = (key: string): string => TEXT.zh[key] ?? TEXT.en[key] ?? key

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  path: '/p/codebuddy/a.mdc',
  name: 'a',
  type: 'always',
  description: 'd',
  descriptionTokens: 10,
  bodyTokens: 100,
  // Characters, not tokens: only the budget (8000 per rule, 6000/12000 per
  // tier) is measured in characters, and the cost model needs both figures.
  bodyLength: 100,
  enabled: true,
  active: true,
  disabledBy: null,
  sourceKey: 'codebuddy',
  sourceLabel: 'CodeBuddy',
  scope: 'project',
  family: 'codebuddy',
  patterns: [],
  // Default false: only the host's attach pass can make a rule resident early.
  attached: false,
  diagnostics: [],
  ...over,
})

const source = (over: Partial<RuleSourceRow> = {}): RuleSourceRow => ({
  key: 'codebuddy',
  label: 'CodeBuddy',
  scope: 'project',
  path: 'D:/repo/.codebuddy/rules',
  enabled: true,
  ruleCount: 1,
  activeRuleCount: 1,
  ...over,
})

const render = (
  rules: readonly RuleRow[],
  sources: readonly RuleSourceRow[] = [source()],
  over: {
    readonly state?: 'loading' | 'ready' | 'failed'
    readonly error?: string | null
    readonly scanDiagnostics?: readonly RuleDiagnosticRow[]
    readonly truncated?: boolean
  } = {},
) =>
  renderToStaticMarkup(
    <RulesPanel
      ctx={undefined as never}
      t={t}
      rules={rules}
      sources={sources}
      workspace={{ path: '/p', source: 'last-scan' }}
      state={over.state ?? 'ready'}
      onRetry={NOOP}
      onToggleRule={NOOP}
      onToggleSource={NOOP}
      pending={[]}
      error={over.error ?? null}
      scanDiagnostics={over.scanDiagnostics ?? []}
      truncated={over.truncated ?? false}
    />,
  )

describe('the scan findings above the cards', () => {
  const findings: readonly RuleDiagnosticRow[] = [
    { code: 'scan.unreadable', detail: '无法读取目录：D:/repo/.cline/rules', kind: 'scan', key: 'project:cline' },
  ]

  it('states the count and keeps the details one click away', () => {
    // A dozen skipped files must not push the rules off screen, but the count
    // alone never said which file or which field.
    const out = render([rule()], [source()], { scanDiagnostics: findings })
    expect(out).toContain('dshrm-scan-note')
    expect(out).toContain(format(TEXT.zh['scanDiagnostics']!, { n: 1 }))
    expect(out).toContain('dshrm-scan-diag')
    expect(out).toContain('无法读取目录：D:/repo/.cline/rules')
  })

  it('renders nothing when the walk was clean', () => {
    const out = render([rule()])
    expect(out).not.toContain('dshrm-scan-note')
    expect(out).not.toContain('dshrm-scan-diag')
  })

  it('still says the list may be short when a cap was hit', () => {
    const out = render([rule()], [source()], { truncated: true })
    expect(out).toContain(TEXT.zh['scanTruncated']!)
    expect(out).not.toContain('dshrm-scan-diag')
  })
})

describe('statusOf — the four buckets', () => {
  it('maps an active rule to its declared type', () => {
    expect(statusOf(rule({ type: 'always' }))).toBe('always')
    expect(statusOf(rule({ type: 'requested' }))).toBe('requested')
    expect(statusOf(rule({ type: 'manual' }))).toBe('manual')
  })

  it('maps any inactive rule to the off bucket', () => {
    expect(statusOf(rule({ active: false, disabledBy: 'state' }))).toBe('off')
    expect(statusOf(rule({ active: false, enabled: false, disabledBy: 'frontmatter' }))).toBe('off')
    expect(statusOf(rule({ active: false, disabledBy: 'source' }))).toBe('off')
  })
})

describe('ruleCost — what actually stays in the prompt', () => {
  it('charges an attached on-demand rule as if it were always on', () => {
    // The host moved it into the always-on section, so the catalog line is gone
    // and the body is in every request. Reading type alone would print the old
    // row price for a rule that now costs its whole body.
    expect(ruleCost(rule({ type: 'requested', attached: true, descriptionTokens: 10, bodyTokens: 100 })))
      .toEqual({ resident: 100, onDemand: 0 })
  })

  it('charges an always-on rule for its body only', () => {
    // render.ts injects \`rule.body\` for this bucket and never the description,
    // so adding descriptionTokens here (as this once did) overstated it.
    expect(ruleCost(rule({ type: 'always', descriptionTokens: 10, bodyTokens: 100 })))
      .toEqual({ resident: 100, onDemand: 0 })
  })

  it('charges an on-demand rule for its whole catalog line', () => {
    // The resident half is the line render.ts really writes —
    // \`- /p/codebuddy/a.mdc: d\` — not the description alone: the absolute path
    // is the key the agent passes back, and it is usually the longer half.
    expect(ruleCost(rule({ type: 'requested', descriptionTokens: 10, bodyTokens: 100 })))
      .toEqual({ resident: 12, onDemand: 100 })
  })

  it('charges a manual rule nothing at all', () => {
    // Nothing injects it: not the render block, not the requestable index. The
    // old figure called its body "on demand" and promised a load no agent path
    // can trigger.
    expect(ruleCost(rule({ type: 'manual', descriptionTokens: 10, bodyTokens: 100 })))
      .toEqual({ resident: 0, onDemand: 0 })
  })

  it('charges a disabled rule nothing, whatever its type', () => {
    for (const type of ['always', 'requested', 'manual'] as const) {
      expect(ruleCost(rule({ type, active: false, disabledBy: 'state' }))).toEqual({ resident: 0, onDemand: 0 })
    }
  })

  it('sums the resident part and the fixed scaffolding', () => {
    const rows = [
      rule({ type: 'always', descriptionTokens: 10, bodyTokens: 100 }),
      rule({ type: 'requested', descriptionTokens: 5, bodyTokens: 50, path: '/p/b' }),
      rule({ type: 'manual', descriptionTokens: 1, bodyTokens: 1, path: '/p/c' }),
      rule({ type: 'always', active: false, disabledBy: 'state', bodyTokens: 999, path: '/p/d' }),
    ]
    // 100 (the always body) + 7 (the one catalog line, \`- /p/b: d\`) + 101 (the
    // section's fixed tags and preamble). The scaffolding belongs to no single
    // rule, so no row shows it, but every request pays it; leaving it out made
    // the panel's total an upper bound that no real request matched.
    expect(totalResidentTokens(rows)).toBe(208)
  })

  it('keeps the legacy description-only figure intact', () => {
    // Pre-existing behavior; a test pins it, so it must not drift.
    expect(residentTokens([rule({ type: 'always', descriptionTokens: 10, bodyTokens: 100 })])).toBe(10)
  })
})

describe('filterRules — search', () => {
  const rows = [
    rule({ name: 'Discipline', path: '/p/a', description: 'keep diffs small' }),
    rule({ name: 'ts-standard', path: '/p/.cursor/rules/b.mdc', description: 'when editing TS' }),
  ]

  it('returns everything for an empty or blank query', () => {
    expect(filterRules(rows, '').length).toBe(2)
    expect(filterRules(rows, '   ').length).toBe(2)
  })

  it('matches name case-insensitively', () => {
    expect(filterRules(rows, 'DISCIP').map((r) => r.name)).toEqual(['Discipline'])
  })

  it('matches description', () => {
    expect(filterRules(rows, 'diffs').map((r) => r.name)).toEqual(['Discipline'])
  })

  it('matches the path, so a half-remembered location still finds the rule', () => {
    expect(filterRules(rows, '.cursor').map((r) => r.name)).toEqual(['ts-standard'])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterRules(rows, 'zzz')).toEqual([])
  })
})

describe('applyTabs — scope and status', () => {
  const rows = [
    rule({ name: 'u', scope: 'user', path: '/p/u' }),
    rule({ name: 'p', scope: 'project', path: '/p/p' }),
    rule({ name: 'off', scope: 'project', active: false, disabledBy: 'state', path: '/p/o' }),
  ]

  it('filters by scope', () => {
    expect(applyTabs(rows, 'user', 'all').map((r) => r.name)).toEqual(['u'])
    expect(applyTabs(rows, 'project', 'all').map((r) => r.name)).toEqual(['p', 'off'])
  })

  it('filters by status', () => {
    expect(applyTabs(rows, 'all', 'off').map((r) => r.name)).toEqual(['off'])
    expect(applyTabs(rows, 'all', 'always').map((r) => r.name)).toEqual(['u', 'p'])
  })

  it('combines both', () => {
    expect(applyTabs(rows, 'project', 'always').map((r) => r.name)).toEqual(['p'])
    expect(applyTabs(rows, 'user', 'off')).toEqual([])
  })

  it('counts each bucket, including off', () => {
    expect(statusCounts(rows)).toEqual({ always: 2, requested: 0, manual: 0, off: 1 })
  })
})

// The two axes run as separate steps because *every number the panel prints*
// describes the rows the tabs leave on screen. The reported bug: switching to
// 全局 emptied the list while the stat bar still read "14" and every status tab
// still counted the project's rules, so the tab looked like it did nothing.
describe('scope-aware counts', () => {
  const rows = [
    rule({ name: 'p1', scope: 'project', path: '/p/p1', type: 'always' }),
    rule({ name: 'p2', scope: 'project', path: '/p/p2', type: 'requested', descriptionTokens: 7, bodyTokens: 70 }),
    rule({ name: 'u1', scope: 'user', sourceKey: 'cursor', path: '/u/u1', type: 'manual', bodyTokens: 30 }),
  ]

  it('narrows by scope, leaving the status axis alone', () => {
    expect(scopeIn(rows, 'all')).toBe(rows)
    expect(scopeIn(rows, 'user').map((r) => r.name)).toEqual(['u1'])
    expect(scopeIn(rows, 'project').map((r) => r.name)).toEqual(['p1', 'p2'])
  })

  it('narrows by status, leaving the scope axis alone', () => {
    expect(statusIn(rows, 'all')).toBe(rows)
    expect(statusIn(rows, 'requested').map((r) => r.name)).toEqual(['p2'])
  })

  it('agrees with applyTabs on every pair of tabs', () => {
    for (const scope of ['all', 'user', 'project'] as const) {
      for (const status of ['all', 'always', 'requested', 'manual', 'off'] as const) {
        expect(scopeIn(statusIn(rows, status), scope).map((r) => r.path))
          .toEqual(applyTabs(rows, scope, status).map((r) => r.path))
      }
    }
  })

  it('zeroes the counts, the cost and the dropdown when the tier is empty', () => {
    const inScope = scopeIn(rows, 'user')
    // Same numbers the panel feeds to the stat bar, the tab labels and the
    // source dropdown.
    expect(inScope.length).toBe(1)
    expect(statusCounts(inScope)).toEqual({ always: 0, requested: 0, manual: 1, off: 0 })
    expect(totalResidentTokens(inScope)).toBe(0)
    const project = scopeIn(rows, 'project')
    expect(statusCounts(project)).toEqual({ always: 1, requested: 1, manual: 0, off: 0 })
    // 100 (p1's body; its description is not injected) + 7 (p2's catalog line)
    // + 101 (the requestable section's fixed scaffolding).
    expect(totalResidentTokens(project)).toBe(208)
  })
})

describe('sortByCost', () => {
  it('puts the most expensive resident rule first', () => {
    const rows = [
      rule({ name: 'cheap', type: 'manual', bodyTokens: 500, path: '/p/1' }),
      rule({ name: 'pricey', type: 'always', descriptionTokens: 5, bodyTokens: 900, path: '/p/2' }),
      rule({ name: 'mid', type: 'requested', descriptionTokens: 20, path: '/p/3' }),
    ]
    expect(sortByCost(rows).map((r) => r.name)).toEqual(['pricey', 'mid', 'cheap'])
  })

  it('breaks ties on name, so the order is stable', () => {
    const rows = [
      rule({ name: 'b', type: 'always', descriptionTokens: 1, bodyTokens: 1, path: '/p/b' }),
      rule({ name: 'a', type: 'always', descriptionTokens: 1, bodyTokens: 1, path: '/p/a' }),
    ]
    expect(sortByCost(rows).map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const rows = [rule({ name: 'x', path: '/p/x' }), rule({ name: 'a', path: '/p/a' })]
    sortByCost(rows)
    expect(rows.map((r) => r.name)).toEqual(['x', 'a'])
  })
})

describe('groupBySource', () => {
  it('groups by source and scope, keeping the host order', () => {
    const rows = [
      rule({ name: 'cb', sourceKey: 'codebuddy', scope: 'project', path: '/p/1' }),
      rule({ name: 'cur', sourceKey: 'cursor', sourceLabel: 'Cursor', scope: 'project', path: '/p/2' }),
    ]
    const sources = [
      source({ key: 'codebuddy', label: 'CodeBuddy', scope: 'project', path: 'D:/repo/.codebuddy/rules' }),
      source({ key: 'cursor', label: 'Cursor', scope: 'project', path: 'D:/repo/.cursor/rules' }),
    ]
    const groups = groupBySource(rows, sources)
    expect(groups.map((g) => g.label)).toEqual(['CodeBuddy', 'Cursor'])
    expect(groups.map((g) => g.rules.length)).toEqual([1, 1])
  })

  it('carries the real absolute path from the host', () => {
    // The user's core complaint: which directory did this rule come from?
    const groups = groupBySource([rule()], [source({ path: 'C:/Users/me/.cursor/rules', label: 'Cursor' })])
    expect(groups[0]?.path).toBe('C:/Users/me/.cursor/rules')
  })

  it('keeps a source that has no matching rule, so its switch stays reachable', () => {
    const groups = groupBySource([], [source({ key: 'claude', label: 'Claude Code', path: 'D:/repo/.claude/rules' })])
    expect(groups.length).toBe(1)
    expect(groups[0]?.rules).toEqual([])
    expect(groups[0]?.path).toBe('D:/repo/.claude/rules')
  })

  it('treats the same key in two scopes as two groups', () => {
    const rows = [
      rule({ name: 'u', sourceKey: 'codebuddy', scope: 'user', path: '/home/me/.codebuddy/rules/u.mdc' }),
      rule({ name: 'p', sourceKey: 'codebuddy', scope: 'project', path: '/repo/.codebuddy/rules/p.mdc' }),
    ]
    const sources = [
      source({ key: 'codebuddy', scope: 'user', path: 'C:/Users/me/.codebuddy/rules' }),
      source({ key: 'codebuddy', scope: 'project', path: 'D:/repo/.codebuddy/rules' }),
    ]
    const groups = groupBySource(rows, sources)
    expect(groups.length).toBe(2)
    expect(groups.map((g) => g.rules.length)).toEqual([1, 1])
  })

  it('still shows a rule whose source the host did not report', () => {
    const groups = groupBySource([rule({ sourceKey: 'mystery', sourceLabel: 'Mystery' })], [])
    expect(groups.length).toBe(1)
    expect(groups[0]?.label).toBe('Mystery')
    expect(groups[0]?.path).toBe('')
  })
})

// The reported bug: switching to 全局 left the project's source cards on screen.
// They survived as empty "0 rules" groups because the unscoped host list reached
// groupBySource, and the dropdown mixed the two tiers' identical keys.
describe('scope-aware source lists', () => {
  it('drops the other tier when a scope tab is selected', () => {
    const sources = [
      source({ key: 'codebuddy', scope: 'project', path: 'D:/repo/.codebuddy/rules' }),
      source({ key: 'cursor', scope: 'user', path: 'C:/Users/me/.cursor/rules' }),
    ]
    expect(filterByScope(sources, 'all')).toHaveLength(2)
    expect(filterByScope(sources, 'project').map((s) => s.path)).toEqual(['D:/repo/.codebuddy/rules'])
    expect(filterByScope(sources, 'user').map((s) => s.path)).toEqual(['C:/Users/me/.cursor/rules'])
  })

  it('recovers the bare source key from a scoped group id', () => {
    expect(sourceKeyOf('user:codebuddy')).toBe('codebuddy')
    expect(sourceKeyOf('project:codebuddy')).toBe('codebuddy')
    // A group the host never scoped stays as it is, rather than losing a prefix.
    expect(sourceKeyOf('codebuddy')).toBe('codebuddy')
  })

  it('scopes an id so one key in two tiers stays two sources', () => {
    expect(sourceId(source({ key: 'codebuddy', scope: 'user' }))).toBe('user:codebuddy')
    expect(sourceId(source({ key: 'codebuddy', scope: 'project' }))).toBe('project:codebuddy')
    expect(ruleSourceId(rule({ sourceKey: 'codebuddy', scope: 'project' }))).toBe('project:codebuddy')
    expect(ruleSourceId(rule({ sourceKey: 'codebuddy', scope: 'user' }))).not.toBe(
      ruleSourceId(rule({ sourceKey: 'codebuddy', scope: 'project' })),
    )
  })
})

describe('explanations', () => {
  it('names the layer that switched a rule off', () => {
    expect(disabledReasonKey(rule())).toBe(null)
    expect(disabledReasonKey(rule({ active: false, enabled: false, disabledBy: 'frontmatter' }))).toBe('offReason.frontmatter')
    expect(disabledReasonKey(rule({ active: false, disabledBy: 'state' }))).toBe('offReason.state')
    expect(disabledReasonKey(rule({ active: false, disabledBy: 'source' }))).toBe('offReason.source')
  })

  it('explains the cost model per state', () => {
    expect(noteKeyOf(rule({ type: 'always' }))).toBe('note.always')
    expect(noteKeyOf(rule({ type: 'requested' }))).toBe('note.requested')
    expect(noteKeyOf(rule({ type: 'manual' }))).toBe('note.manual')
    expect(noteKeyOf(rule({ active: false, disabledBy: 'state' }))).toBe('note.off')
  })

  it('explains why an on-demand rule is resident anyway', () => {
    // The file still says "on demand"; without this note the row would read as
    // a contradiction — an on-demand rule that is already in the prompt.
    expect(noteKeyOf(rule({ type: 'requested', attached: true }))).toBe('note.attached')
  })

  it('keeps the switched-off note for an attached rule that is disabled', () => {
    // Being attached cannot resurrect a rule the source or the user switched
    // off: render.ts drops those, so the row must not claim they are resident.
    expect(noteKeyOf(rule({ type: 'requested', attached: true, active: false, disabledBy: 'state' })))
      .toBe('note.off')
  })

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(format('{a} and {b}', { a: 1 })).toBe('1 and {b}')
  })

  it('has an explanation string for every state in both languages', () => {
    for (const key of ['note.always', 'note.requested', 'note.manual', 'note.off', 'note.attached',
      'offReason.frontmatter', 'offReason.state', 'offReason.source', 'tokenNote']) {
      expect(TEXT.en[key], key).toBeTruthy()
      expect(TEXT.zh[key], key).toBeTruthy()
    }
  })
})

describe('tabs keyboard', () => {
  it('walks left and right, wrapping at both ends', () => {
    expect(tabStep('ArrowRight', 0, 3)).toBe(1)
    expect(tabStep('ArrowRight', 2, 3)).toBe(0)
    expect(tabStep('ArrowLeft', 0, 3)).toBe(2)
    expect(tabStep('ArrowLeft', 1, 3)).toBe(0)
  })

  it('jumps to the first and the last tab', () => {
    expect(tabStep('Home', 2, 5)).toBe(0)
    expect(tabStep('End', 1, 5)).toBe(4)
  })

  it('leaves every other key to the browser', () => {
    for (const key of ['Enter', 'Space', 'Tab', 'a', 'ArrowUp', 'ArrowDown', 'Escape']) {
      expect(tabStep(key, 1, 3), key).toBe(null)
    }
  })

  it('answers nothing for an empty list or a position outside it', () => {
    expect(tabStep('ArrowRight', 0, 0)).toBe(null)
    expect(tabStep('ArrowRight', -1, 3)).toBe(null)
  })
})

describe('rendered panel', () => {
  it('shows each source group with its real absolute path', () => {
    const html = render([rule({ name: 'discipline' })])
    expect(html).toContain('CodeBuddy')
    expect(html).toContain('D:/repo/.codebuddy/rules')
  })

  it('wires both tablists to the one region they filter', () => {
    const html = render([rule({ name: 'a' })])
    // Scope (2) and status (5) tabs all control the same panel body. The ids use
    // the plugin id, not the dshrm- class prefix.
    const controls = (html.match(/aria-controls="dsh-rules-manager-panel-body"/g) ?? []).length
    expect(controls).toBe(7)
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('id="dsh-rules-manager-panel-body"')
    // The panel is named by whichever two tabs are selected, and every tab has an
    // id for that name to point at.
    expect(html).toMatch(/aria-labelledby="dsh-rules-manager-scope-tab-[a-z]+ dsh-rules-manager-status-tab-[a-z]+"/)
    expect((html.match(/id="dsh-rules-manager-scope-tab-/g) ?? []).length).toBe(2)
    expect((html.match(/id="dsh-rules-manager-status-tab-/g) ?? []).length).toBe(5)
    // One tab stop per tablist (APG roving tabindex); the rest are out of order.
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(2)
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(5)
    // Each tablist carries its own accessible name.
    expect(html).toContain('aria-label="范围"')
    expect(html).toContain('aria-label="状态"')
  })

  it('announces loading and failures instead of rendering them silently', () => {
    expect(render([], [source()], { state: 'loading' })).toContain('role="status"')
    expect(render([], [source()], { state: 'failed' })).toContain('role="alert"')
    // A failed write is announced the same way.
    expect(render([rule()], [source()], { error: 'boom' })).toContain('role="alert"')
  })

  it('renders the scope and status tabs with counts', () => {
    const html = render([
      rule({ name: 'a', path: '/p/a' }),
      rule({ name: 'b', active: false, disabledBy: 'state', path: '/p/b' }),
    ])
    expect(html).toContain('全局')
    expect(html).toContain('项目')
    expect(html).toContain('已停用（1）')
    // 'All' shows both, including the disabled one.
    expect(html).toContain('全部（2）')
  })

  it('drops the "all" scope tab and opens on the project tier', () => {
    // "All" listed both tiers while the workspace picker under it only moved the
    // project half, so it read as a second Project tab with a stray control.
    const html = render([
      rule({ name: 'a', path: '/p/a', scope: 'project' }),
      rule({ name: 'u', path: '/h/u', scope: 'user' }),
    ])
    expect(html).not.toContain('id="dsh-rules-manager-scope-tab-all"')
    expect(html).toContain('id="dsh-rules-manager-scope-tab-project"')
    // The default selection is project, and the project row is the one rendered.
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('/p/a')
    expect(html).not.toContain('/h/u')
  })

  it('renders a normal rule with its resident cost and note', () => {
    const html = render([rule({ type: 'requested', descriptionTokens: 7, bodyTokens: 70 })])
    // The row prints what its catalog line costs: path plus description.
    expect(html).toContain('≈12 token')
    expect(html).toContain(TEXT.zh['note.requested']!)
    expect(html).not.toContain('已停用 ——')
  })

  it('marks an attached rule resident without relabelling the file', () => {
    const html = render([rule({ type: 'requested', attached: true, descriptionTokens: 7, bodyTokens: 70 })])
    // The tag keeps naming the file's own state, and only the badge colour and
    // the note say why the body is in this request anyway.
    expect(html).toContain('按需加载')
    expect(html).toContain('is-attached')
    expect(html).toContain(TEXT.zh['note.attached']!)
    expect(html).toContain('≈70 token')
  })

  it('renders a frontmatter-disabled rule, still listed, explaining why', () => {
    const html = render([rule({ name: 'fm', enabled: false, active: false, disabledBy: 'frontmatter' })])
    expect(html).toContain('fm')
    expect(html).toContain('文件里写了 enabled: false')
  })

  it('renders a state-disabled rule with the panel reason, not "the file"', () => {
    const html = render([rule({ name: 'st', enabled: true, active: false, disabledBy: 'state' })])
    expect(html).toContain('在此处关闭')
    expect(html).not.toContain('文件里写了 enabled: false')
  })

  it('renders a source-disabled rule with the source reason', () => {
    const html = render([rule({ name: 'sr', active: false, disabledBy: 'source' })])
    expect(html).toContain('其来源已关闭')
  })

  it('offers an empty state rather than a blank panel', () => {
    expect(render([])).toContain(TEXT.zh['empty']!)
  })

  it('says so when the filters match nothing', () => {
    const html = render([rule()], [])
    expect(html).toContain('全部（1）')
    expect(html).not.toContain(TEXT.zh['noMatch']!)
  })
})

describe('the rule row', () => {
  const html = (rule: RuleRow, busy = false) => renderToStaticMarkup(
    <ul><RuleItem rule={rule} t={t} busy={busy} onToggle={NOOP} /></ul>,
  )

  it('shows the name and the path as a tooltip', () => {
    const out = html(rule({ name: 'named', path: '/p/named.mdc' }))
    expect(out).toContain('named')
    expect(out).toContain('/p/named.mdc')
  })

  it("shows a diagnostic's line and its meaning, not just a code", () => {
    // The code alone ("fm.emptyList: the list field is empty") never said which
    // field or where, and the line was parsed all along but never rendered.
    const out = html(rule({
      path: '/p/listed.mdc',
      diagnostics: [{ code: 'fm.emptyList', detail: '列表字段为空：globs', line: 4, kind: 'rule' }],
    }))
    expect(out).toContain('fm.emptyList')
    expect(out).toContain('列表字段为空：globs')
    expect(out).toContain('dshrm-diag-line')
    expect(out).toContain('第 4 行')
    expect(out).toContain('dshrm-diag-help')
    expect(out).toContain(TEXT.zh['diag.fm.emptyList']!)
  })

  it('degrades to the bare code for a code it has no explanation for', () => {
    // A host that learns a new code must not print a locale key at the user.
    const out = html(rule({ diagnostics: [{ code: 'brand.new', detail: 'd', kind: 'rule' }] }))
    expect(out).toContain('brand.new')
    expect(out).not.toContain('dshrm-diag-help')
    expect(out).not.toContain('dshrm-diag-line')
    expect(out).not.toContain('diag.brand.new')
  })

  it('keeps the field name, the line and the file on one scan finding', () => {
    // The number in the stat bar used to expand into a single sentence of
    // explanations joined by semicolons: "the field was declared but has no
    // entries" with no field, no line and no file. Everything here was already
    // parsed and carried — only the rendering threw it away.
    const out = renderToStaticMarkup(
      <ul>
        <ScanDiagnosticRow
          t={t}
          row={{ code: 'fm.emptyList', detail: '列表字段为空：globs', line: 4, kind: 'scan', path: 'D:/repo/.claude/rules/a.md' }}
        />
      </ul>,
    )
    expect(out).toContain('fm.emptyList')
    expect(out).toContain('列表字段为空：globs')
    expect(out).toContain('第 4 行')
    expect(out).toContain('D:/repo/.claude/rules/a.md')
    expect(out).toContain(TEXT.zh['diag.fm.emptyList']!)
  })

  it('does not print a path the detail already ended with', () => {
    // Per-file codes raise their detail as "<reason>：<path>"; printing the path
    // again would read as a second finding at the same place.
    const out = renderToStaticMarkup(
      <ul>
        <ScanDiagnosticRow
          t={t}
          row={{ code: 'classify.skipped', detail: '没有可识别的规则字段：D:/repo/notes.md', kind: 'scan', path: 'D:/repo/notes.md' }}
        />
      </ul>,
    )
    expect(out.split('D:/repo/notes.md')).toHaveLength(2)
    expect(out).not.toContain('位于')
  })

  it('checks the switch only when the rule is active', () => {
    expect(html(rule({ active: true }))).toContain('checked=""')
    expect(html(rule({ active: false, disabledBy: 'state' }))).not.toContain('checked=""')
  })

  it('disables the switch when the file or the source owns the decision', () => {
    // Flipping these from here would be a lie: neither is ours to change.
    expect(html(rule({ active: false, enabled: false, disabledBy: 'frontmatter' }))).toContain('disabled=""')
    expect(html(rule({ active: false, disabledBy: 'source' }))).toContain('disabled=""')
    // A rule this panel turned off must stay switchable.
    expect(html(rule({ active: false, disabledBy: 'state' }))).not.toContain('disabled=""')
  })

  it('disables the switch while its write is in flight', () => {
    expect(html(rule({ active: true }), true)).toContain('disabled=""')
  })
})

describe('the entry location control', () => {
  const withControl = (over: Partial<Parameters<typeof RulesPanel>[0]>): string =>
    renderToStaticMarkup(
      <RulesPanel
        ctx={undefined as never}
        t={t}
        rules={[]}
        sources={[]}
        workspace={{ path: '/p', source: 'last-scan' }}
        state="ready"
        onRetry={NOOP}
        onToggleRule={NOOP}
        onToggleSource={NOOP}
        pending={[]}
        error={null}
        {...over}
      />,
    )

  it('renders no control at all when the panel cannot move the entry', () => {
    // The host that never wired the write path must not get a control whose
    // buttons do nothing: absence is the honest rendering, not a disabled row.
    const bare = withControl({})
    expect(bare).not.toContain('dshrm-entry')
  })

  it('marks exactly one location as pressed', () => {
    for (const location of ['settings', 'sidebar', 'both'] as const) {
      const html = withControl({ entryLocation: location, onSetEntryLocation: NOOP })
      expect(html).toContain('role="group"')
      // aria-pressed is the only selected-state signal: three buttons share the
      // class list, so counting the pressed one is what proves the choice shows.
      expect(html.split('aria-pressed="true"')).toHaveLength(2)
      expect(html.split('dshrm-entry-btn on')).toHaveLength(2)
    }
  })

  it('names the group and every button in the panel language', () => {
    const html = withControl({ entryLocation: 'both', onSetEntryLocation: NOOP })
    expect(html).toContain(t('entryLocation'))
    for (const key of ['entry.settings', 'entry.sidebar', 'entry.both']) expect(html).toContain(t(key))
    // A location whose label is missing would render its own key name.
    expect(t('entry.both')).not.toBe('entry.both')
  })

  it('disables the row while the write is in flight', () => {
    const html = withControl({ entryLocation: 'both', onSetEntryLocation: NOOP, entryPending: true })
    expect(html.split('disabled=""').length - 1).toBeGreaterThanOrEqual(3)
  })
})

describe('optimistic update', () => {
  const WS = { path: '/p', source: 'last-scan' as const }
  const base = { rules: [rule({ path: '/p/a.mdc' })], sources: [source()], scannedAt: 1, workspace: WS, entryLocation: 'both' as const }

  it('flips a rule off immediately', () => {
    const next = optimistic(base, { action: 'setRule', key: 'codebuddy', path: '/p/a.mdc', enabled: false })
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('state')
    // The file's own flag is untouched: only the panel's layer moved.
    expect(next.rules[0]?.enabled).toBe(true)
  })

  it('flips a rule back on', () => {
    const off = { ...base, rules: [rule({ path: '/p/a.mdc', active: false, disabledBy: 'state' as const })] }
    const next = optimistic(off, { action: 'setRule', key: 'codebuddy', path: '/p/a.mdc', enabled: true })
    expect(next.rules[0]?.active).toBe(true)
    expect(next.rules[0]?.disabledBy).toBe(null)
  })

  it('does not revive a rule the file itself disables', () => {
    const off = { ...base, rules: [rule({ path: '/p/a.mdc', enabled: false, active: false, disabledBy: 'frontmatter' as const })] }
    const next = optimistic(off, { action: 'setRule', key: 'codebuddy', path: '/p/a.mdc', enabled: true })
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('frontmatter')
  })

  it('applies a source switch to that source and its rules', () => {
    const next = optimistic(base, { action: 'setSource', key: 'codebuddy', enabled: false })
    expect(next.sources[0]?.enabled).toBe(false)
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[0]?.disabledBy).toBe('source')
  })

  it('leaves unrelated rows and sources alone', () => {
    const two = { ...base, sources: [source(), source({ key: 'cursor', label: 'Cursor' })] }
    const next = optimistic(two, { action: 'setSource', key: 'cursor', enabled: false })
    expect(next.sources[0]?.enabled).toBe(true)
    expect(next.sources[1]?.enabled).toBe(false)
    expect(next.rules[0]?.active).toBe(true)
  })

  it('returns a new object rather than mutating the payload', () => {
    const next = optimistic(base, { action: 'setSource', key: 'codebuddy', enabled: false })
    expect(next).not.toBe(base)
    expect(base.sources[0]?.enabled).toBe(true)
    expect(base.rules[0]?.active).toBe(true)
  })

  it('moves the entry location without touching a single row', () => {
    // The entry action carries neither a key nor a path, so it must be handled
    // before the rule branch — otherwise it falls through and flips a row whose
    // key is undefined.
    const next = optimistic(base, { action: 'setEntry', location: 'sidebar' })
    expect(next.entryLocation).toBe('sidebar')
    expect(next).not.toBe(base)
    expect(next.rules).toEqual(base.rules)
    expect(next.sources).toEqual(base.sources)
    expect(base.entryLocation).toBe('both')
  })

  it('flips only the tier a rule action names', () => {
    // One key in two tiers used to share one switch: the optimistic layer must
    // move the tier the action carries and nothing else.
    const two = {
      ...base,
      rules: [rule({ path: '/p/a.mdc', scope: 'user' }), rule({ path: '/p/a.mdc', scope: 'project' })],
    }
    const next = optimistic(two, { action: 'setRule', key: 'codebuddy', path: '/p/a.mdc', enabled: false, scope: 'project' })
    expect(next.rules[0]?.active).toBe(true)
    expect(next.rules[1]?.active).toBe(false)
    expect(next.rules[1]?.disabledBy).toBe('state')
  })

  it('switches only the tier a source action names', () => {
    const two = {
      ...base,
      sources: [source({ scope: 'user' }), source({ scope: 'project' })],
      rules: [rule({ path: '/p/a.mdc', scope: 'user' }), rule({ path: '/p/a.mdc', scope: 'project' })],
    }
    const next = optimistic(two, { action: 'setSource', key: 'codebuddy', enabled: false, scope: 'project' })
    expect(next.sources[0]?.enabled).toBe(true)
    expect(next.sources[1]?.enabled).toBe(false)
    expect(next.rules[0]?.active).toBe(true)
    expect(next.rules[1]?.active).toBe(false)
  })

  it('still addresses every tier when the action names none', () => {
    // Legacy shape: a client that sends no scope keeps its old meaning.
    const two = {
      ...base,
      sources: [source({ scope: 'user' }), source({ scope: 'project' })],
      rules: [rule({ path: '/p/a.mdc', scope: 'user' }), rule({ path: '/p/a.mdc', scope: 'project' })],
    }
    const next = optimistic(two, { action: 'setSource', key: 'codebuddy', enabled: false })
    expect(next.sources.map((s) => s.enabled)).toEqual([false, false])
    expect(next.rules.map((r) => r.active)).toEqual([false, false])
  })
})

describe('toggle wiring', () => {
  it('sends setRule with the rule path when a row is switched', async () => {
    // Exercises the same action shape the host validates at the route.
    const calls: unknown[] = []
    const doFetch = vi.fn(async (_url: string, init: { body?: string }) => {
      calls.push(JSON.parse(String(init.body)))
      return { ok: true, status: 200, json: async () => ({ rules: [], sources: [], scannedAt: 0, workspace: { path: null, source: 'none' } }) }
    })
    const { postAction } = await import('../src/client/index.tsx')
    await postAction({ action: 'setRule', key: 'codebuddy', path: '/p/a.mdc', enabled: false }, '/x', doFetch as never)
    expect(calls[0]).toEqual({ action: 'setRule', key: 'codebuddy', path: '/p/a.mdc', enabled: false })
  })

  it('rejects a failed write so the caller can roll back', async () => {
    const doFetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const { postAction } = await import('../src/client/index.tsx')
    await expect(postAction({ action: 'setSource', key: 'codebuddy', enabled: false }, '/x', doFetch as never))
      .rejects.toThrow('500')
  })
})

describe('hook wiring', () => {
  /**
   * The hook is rendered with `react-dom/server`: render runs, effects do not.
   * That is enough here — the first render captures `toggleRule`/`toggleSource`,
   * which are then called directly, so the body each one puts on the wire is
   * asserted without a DOM or a test renderer.
   */
  const capture = () => {
    const seen: unknown[] = []
    const doFetch = vi.fn(async (_url: string, init: { body?: string }) => {
      seen.push(JSON.parse(String(init.body)))
      return { ok: true, status: 200, json: async () => ({ rules: [], sources: [], scannedAt: 0, workspace: { path: null, source: 'none' } }) }
    })
    const previous = globalThis.fetch
    globalThis.fetch = doFetch as unknown as typeof fetch
    const holder: { hook?: ReturnType<typeof useRules> } = {}
    const Probe = () => {
      holder.hook = useRules('/x')
      return <span />
    }
    renderToStaticMarkup(<Probe />)
    return { seen, restore: () => { globalThis.fetch = previous }, holder }
  }

  it('carries the tier of each row into the write', async () => {
    const { seen, restore, holder } = capture()
    try {
      const groups = groupBySource([rule({ path: '/p/u.mdc', scope: 'user' })], [source({ scope: 'user' })])
      const group = groups[0]
      holder.hook?.toggleRule(rule({ path: '/p/u.mdc', scope: 'user' }), false)
      if (group) holder.hook?.toggleSource(group, false)
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(seen[0]).toEqual({ action: 'setRule', key: 'codebuddy', path: '/p/u.mdc', enabled: false, scope: 'user' })
      expect(seen[1]).toEqual({ action: 'setSource', key: 'codebuddy', enabled: false, scope: 'user' })
    } finally {
      restore()
    }
  })
})

describe('redesigned layout', () => {
  const many = (): RuleRow[] => [
    rule({ name: 'a1', type: 'always', descriptionTokens: 10, bodyTokens: 100, path: '/p/a1' }),
    rule({ name: 'a2', type: 'always', descriptionTokens: 5, bodyTokens: 50, path: '/p/a2' }),
    rule({ name: 'r1', type: 'requested', descriptionTokens: 7, path: '/p/r1' }),
    rule({ name: 'm1', type: 'manual', bodyTokens: 3, path: '/p/m1' }),
    rule({ name: 'off1', active: false, disabledBy: 'state', path: '/p/off1' }),
    rule({ name: 'fm1', enabled: false, active: false, disabledBy: 'frontmatter', path: '/p/fm1' }),
    rule({ name: 'diag1', diagnostics: [{ code: 'x', detail: 'd', kind: 'rule' }], path: '/p/diag1' }),
  ]

  it('renders a titled header with a description', () => {
    const html = render([rule()])
    expect(html).toContain(TEXT.zh['title']!)
    // The rendered subtitle is the zh one, but the claim it makes (one count
    // that matches the source table, read-only) must hold in both languages.
    const expected = String(SOURCES.length)
    for (const locale of ['zh', 'en'] as const) {
      expect(TEXT[locale]['subtitle']).toContain(expected)
      expect(TEXT[locale]['subtitle']).toMatch(/[Rr]ead-only|只读/)
    }
  })

  it('renders the four-number stat bar', () => {
    const html = render(many())
    // 7 rules; active = a1,a2,r1,m1,diag1 (5); not active = off1,fm1 (2);
    // diagnostics = diag1 (1).
    expect(html).toContain('>7<')
    expect(html).toContain('>5<')
    expect(html).toContain('>2<')
    expect(html).toContain('>1<')
    expect(html).toContain(TEXT.zh['stat.total']!)
    expect(html).toContain(TEXT.zh['stat.enabled']!)
    expect(html).toContain(TEXT.zh['stat.disabled']!)
    expect(html).toContain(TEXT.zh['stat.diagnostics']!)
  })

  it('marks the diagnostics stat as a warning only when there are any', () => {
    expect(render(many())).toContain('dshrm-stat warn')
    expect(render([rule()])).not.toContain('dshrm-stat warn')
  })

  it('shows the resident token total with its own label', () => {
    const html = render(many())
    // always-on bodies: 100 + 50 + 100 (diag1's defaults) = 250; the one
    // on-demand catalog line: 7; the requestable section's fixed scaffolding:
    // 101; manual and inactive keep nothing.
    expect(html).toContain('≈358')
    expect(html).toContain(TEXT.zh['costLabel']!)
  })

  it('renders full-width tabs with per-bucket counts', () => {
    const html = render(many())
    expect(html).toContain('dshrm-tabs')
    expect(html).toContain('全部（7）')
    // always = a1, a2, diag1; off = off1, fm1
    expect(html).toContain('全文常驻（3）')
    expect(html).toContain('按需加载（1）')
    expect(html).toContain('不注入（1）')
    expect(html).toContain('已停用（2）')
  })

  it('names both tablists on screen, not only to a screen reader', () => {
    // The two rows were the same shape an inch apart with their names hidden in
    // aria-label, which is what made them easy to mistake for each other.
    const html = render(many())
    expect((html.match(/dshrm-tabgroup/g) ?? []).length).toBe(2)
    expect(html).toContain('>范围<')
    expect(html).toContain('>状态<')
    // The accessible names stay: the visible label is decoration on top of them.
    expect(html).toContain('aria-label="范围"')
    expect(html).toContain('aria-label="状态"')
  })

  it('keeps the rows of a tier when the tier is chosen', () => {
    // The panel filters in scope before it groups, so "Global" can never show a
    // project row. The workspace dropdown's own guard rides on the same value.
    const rows = [rule({ name: 'g', scope: 'user', path: '/h/g' }), rule({ name: 'p', scope: 'project', path: '/p/p' })]
    expect(scopeIn(rows, 'user').map((r) => r.name)).toEqual(['g'])
    expect(scopeIn(rows, 'project').map((r) => r.name)).toEqual(['p'])
  })

  it('offers labelled source and search fields', () => {
    const html = render(many())
    expect(html).toContain('dshrm-select')
    expect(html).toContain(TEXT.zh['filter.source']!)
    expect(html).toContain('全部来源（7）')
    expect(html).toContain(TEXT.zh['filter.search']!)
  })

  it('lists each source in the filter with its own count', () => {
    const rows = [
      rule({ name: 'cb', sourceKey: 'codebuddy', path: '/p/cb' }),
      rule({ name: 'cur', sourceKey: 'cursor', sourceLabel: 'Cursor', path: '/p/cur' }),
    ]
    const sources = [
      source({ key: 'codebuddy', label: 'CodeBuddy' }),
      source({ key: 'cursor', label: 'Cursor', path: 'D:/repo/.cursor/rules' }),
    ]
    const html = render(rows, sources)
    expect(html).toContain('CodeBuddy (1)')
    expect(html).toContain('Cursor (1)')
  })

  it('renders each source as a card carrying its real absolute path', () => {
    const html = render([rule()], [source({ path: 'D:/repo/.codebuddy/rules' })])
    expect(html).toContain('dshrm-group')
    expect(html).toContain('dshrm-group-path')
    expect(html).toContain('D:/repo/.codebuddy/rules')
    expect(html).toContain('dshrm-badge')
  })

  it('draws the vendored brand mark on every source that has one', () => {
    // The family rides on the row, so the card can pick the vendor's artwork.
    // Every vendored mark is exercised here, because the workspace itself only
    // happens to carry one family.
    for (const [family, icon] of Object.entries(BRAND_ICONS)) {
      const html = render([rule({ family: family as RuleRow['family'] })], [source({ key: family })])
      expect(html).toContain('dshrm-brand')
      expect(html).toContain('aria-label="' + icon.title + '"')
      expect(html).toContain('viewBox="' + icon.viewBox + '"')
    }
  })

  it('accounts for every source in the table, mark or chip', () => {
    // The two cases above are driven by the icon table and a hand-written list,
    // so neither one notices a source that has no mark and no chip decision.
    // Tying the table to the icons is what makes a new source fail here rather
    // than ship as a silent blank.
    for (const entry of SOURCES) {
      const html = render(
        [rule({ family: entry.key as RuleRow['family'], sourceKey: entry.key })],
        [source({ key: entry.key, label: entry.label })],
      )
      const mark = BRAND_ICONS[entry.key] !== undefined
      if (mark) expect(html, entry.key).toContain('dshrm-brand')
      else expect(html, entry.key).not.toContain('dshrm-brand')
    }
  })

  it('keeps a two-letter chip for a convention with no mark', () => {
    // Nothing to draw means no invented artwork: the initials stay. Only one
    // family is left without a mark, because `.agents` is a shared directory
    // rather than a vendor (see brand-icons.ts).
    const noMark: readonly RuleRow['family'][] = ['agents']
    for (const family of noMark) {
      const plain = render([rule({ family })], [source({ key: family, label: family })])
      expect(plain, family).not.toContain('dshrm-brand')
    }
    const agents = render([rule({ family: 'agents' })], [source({ key: 'agents', label: 'Agent standard (.agents)' })])
    expect(agents).toContain('AG')
  })

  it('draws every outline instead of filling it', () => {
    // The badge paints `.dshrm-brand` with fill:currentColor, so a shape that
    // carries a stroke and no fill of its own is painted solid and hides the
    // shapes underneath it. Qoder's ring and Cursor's plate ring both shipped
    // that way; every stroke-only shape has to say fill="none" for itself.
    for (const [family, icon] of Object.entries(BRAND_ICONS)) {
      const shapes = icon.body.match(/<(?:path|circle|rect|polygon|ellipse|line)\b[^>]*>/g) ?? []
      for (const shape of shapes) {
        if (!shape.includes('stroke=')) continue
        expect(shape, family).toContain('fill=')
      }
    }
  })

  it('shows an iOS-style track for every switch', () => {
    const html = render([rule()])
    // One for the source, one for the rule.
    expect((html.match(/dshrm-track/g) ?? []).length).toBe(2)
  })

  it('renders the two-line description on a rule row', () => {
    const html = render([rule({ description: 'keep diffs small' })])
    expect(html).toContain('dshrm-desc')
    expect(html).toContain('keep diffs small')
  })

  it('offers the other workspaces only when the host names one', () => {
    // A single-workspace host sends no options; the panel must not grow a
    // control that cannot do anything.
    expect(render([rule()])).not.toContain(TEXT.zh['filter.workspace']!)
    const many = renderToStaticMarkup(
      <RulesPanel
        ctx={undefined as never}
        t={t}
        rules={[rule()]}
        sources={[source()]}
        workspace={{ path: '/p', source: 'selected', options: ['/p', '/q'] }}
        selectedWorkspace={null}
        onSelectWorkspace={NOOP}
        state="ready"
        onRetry={NOOP}
        onToggleRule={NOOP}
        onToggleSource={NOOP}
        pending={[]}
        error={null}
      />,
    )
    expect(many).toContain(TEXT.zh['filter.workspace']!)
    // The current directory stays the selected entry; the others are the switch.
    expect(many).toContain('value="/p" selected')
    expect(many).toContain('value="/q"')
    expect(many.match(/<option value="\/p"|<option value="\/q"/g)?.length).toBe(2)
  })

  it('filters the list down to the rules with diagnostics', () => {
    const html = render(many())
    // The count in the stat bar is a control, not a dead end.
    expect(html).toContain('dshrm-stat-btn')
    expect(html).toContain(TEXT.zh['statDiagnosticsHint']!)
    expect(html).toContain('有诊断的规则（1）')
  })

  it('leaves the diagnostics cell inert when nothing is wrong', () => {
    const html = render([rule()])
    expect(html).not.toContain('dshrm-stat-btn')
    expect(html).not.toContain('value="diag"')
  })

  it('turns the refresh button into progress instead of silence', () => {
    const html = renderToStaticMarkup(
      <RulesPanel
        ctx={undefined as never}
        t={t}
        rules={[rule()]}
        sources={[source()]}
        workspace={{ path: '/p', source: 'last-scan' }}
        state="ready"
        onRetry={NOOP}
        refreshing
        onRefresh={NOOP}
        onToggleRule={NOOP}
        onToggleSource={NOOP}
        pending={[]}
        error={null}
      />,
    )
    expect(html).toContain(TEXT.zh['refreshing']!)
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('>' + TEXT.zh['refresh']! + '<')
  })

  it('offers a details link beside the resident total', () => {
    // The line states one aggregate number; the link is the receipt behind it,
    // and it stays closed until it is asked for.
    const html = render(many())
    expect(html).toContain('dshrm-link')
    expect(html).toContain(TEXT.zh['costDetails']!)
    expect(html).not.toContain('role="dialog"')
  })

  it('itemises the resident and on-demand cost of every rule', () => {
    const html = renderToStaticMarkup(
      <TokenBreakdown
        t={t}
        rules={[
          rule({ name: 'resident', type: 'always', descriptionTokens: 10, bodyTokens: 100, path: '/p/a' }),
          rule({ name: 'ondemand', type: 'requested', descriptionTokens: 7, bodyTokens: 70, path: '/p/r' }),
          rule({ name: 'manual', type: 'manual', bodyTokens: 3, bodyLength: 3, path: '/p/m' }),
          rule({ name: 'off', active: false, disabledBy: 'state', path: '/p/o' }),
        ]}
        diagnostics={[]}
        onClose={NOOP}
      />,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain(TEXT.zh['costDetails']!)
    expect(html).toContain(TEXT.zh['costRule']!)
    expect(html).toContain(TEXT.zh['costOnDemand']!)
    // always-on: 100 resident (its description is not injected); on-demand:
    // 7 resident (its catalog line) / 70 later; manual: nothing, because no
    // path injects it; a rule that is off pays nothing.
    expect(html).toContain('>100<')
    expect(html).toContain('>70<')
    expect(html).toContain('>7<')
    expect(html).toContain('>0<')
    // The scaffolding row, then the two totals: 100 + 7 + 101 = 208 resident,
    // 70 on demand — the manual body is never fetched, so it adds nothing.
    expect(html).toContain(TEXT.zh['costCatalog']!)
    expect(html).toContain('>101<')
    expect(html).toContain('>208<')
    expect(html).toContain('>70<')
    // The explanation has to name both halves of the model.
    expect(html).toContain(TEXT.zh['costHint']!)
  })

  it('keeps every disabled rule visible in the list', () => {
    const html = render(many())
    for (const name of ['off1', 'fm1', 'diag1']) expect(html).toContain(name)
    // And it explains each one differently.
    expect(html).toContain(TEXT.zh['offReason.state']!)
    expect(html).toContain(TEXT.zh['offReason.frontmatter']!)
  })
})

describe('locale coverage', () => {
  it('keeps both dictionaries in step', () => {
    expect(Object.keys(TEXT.zh).sort()).toEqual(Object.keys(TEXT.en).sort())
  })

  it('falls back to English with no locale service, without throwing', () => {
    // No service and no snapshot means no language signal, so English is the
    // documented fallback (see resolveText). The test asserts the fallback
    // rather than inventing a shape the host does not have.
    const ctx = { slots: { register: () => () => {}, inject: (_n: string, cb: () => void) => cb() } }
    expect(resolveText(ctx as never, 'tab.off')).toBe(TEXT.en['tab.off'])
  })

  it('resolves Chinese when the service reports zh', () => {
    const locale = { getSnapshot: () => ({ active: 'zh' }) }
    const ctx = { slots: { register: () => () => {}, inject: (_n: string, cb: () => void) => cb() }, get: () => locale }
    expect(resolveText(ctx as never, 'tab.off')).toBe(TEXT.zh['tab.off'])
  })
})
