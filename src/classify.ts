/**
 * Decide whether a file is an agent rule, and which convention it follows.
 *
 * Two separate questions, deliberately answered by two different signals:
 *
 * 1. **Is this a rule at all?** Answered from the frontmatter. A directory
 *    named `rules` means four unrelated things across agents (§13.1), so a
 *    file with no recognizable rule field is rejected rather than guessed at.
 *    This is what keeps Codex's `prefix_rule(...)` permission lists and
 *    cc-safety-net's JSON policies out of the catalog.
 *
 * 2. **Which convention?** Answered from the **source directory**, because the
 *    frontmatter does not identify it reliably: Cursor's documented example
 *    carries `description`, `globs` *and* `alwaysApply` together, so any
 *    frontmatter-only ordering misclassifies it. The known directory is the
 *    dependable signal; frontmatter is used only to refine within a source
 *    (CodeBuddy's intranet build shares `.codebuddy/rules` with the public one).
 */
import type { Frontmatter } from './parse.ts'
import type { EmptyRuleType, RuleFamily } from './types.ts'

export interface Classification {
  readonly family: RuleFamily
  /** Whether the file looks like an agent rule file at all. */
  readonly isRule: boolean
  /** False when the file was rejected, so the caller can log a reason. */
  readonly reason?: string
}

/**
 * Rule-looking frontmatter fields.
 *
 * `type` is included because CodeBuddy's intranet build declares its state
 * that way and nothing else (§13.2). `trigger` is Antigravity's equivalent for
 * `.agents/rules`. `alwaysApply`, `globs`, `paths` and `enabled` each appear
 * in at least one supported convention.
 *
 * `name` and `applyTo` are here because two conventions have no other field: a
 * Continue rule's documented minimum is a `name`, and Copilot's
 * `.instructions.md` requires an `applyTo` and nothing else. A file carrying
 * one of them is that convention's rule, not a stray markdown file.
 *
 * `scene`, `excludeAgent` and `regex` are here for the same reason: Trae
 * documents a file whose only field is `scene: git_message`, and a rule scoped
 * by `regex` (Continue) or filtered by `excludeAgent` (Copilot) is still a
 * rule. CodeBuddy's `updatedAt` / `provider` are deliberately absent: they
 * are metadata a tool wrote and say nothing about whether the file is a rule,
 * so a file carrying only those still goes through the source's own answer for
 * files that declare nothing.
 */
const RULE_FIELDS = ['alwaysApply', 'enabled', 'globs', 'paths', 'type', 'trigger', 'inclusion', 'name', 'applyTo', 'scene', 'excludeAgent', 'regex'] as const

/**
 * Values accepted for a rule's `type` field.
 *
 * The three plain names are the shared vocabulary. Kiro spells the same three
 * states in `inclusion` rather than `type` and Augment Code spells them
 * `always_apply` / `agent_requested` / `manual` in `type`; both are accepted so
 * a file from either convention classifies instead of being reported as an
 * unknown type. Mapping a spelling onto a state is the parser's job.
 *
 * `always on` is JetBrains': the rule file its AI Assistant documentation
 * links to carries a `type: always on` beside a `pattern` naming Java sources,
 * and the IDE's own control is named Always. Rejecting the file over its
 * spacing would drop an example the vendor ships.
 */
const KNOWN_TYPES = ['always', 'requested', 'manual', 'always_apply', 'agent_requested', 'always on'] as const

/**
 * Values accepted for Antigravity's `trigger` field.
 *
 * `always` and `auto` are the `agent-rules-spec` aliases of `always_on` and
 * `model_decision`. `agent` is Devin's name for the agent-decided mode, which
 * its CLI page lists beside the others.
 */
const KNOWN_TRIGGERS = ['always_on', 'always', 'model_decision', 'auto', 'glob', 'manual', 'agent'] as const

export interface ClassifyInput {
  readonly frontmatter: Frontmatter
  /** Source key from the scan table, e.g. `codebuddy`, `cursor`, `claude`. */
  readonly sourceKey: string
  /**
   * Whether a missing or unrecognized `trigger` disqualifies the file.
   *
   * Passed in by the caller from its source table (the `.agents` source sets
   * the flag) instead of being inferred here from the key, so the rule lives in
   * one place and stays testable.
   */
  readonly strict?: boolean
  /**
   * What a file with no rule-looking field and no description means here.
   *
   * Set by the caller from its source table. Every value except `none` accepts
   * such a file, because each of those conventions documents the file as one of
   * its rules; `none` keeps the gate rejecting it. Like `strict`, the answer
   * travels with the source instead of being guessed from its key here.
   */
  readonly emptyRuleType?: EmptyRuleType
}

export function classify(input: ClassifyInput): Classification {
  const { frontmatter, sourceKey } = input
  const values = frontmatter.values

  const hasRuleField = RULE_FIELDS.some((field) => field in values)
  const described = typeof values['description'] === 'string' && values['description'].trim() !== ''
  const empty = input.emptyRuleType ?? 'none'
  if (!hasRuleField && !described) {
    // A source's answer about empty files only reaches files that could be a
    // rule to begin with. Three shapes are rejected for every convention: a
    // binary file is not text, a fence that never closes cannot be split into
    // metadata and body, and a file with nothing in it would inject an empty
    // string. Everything else here is the source's own decision.
    const body = frontmatter.body
    if (body.includes('\u0000')) {
      return { family: familyOf(sourceKey), isRule: false, reason: '文件是二进制内容' }
    }
    if (frontmatter.fenced === false && body.trimStart().startsWith('---')) {
      return { family: familyOf(sourceKey), isRule: false, reason: 'frontmatter 围栏没有闭合' }
    }
    if (body.replace(/[\u0000-\u001f\u007f]/g, '').trim() === '') {
      return { family: familyOf(sourceKey), isRule: false, reason: '文件没有任何内容' }
    }
    // A file whose every line is a call expression is a configuration DSL, not
    // prose. Codex writes permission lists as `prefix_rule(pattern=[...],
    // decision="allow")` and users drop them into directories named rules too;
    // no supported convention reads such a file as a rule, so this holds for
    // every value of the source's empty-file answer.
    const calls = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
    if (calls.length > 0 && calls.every((line) => /^[A-Za-z_][A-Za-z0-9_.]*\s*\([\s\S]*\)$/.test(line))) {
      return { family: familyOf(sourceKey), isRule: false, reason: '文件是配置语句而不是规则文本' }
    }
    if (empty === 'none') {
      return { family: familyOf(sourceKey), isRule: false, reason: '没有可识别的规则字段' }
    }
  }

  // A strict source requires its own declared field. Antigravity drops a file
  // with no valid `trigger` rather than deriving a state from whatever else is
  // present, so a plain markdown note under .agents/rules stays out. Only
  // `trigger` satisfies this gate: a strict source's documented vocabulary is
  // the trigger table, and reading some other field here would accept files
  // Antigravity itself discards.
  if (input.strict === true) {
    const trigger = typeof values['trigger'] === 'string' ? values['trigger'].trim().toLowerCase() : ''
    if (!(KNOWN_TRIGGERS as readonly string[]).includes(trigger)) {
      return {
        family: familyOf(sourceKey),
        isRule: false,
        reason: trigger === '' ? '缺少 trigger 字段（严格来源）' : '未知的 trigger 值：' + trigger,
      }
    }
  }

  // A `type` value outside the known set means this is not a rule of any
  // supported convention; treat it as unrecognized rather than assuming a
  // state. The wording stays convention-neutral: the field is declared by
  // several of them, so naming CodeBuddy here would mislead on the other files.
  const declared = typeof values['type'] === 'string' ? values['type'].trim().toLowerCase() : ''
  if (declared !== '' && !(KNOWN_TYPES as readonly string[]).includes(declared)) {
    return { family: familyOf(sourceKey), isRule: false, reason: `未知的 type 值：${declared}` }
  }

  // Within the CodeBuddy directory, `type` distinguishes the intranet variant.
  if (sourceKey === 'codebuddy' && declared !== '') {
    return { family: 'codebuddy-intranet', isRule: true }
  }
  return { family: familyOf(sourceKey), isRule: true }
}

/**
 * Family implied by the source directory.
 *
 * The family name matches the source key for every convention, so the new
 * entries stay a one-to-one mapping. `codebuddy-intranet` never appears here:
 * it is a CodeBuddy variant told apart by frontmatter, not by directory.
 *
 * The default keeps an unrecognised key on `codebuddy` rather than echoing it
 * back: callers render the family as a display grouping, and a key that is not
 * in `SOURCES` cannot be given a label of its own. An unknown key is not
 * rejected — the rule is still classified, only its grouping is conservative.
 */
function familyOf(sourceKey: string): RuleFamily {
  switch (sourceKey) {
    case 'cursor': return 'cursor'
    case 'claude': return 'claude'
    case 'agents': return 'agents'
    case 'codebuddy': return 'codebuddy'
    case 'trae': return 'trae'
    case 'qoder': return 'qoder'
    case 'cline': return 'cline'
    case 'roo': return 'roo'
    case 'devin': return 'devin'
    case 'windsurf': return 'windsurf'
    case 'copilot': return 'copilot'
    case 'junie': return 'junie'
    case 'amazonq': return 'amazonq'
    case 'tabnine': return 'tabnine'
    case 'continue': return 'continue'
    case 'trae-cn': return 'trae-cn'
    case 'qoder-cn': return 'qoder-cn'
    case 'lingma': return 'lingma'
    case 'aiassistant': return 'aiassistant'
    case 'antigravity': return 'antigravity'
    case 'kiro': return 'kiro'
    case 'augment': return 'augment'
    default: return 'codebuddy'
  }
}
