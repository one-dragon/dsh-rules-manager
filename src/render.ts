/**
 * Render the `<rules>` block injected into every request.
 *
 * The five-part shape is CodeBuddy's (§4.2): always-on user rules, always-on
 * project rules, requestable project rules, memories, requestable user rules.
 * The memories segment is deliberately not rendered: memory files are out of
 * scope for this plugin (README, "What is deliberately not read"), so the
 * block carries four parts. Only requestable rules expose a path and
 * description; their bodies load through the `read_rules` tool, which is what
 * makes on-demand rules cheap.
 */
import { applyBudget, formatOmittedLine, PER_RULE_MAX, PROJECT_RULES_TOTAL_MAX, USER_RULES_TOTAL_MAX } from './budget.ts'
import { attachedNow, catalogLine, NO_ATTACHED, requestableSection } from './rule-layout.ts'
import type { Rule } from './types.ts'

export interface RenderOptions {
  /** Absolute directory the paths are shown relative to. */
  readonly projectRoot: string | null
  /** Character cap for one always-on rule body. */
  readonly perRuleMax?: number
  /** Total cap for user-scope always-on rules. */
  readonly userRulesTotal?: number
  /** Total cap for project-scope always-on rules. */
  readonly projectRulesTotal?: number
  /**
   * Paths of requestable rules that file touches have made resident.
   *
   * A rule listed here renders as always-on content instead of an index line,
   * which is the whole point of file-scoped attachment: once the session has
   * worked with a file the rule's patterns match, its body is worth the tokens.
   * The rule's own `type` is never rewritten — this is a view of the current
   * request only, and the panel keeps reporting the file as it was written.
   *
   * The decision belongs to `attach.ts`, which owns the matching and the
   * "which file did the session touch" bookkeeping; this module only renders.
   */
  readonly attached?: ReadonlySet<string>
}

/** Which section a rule belongs to. */
interface Partition {
  readonly userAlways: readonly Rule[]
  readonly projectAlways: readonly Rule[]
  readonly projectRequested: readonly Rule[]
  readonly userRequested: readonly Rule[]
  readonly manual: readonly Rule[]
}

function partition(
  rules: readonly Rule[],
  projectRoot: string | null,
  attached: ReadonlySet<string>,
): Partition {
  const userAlways: Rule[] = []
  const projectAlways: Rule[] = []
  const projectRequested: Rule[] = []
  const userRequested: Rule[] = []
  const manual: Rule[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.type === 'manual') { manual.push(rule); continue }
    // A file-attached rule renders as resident content. `manual` is decided
    // first on purpose: a manual rule is never attached (attach.ts skips it),
    // and it must never gain a section it was written to stay out of.
    const type: Rule['type'] = attachedNow(rule.type, attached, rule.path)
      ? 'always'
      : rule.type
    // A rule found under the project tier is a project rule; otherwise user.
    const isProject = projectRoot !== null && rule.path.startsWith(projectRoot)
    if (type === 'always') {
      (isProject ? projectAlways : userAlways).push(rule)
    } else {
      (isProject ? projectRequested : userRequested).push(rule)
    }
  }
  return { userAlways, projectAlways, projectRequested, userRequested, manual }
}

/** The block injected into the prompt, or '' when there is nothing to say. */
export function renderRulesBlock(rules: readonly Rule[], options: RenderOptions): string {
  const parts = partition(rules, options.projectRoot, options.attached ?? NO_ATTACHED)
  const perRule = options.perRuleMax ?? PER_RULE_MAX
  const userBudget = applyBudget(
    parts.userAlways.map((rule) => ({ key: rule.name, content: rule.body })),
    perRule,
    options.userRulesTotal ?? USER_RULES_TOTAL_MAX,
  )
  const projectBudget = applyBudget(
    parts.projectAlways.map((rule) => ({ key: rule.name, content: rule.body })),
    perRule,
    options.projectRulesTotal ?? PROJECT_RULES_TOTAL_MAX,
  )

  const sections: string[] = []

  // A tier renders when it has kept content *or* something was omitted. The
  // second case matters: if every rule in a tier is dropped for budget, an
  // empty section would silence the omission notice and the rules would
  // disappear without a trace. The notice is the only evidence they exist.
  if (userBudget.kept.length > 0 || userBudget.omitted.length > 0) {
    sections.push(
      '<always_applied_user_rules description="These are rules set by the user that you should follow if appropriate.">\n'
      + `${userBudget.kept.join('\n')}\n`
      + `${formatOmittedLine(userBudget.omitted)}\n`
      + '</always_applied_user_rules>\n',
    )
  }
  if (projectBudget.kept.length > 0 || projectBudget.omitted.length > 0) {
    sections.push(
      '<always_applied_workspace_rules description="These are rules set by the project that you should follow if appropriate.">\n'
      + `${projectBudget.kept.join('\n')}\n`
      + `${formatOmittedLine(projectBudget.omitted)}\n`
      + '</always_applied_workspace_rules>\n',
    )
  }
  if (parts.projectRequested.length > 0) {
    sections.push(requestableSection(
      'agent_requestable_workspace_rules',
      'workspace-level',
      parts.projectRequested.map(catalogLine).join('\n'),
    ))
  }
  if (parts.userRequested.length > 0) {
    sections.push(requestableSection(
      'agent_requestable_user_rules',
      'user-level',
      parts.userRequested.map(catalogLine).join('\n'),
    ))
  }

  if (sections.length === 0) return ''

  const preamble = 'The rules section has a number of possible rules/context that you should consider. '
    + 'In each subsection, we provide instructions about what information the subsection contains and how you should consider/follow the contents of the subsection. '
    + 'Explicit user rules take precedence over default tool preferences described in tool descriptions.\n'
  return `<rules>\n${preamble}${sections.join('')}</rules>`
}
