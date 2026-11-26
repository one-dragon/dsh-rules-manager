/**
 * Panel logic, kept pure and separate from rendering.
 *
 * Grouping, sorting, filtering and token accounting are the parts most likely
 * to be wrong and the cheapest to test: none of them needs a DOM, so they are
 * plain functions over the payload. The component below only arranges their
 * output.
 */
import type { RuleRow, RuleSourceRow, RulesAction, RulesPayload } from '../panel.ts'
import { catalogLine } from '../rule-layout.ts'
import { estimateTokens } from '../token-count.ts'
import { costOfRules, type CostReport, type CostRule } from '../cost.ts'

/** The four buckets a rule can fall into for the panel. */
export type StatusKey = 'always' | 'requested' | 'manual' | 'off'

/** Which tier tab is selected; `'all'` shows both tiers. */
export type ScopeTab = 'all' | 'user' | 'project'

/** Which status tab is selected; `'all'` shows every bucket. */
export type StatusTab = 'all' | StatusKey

/**
 * Which bucket a rule belongs in.
 *
 * Three states came from the file's own `type`; `'off'` is the fourth and is
 * decided by {@link RuleRow.active}, so a rule switched off from this panel
 * lands here rather than disappearing.
 */
export function statusOf(rule: RuleRow): StatusKey {
  return rule.active ? rule.type : 'off'
}

/**
 * Tokens one requestable rule contributes as its catalog line.
 *
 * The line is `- <path>: <description>` — the path is the key the agent passes
 * to `read_rules`, and the description is its only basis for deciding whether
 * to. Counting the description alone under-reported the real line, and the
 * absolute path is often the longer half.
 *
 * Built through the same helper the host renders with (`catalogLine` in
 * rule-layout.ts, which the injected block and the host cost model both use),
 * so a change there is a change to the same measured thing here.
 */
export function catalogLineTokens(rule: RuleRow): number {
  return estimateTokens(catalogLine(rule))
}

/**
 * Token cost of one rule, split the way the panel explains it.
 *
 * `resident` is what sits in the prompt on every request; `onDemand` is what
 * is only paid for when the model actually reads the rule. The split mirrors
 * what `partition()` and `requestableSection()` in render.ts really inject:
 *
 * - `always` puts the rule's **body** in the prompt. Its description is not
 *   injected at all for that bucket, so adding it here (as this function once
 *   did) overstated every always-on rule.
 * - `requested` puts one catalog line — path plus description — in the prompt,
 *   and the body arrives only if the model asks.
 * - `manual` is never injected by anything: it is not in the render block and
 *   not in the requestable index, so it costs nothing until a person calls the
 *   tool by name. Reporting its body as "on demand" promised a load that no
 *   agent path can trigger.
 *
 * The fixed scaffolding around the requestable sections is deliberately not
 * here: it belongs to no single rule. `TokenBreakdown` adds it once, through
 * `costOfRules`.
 */
export function ruleCost(rule: RuleRow): { resident: number; onDemand: number } {
  if (!rule.active) return { resident: 0, onDemand: 0 }
  // An attached rule is rendered by the always branch (see `partition` in
  // render.ts), so it must be *charged* by the always branch too: charging its
  // catalog line while the prompt really carries the whole body would print a
  // number smaller than what the reader is paying.
  if (rule.type === 'always' || rule.attached === true) return { resident: rule.bodyTokens, onDemand: 0 }
  if (rule.type === 'requested') return { resident: catalogLineTokens(rule), onDemand: rule.bodyTokens }
  return { resident: 0, onDemand: 0 }
}

/**
 * One row as the cost model takes it.
 *
 * The scope is the host's own verdict, carried from the scan root, and is
 * handed over explicitly: the model's fallback (a path prefix of the project
 * root) is only a guess, and the two tiers it decides between are budgeted
 * separately (6000 characters for user rules, 12000 for project rules).
 */
export function toCostRule(rule: RuleRow): CostRule {
  return {
    path: rule.path,
    name: rule.name,
    type: rule.type,
    active: rule.active,
    description: rule.description,
    descriptionTokens: rule.descriptionTokens,
    bodyTokens: rule.bodyTokens,
    bodyLength: rule.bodyLength,
    scope: rule.scope,
  }
}

/**
 * The full cost report for a set of rules, budget included.
 *
 * The per-rule figures are the same maths the rows print, but the report also
 * carries what no single rule owns: the fixed scaffolding of the requestable
 * index (`catalog`), which rules the 8000-character cap clipped, and which
 * ones a tier total dropped entire. Without those the panel's total was an
 * upper bound that no real request ever matched.
 */
export function costReport(rules: readonly RuleRow[]): CostReport {
  // The rows already carry the verdict, so the cost model reads it from the same
  // place the badge and the row note do. Handing it over separately would be two
  // inputs for one fact, and the two could disagree.
  //
  // It also has to reach the model: a rule that left the requestable index is no
  // longer part of `catalog`, so without this the section's scaffolding would be
  // counted for a section that no longer lists the rule.
  const attached = new Set(rules.filter((rule) => rule.attached === true).map((rule) => rule.path))
  return costOfRules(rules.map(toCostRule), null, attached.size === 0 ? undefined : { attached })
}

/**
 * Total tokens that stay in the prompt for this set of rules.
 *
 * Summed the way a request is actually built: the budgeted per-rule residents
 * plus the requestable index's scaffolding. The headline and the breakdown
 * table therefore agree by construction, instead of by two arithmetics
 * happening to coincide.
 */
export function totalResidentTokens(rules: readonly RuleRow[]): number {
  const report = costReport(rules)
  return report.resident + report.catalog
}

/**
 * Legacy figure: the description text of enabled always-on rules.
 *
 * Kept because it is what the pre-grouping summary reported and a test pins it.
 * New UI should prefer {@link totalResidentTokens}, which also counts an
 * always-on rule's *body* — the thing that actually costs the most.
 */
export function residentTokens(rules: readonly RuleRow[]): number {
  return rules.reduce(
    (total, rule) => (rule.enabled && rule.type === 'always' ? total + rule.descriptionTokens : total),
    0,
  )
}

/**
 * Case-insensitive search over name, description and path.
 *
 * The path is searched because that is how a user identifies a rule they only
 * half-remember ("the one under .cursor").
 */
export function filterRules(rules: readonly RuleRow[], query: string): readonly RuleRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return rules
  return rules.filter((rule) =>
    rule.name.toLowerCase().includes(needle)
    || rule.description.toLowerCase().includes(needle)
    || rule.path.toLowerCase().includes(needle),
  )
}

/**
 * The two tab axes, applied one at a time.
 *
 * The panel runs scope first because *every* number it prints — the stat bar,
 * the tab labels, the source dropdown — describes the rows underneath the tabs.
 * Counting the unscoped catalog left "全局" showing an empty list next to
 * "全部（14）": a tab that looked like it did nothing at all.
 */
export function scopeIn(rules: readonly RuleRow[], scope: ScopeTab): readonly RuleRow[] {
  return scope === 'all' ? rules : rules.filter((rule) => rule.scope === scope)
}

/** Narrow a scope-filtered list to one status bucket. */
export function statusIn(rules: readonly RuleRow[], status: StatusTab): readonly RuleRow[] {
  return status === 'all' ? rules : rules.filter((rule) => statusOf(rule) === status)
}

/**
 * Apply both tabs at once.
 *
 * Kept because the pure-function tests address it directly; the panel chains
 * {@link scopeIn} and {@link statusIn} instead, so the scope filter runs once
 * and that one result feeds the counts as well as the list.
 */
export function applyTabs(
  rules: readonly RuleRow[],
  scope: ScopeTab,
  status: StatusTab,
): readonly RuleRow[] {
  return statusIn(scopeIn(rules, scope), status)
}

/** How many rules fall in each bucket, for the tab labels. */
/**
 * One source's identity across both tiers.
 *
 * The same key exists under \`~\` and under the project (\`codebuddy\` twice), so a
 * bare key addresses nothing in particular. Every rule-to-source match — the
 * group list, the source dropdown — compares this scoped id instead.
 */
export function sourceId(source: RuleSourceRow): string {
  return source.scope + ':' + source.key
}

/** The scoped source id a rule belongs to, matching \`sourceId\` above. */
export function ruleSourceId(rule: RuleRow): string {
  return rule.scope + ':' + rule.sourceKey
}

/**
 * The bare source key behind a scope-qualified id (user:codebuddy becomes
 * codebuddy).
 *
 * A group's id is {@link sourceId}'s \<scope>:\<key>, but the wire action carries
 * the key and the scope as two fields, so the id has to be taken apart again.
 * One place for that split keeps the badge and the switch from drifting apart.
 */
export function sourceKeyOf(groupKey: string): string {
  const colon = groupKey.indexOf(':')
  return colon === -1 ? groupKey : groupKey.slice(colon + 1)
}

/**
 * Which tab an arrow, Home or End press moves to; null for any other key.
 *
 * Pure so the keyboard contract is testable without a DOM. The caller selects
 * the tab at the returned index and moves focus to it, which is APG's automatic
 * activation - the same behavior the packaged SegmentedTabs implements.
 */
export function tabStep(key: string, index: number, length: number): number | null {
  if (length <= 0 || index < 0) return null
  if (key === 'ArrowLeft') return (index - 1 + length) % length
  if (key === 'ArrowRight') return (index + 1) % length
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  return null
}

/**
 * Narrow a source list to one scope tab.
 *
 * Handing the unscoped list to \`groupBySource\` kept the other tier's cards on
 * screen after a tab switch — as empty "0 rules" groups, which read as "the tab
 * did nothing". The panel filters through here before both the dropdown and the
 * groups.
 */
export function filterByScope(
  sources: readonly RuleSourceRow[],
  scope: ScopeTab,
): readonly RuleSourceRow[] {
  return scope === 'all' ? sources : sources.filter((source) => source.scope === scope)
}

export function statusCounts(rules: readonly RuleRow[]): Record<StatusKey, number> {
  const counts: Record<StatusKey, number> = { always: 0, requested: 0, manual: 0, off: 0 }
  for (const rule of rules) counts[statusOf(rule)] += 1
  return counts
}

/** One source group, with the real directory it was scanned from. */
export interface SourceGroup {
  readonly key: string
  readonly label: string
  readonly scope: 'user' | 'project'
  /** Absolute path on disk, or an empty string when the host did not report it. */
  readonly path: string
  readonly enabled: boolean
  readonly rules: readonly RuleRow[]
}

/**
 * Group rules by source, in the host's source order.
 *
 * The host's `sources` list is the ordering authority (it is already sorted by
 * rank) and the only place the real absolute path exists. A source that
 * contributed no matching rule is **kept** when it exists on disk, so the panel
 * can still show its path and its switch — hiding an empty source would remove
 * the only place to turn it back on.
 */
export function groupBySource(
  rules: readonly RuleRow[],
  sources: readonly RuleSourceRow[],
): readonly SourceGroup[] {
  const groups: SourceGroup[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    const key = source.scope + ':' + source.key
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      key,
      label: source.label,
      scope: source.scope,
      path: source.path,
      enabled: source.enabled,
      rules: rules.filter((rule) => rule.sourceKey === source.key && rule.scope === source.scope),
    })
  }

  // A rule whose source the host did not list still has to appear somewhere.
  for (const rule of rules) {
    const key = rule.scope + ':' + rule.sourceKey
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      key,
      label: rule.sourceLabel,
      scope: rule.scope,
      path: '',
      enabled: true,
      rules: rules.filter((r) => r.sourceKey === rule.sourceKey && r.scope === rule.scope),
    })
  }
  return groups
}

/**
 * Order rules by what they cost, most expensive first.
 *
 * Ties break on name so the order is stable between renders. Cheap rules sink
 * to the bottom, which is where a user looking for savings expects to find
 * nothing worth acting on.
 */
export function sortByCost(rules: readonly RuleRow[]): readonly RuleRow[] {
  return [...rules].sort((a, b) => {
    const diff = ruleCost(b).resident - ruleCost(a).resident
    return diff !== 0 ? diff : a.name.localeCompare(b.name)
  })
}

/** Why a rule is not in effect, for the row's explanation. */
export function disabledReasonKey(rule: RuleRow): string | null {
  if (rule.active) return null
  if (rule.disabledBy === 'frontmatter') return 'offReason.frontmatter'
  if (rule.disabledBy === 'source') return 'offReason.source'
  return 'offReason.state'
}

/** The explanation key that goes with a rule's current state. */
export function noteKeyOf(rule: RuleRow): string {
  if (!rule.active) return 'note.off'
  // Before the type branch: an attached rule is still written as on-demand, and
  // its file state has not changed. Only why it is resident in *this* session
  // has, which is the one thing the row note exists to explain.
  if (rule.attached === true) return 'note.attached'
  if (rule.type === 'always') return 'note.always'
  if (rule.type === 'requested') return 'note.requested'
  return 'note.manual'
}

/** Scope match: an action that names no tier addresses every tier (legacy). */
const sameScope = (scope: string | undefined, target: string): boolean =>
  scope === undefined || scope === target

/**
 * The payload as it will look once the host accepts this action.
 *
 * Only the switched field moves; everything else is copied, so a failed write
 * cannot leave a half-updated list behind. Pure, so the rollback path (restore
 * the last confirmed payload) is trivially correct.
 */
export function optimistic(payload: RulesPayload, action: RulesAction): RulesPayload {
  if (action.action === 'setSource') {
    return {
      ...payload,
      sources: payload.sources.map((source) =>
        source.key === action.key && sameScope(action.scope, source.scope)
          ? { ...source, enabled: action.enabled } : source),
      rules: payload.rules.map((rule) => {
        if (rule.sourceKey !== action.key || !sameScope(action.scope, rule.scope)) return rule
        if (!action.enabled) return { ...rule, active: false, disabledBy: 'source' as const }
        // Switching the source back on restores only what this toggle owns:
        // a rule disabled from the panel stays disabled, exactly as the
        // setRule branch below already handles it. Treating every non-source
        // block as "frontmatter" flipped those rows back to active on screen
        // until the host's answer arrived to contradict them.
        const blocked = rule.disabledBy === 'frontmatter' ? 'frontmatter'
          : rule.disabledBy === 'state' ? 'state'
            : rule.enabled ? null : 'frontmatter'
        return { ...rule, active: blocked === null, disabledBy: blocked }
      }),
    }
  }
  return {
    ...payload,
    rules: payload.rules.map((rule) => {
      if (rule.sourceKey !== action.key || rule.path !== action.path
        || !sameScope(action.scope, rule.scope)) return rule
      if (!action.enabled) return { ...rule, active: false, disabledBy: 'state' as const }
      // Re-enabling only restores the rule if nothing else is holding it off.
      const blocked = rule.disabledBy === 'frontmatter' ? 'frontmatter'
        : rule.disabledBy === 'source' ? 'source'
          : rule.enabled ? null : 'frontmatter'
      return { ...rule, active: blocked === null, disabledBy: blocked }
    }),
  }
}

/** Fill `{name}`-style interpolations in one pass. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  )
}
