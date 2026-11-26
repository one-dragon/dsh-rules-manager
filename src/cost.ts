/**
 * What the rules block actually costs.
 *
 * The numbers here mirror what the host really injects. A per-rule guess is
 * wrong in both directions, so the shape of each type matters:
 *
 * - `always` puts the rule's *body* in the prompt. Its `description` is never
 *   read for that bucket (see `partition()` in render.ts).
 * - `requested` puts one catalog line — the absolute path plus the description
 *   — in the prompt; the body arrives later through `read_rules`.
 * - `manual` is never injected at all.
 *
 * Past that, `applyBudget` truncates an always-on body beyond the per-rule cap
 * and drops whole rules once a tier's running total is spent, so a rule may
 * cost less than its own length, or nothing at all. The budget is charged in
 * *characters*, exactly as `applyBudget` charges it, while the figures the
 * panel shows are tokens; `bodyLength` carries the first and `bodyTokens` the
 * second.
 *
 * The module is pure and cannot see `state.json` or the source switches: it
 * has no way to tell a rule disabled in its own frontmatter from one switched
 * off in the panel or through a disabled source. `active` is therefore the
 * caller's final verdict, already folded from `enabled`, the source switch and
 * the disabled list. An inactive rule costs nothing here.
 *
 * One caveat the caller should know about: a body clipped by the per-rule cap
 * really costs a little less than `bodyTokens`, and the clipped text is not
 * available to this module. `truncated` marks those rules, and their
 * `bodyTokens` is an upper bound.
 */
import { PER_RULE_MAX, PROJECT_RULES_TOTAL_MAX, USER_RULES_TOTAL_MAX } from './budget.ts'
import { attachedNow, catalogLine, requestableSection, truncationMarker } from './rule-layout.ts'
import { estimateTokens } from './token-count.ts'

/** Per-rule cap on an always-on body, mirroring `PER_RULE_MAX`. */
export const CATALOG_PER_RULE_MAX = PER_RULE_MAX
/** Running cap for always-on user rules, mirroring `USER_RULES_TOTAL_MAX`. */
export const CATALOG_USER_TOTAL_MAX = USER_RULES_TOTAL_MAX
/** Running cap for always-on project rules, mirroring `PROJECT_RULES_TOTAL_MAX`. */
export const CATALOG_PROJECT_TOTAL_MAX = PROJECT_RULES_TOTAL_MAX

/**
 * A rule as the cost model needs it.
 *
 * Deliberately not the host's `Rule`: the panel holds `RuleRow`, which never
 * carries the body text, so the input is the handful of numbers both sides can
 * produce. `description` is the one exception — the catalog line needs the raw
 * text, and every caller has it.
 */
export interface CostRule {
  /** The key the panel already uses: the rule's absolute path. */
  readonly path: string
  readonly name: string
  readonly type: 'always' | 'requested' | 'manual'
  /**
   * The tier the host itself decided, when the caller knows it.
   *
   * `RuleRow.scope` comes from the scan root, which is the authority. Inferring
   * the tier from a path prefix is only a fallback for callers that have no such
   * field, and the panel is not one of them: the workspace it is showing need
   * not be the host's project root, so a prefix test can put a user rule in the
   * 12000-character tier (or a project rule in the 6000 one) and move a total
   * that way. Supplying `scope` skips that guess entirely.
   */
  readonly scope?: 'user' | 'project'
  /** Final in-effect state, already folded from enabled, source and state. */
  readonly active: boolean
  /** Raw description text; the catalog line truncates and escapes it. */
  readonly description: string
  /** Tokens in the description; kept for callers that sort by it. */
  readonly descriptionTokens: number
  /** Tokens in the body, the figure a `read_rules` fetch would cost. */
  readonly bodyTokens: number
  /** Characters in the body, the unit the budget actually charges. */
  readonly bodyLength: number
}

/** One rule's share of the prompt, split by when it is paid. */
export interface CostLine {
  readonly key: string
  readonly name: string
  readonly type: 'always' | 'requested' | 'manual'
  readonly scope: 'user' | 'project'
  /** False when the rule is not in effect; every figure is then zero. */
  readonly active: boolean
  /** Tokens in the prompt on every request. */
  readonly resident: number
  /** Tokens the body costs only if the model asks for it. */
  readonly onDemand: number
  /** True when the per-rule cap cut this body in the rendered prompt. */
  readonly truncated: boolean
  /** True when the tier total dropped this rule from the rendered prompt. */
  readonly omitted: boolean
}

export interface CostReport {
  /** One entry per input rule, in input order, inactive rules included. */
  readonly lines: readonly CostLine[]
  /** Sum of `lines[].resident`. */
  readonly resident: number
  /** Sum of `lines[].onDemand`. */
  readonly onDemand: number
  /** Fixed cost of the requestable index: its tags, preamble and boilerplate. */
  readonly catalog: number
  /** Keys truncated to the per-rule cap, in input order. */
  readonly truncated: readonly string[]
  /** Keys dropped by a tier total, in input order. */
  readonly omitted: readonly string[]
}

/** Budget overrides; the host config feeds its three knobs through here. */
export interface CostOverrides {
  readonly perRuleMax?: number
  readonly userTotal?: number
  readonly projectTotal?: number
  /**
   * Rules a touched file has attached this session, by absolute path.
   *
   * An attached rule stops being an index line and becomes resident content, so
   * it is charged exactly like an always-on rule: its body against the tier
   * total instead of a catalog line. Without this the panel would keep quoting
   * the on-demand price for a body the host is already injecting.
   */
  readonly attached?: ReadonlySet<string>
}

/**
 * Which of the two always-on tiers a rule is charged to.
 *
 * An explicit {@link CostRule.scope} wins: it is the host's own verdict, taken
 * from the scan root, and it stays right when the caller's `projectRoot` is not
 * the root the rule was scanned under - or is null, which a scope-carrying
 * caller passes. Only a caller with no scope of its own falls back to the
 * path-prefix test `partition()` uses: under the project root means project.
 */
function isProjectRule(rule: CostRule, projectRoot: string | null): boolean {
  if (rule.scope !== undefined) return rule.scope === 'project'
  return projectRoot !== null && rule.path.startsWith(projectRoot)
}

// The catalog row and the truncation marker are shared text: the panel measures
// exactly what render.ts emits, so both come from ./rule-layout.ts rather than a
// second copy that only a comment keeps in sync.

/**
 * The characters an always-on body charges against its tier total.
 *
 * `applyBudget` truncates first and then measures what the truncated content
 * costs, marker included — so a clipped body is charged slightly more than the
 * cap, not slightly less. That order is what decides whether a following rule
 * fits, so it is reproduced exactly.
 */
function alwaysCharge(rule: CostRule, perRuleMax: number): { readonly chars: number; readonly truncated: boolean } {
  if (rule.bodyLength <= perRuleMax) return { chars: rule.bodyLength, truncated: false }
  return { chars: perRuleMax + truncationMarker(perRuleMax).length, truncated: true }
}

/**
 * The cost of a single rule, on its own.
 *
 * No tier accounting happens here: `omitted` is always false, because whether a
 * rule was dropped depends on the rules before it. `costOfRules` layers that on
 * top by calling this function, so the per-rule figures the panel shows and the
 * totals it sums can never drift apart.
 */
export function costOfRule(
  rule: CostRule,
  projectRoot: string | null,
  overrides?: CostOverrides,
): CostLine {
  const scope: 'user' | 'project' = isProjectRule(rule, projectRoot) ? 'project' : 'user'
  // An attached on-demand rule is charged as resident: same body, same tier
  // budget, same truncation as every other always-on rule.
  const type: 'always' | 'requested' | 'manual' = attachedNow(rule.type, overrides?.attached, rule.path)
    ? 'always'
    : rule.type
  const base = { key: rule.path, name: rule.name, type, scope }

  if (!rule.active) {
    return { ...base, active: false, resident: 0, onDemand: 0, truncated: false, omitted: false }
  }

  if (type === 'always') {
    const charge = alwaysCharge(rule, overrides?.perRuleMax ?? CATALOG_PER_RULE_MAX)
    return { ...base, active: true, resident: rule.bodyTokens, onDemand: 0, truncated: charge.truncated, omitted: false }
  }

  if (type === 'requested') {
    // The catalog line is resident; the body is what `read_rules` would return.
    return { ...base, active: true, resident: estimateTokens(catalogLine(rule)), onDemand: rule.bodyTokens, truncated: false, omitted: false }
  }

  // manual: `render` partitions it out of the prompt, and the requestable index
  // only ever holds `requested` rules (host src/index.ts:392), so neither the
  // prompt nor `read_rules` can reach it. It costs nothing anywhere.
  return { ...base, active: true, resident: 0, onDemand: 0, truncated: false, omitted: false }
}

/** Fixed cost of one non-empty tier: the whole section minus its rows. */
function scaffoldCost(part: { readonly section: string; readonly rows: string }): number {
  if (part.rows === '') return 0
  return Math.max(0, estimateTokens(part.section) - estimateTokens(part.rows))
}

/**
 * Cost every rule in `rules` as the host would inject it.
 *
 * `always` rules go through the same order `applyBudget` uses: truncate past
 * the per-rule cap first, then charge the truncated length against the tier
 * total and drop the rule whole if it would not fit. A dropped rule does not
 * advance the total, so a later, smaller rule can still be kept. The two tiers
 * keep independent counters, and within a tier the order is input order.
 *
 * The tier each rule is charged to comes from `rule.scope` when the caller
 * supplies it, and from a path-prefix test against `projectRoot` otherwise.
 *
 * `requested` and `manual` rules are never budgeted: the former is charged its
 * catalog line as resident and its body as on-demand, the latter on-demand
 * only. `catalog` then carries just the scaffolding both requestable sections
 * add on top of their rows, so `catalog` plus the per-rule residents is exactly
 * what the requestable index costs.
 */
export function costOfRules(
  rules: readonly CostRule[],
  projectRoot: string | null,
  overrides?: CostOverrides,
): CostReport {
  const perRuleMax = overrides?.perRuleMax ?? CATALOG_PER_RULE_MAX
  const totals = {
    user: overrides?.userTotal ?? CATALOG_USER_TOTAL_MAX,
    project: overrides?.projectTotal ?? CATALOG_PROJECT_TOTAL_MAX,
  }
  // Characters already spent in each always-on tier, one counter per tier.
  const used = { user: 0, project: 0 }
  const lines: CostLine[] = []
  const truncated: string[] = []
  const omitted: string[] = []
  let resident = 0
  let onDemand = 0

  for (const rule of rules) {
    const line = costOfRule(rule, projectRoot, overrides)
    if (!line.active) {
      lines.push(line)
      continue
    }
    onDemand += line.onDemand
    if (line.truncated) truncated.push(line.key)
    if (line.type !== 'always') {
      resident += line.resident
      lines.push(line)
      continue
    }
    const charge = alwaysCharge(rule, perRuleMax)
    if (used[line.scope] + charge.chars > totals[line.scope]) {
      // Mirrors applyBudget's `continue`: dropped whole, budget untouched.
      omitted.push(line.key)
      lines.push({ ...line, resident: 0, omitted: true })
      continue
    }
    used[line.scope] += charge.chars
    resident += line.resident
    lines.push(line)
  }

  // Attached rules are resident now, so they no longer contribute a catalog row;
  // counting them here would charge the same rule twice.
  const onDemandRule = (rule: CostRule): boolean =>
    rule.active && rule.type === 'requested' && overrides?.attached?.has(rule.path) !== true
  const projectRequested = rules.filter((rule) => onDemandRule(rule) && isProjectRule(rule, projectRoot))
  const userRequested = rules.filter((rule) => onDemandRule(rule) && !isProjectRule(rule, projectRoot))
  // The rows are estimated beside the whole section: the difference between the
  // two is the section's fixed scaffolding, which costs the same whether one
  // rule is requestable or twenty. Building the section through the shared
  // helper is what keeps the estimate measuring the real block.
  const projectRows = projectRequested.map(catalogLine).join('\n')
  const userRows = userRequested.map(catalogLine).join('\n')
  const catalog = scaffoldCost({
    rows: projectRows,
    section: requestableSection('agent_requestable_workspace_rules', 'workspace-level', projectRows),
  }) + scaffoldCost({
    rows: userRows,
    section: requestableSection('agent_requestable_user_rules', 'user-level', userRows),
  })

  return { lines, resident, onDemand, catalog, truncated, omitted }
}
