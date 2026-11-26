/**
 * Minimal frontmatter parser and three-state derivation.
 *
 * Deliberately dependency-free: the needed YAML subset is scalars and simple
 * block/flow lists, and a hand-written parser is smaller, faster to load, and
 * easier to reason about than pulling in a full YAML engine. The reference
 * implementation in @michengai/dsh-skills-manager does the same.
 */
import { basename, extname } from 'node:path'
import type { Diagnostic, EmptyRuleType, Rule, RuleFamily, RuleScope, RuleType } from './types.ts'
import { estimateTokens } from './token-count.ts'

/**
 * `---` fences at the very start, tolerating a UTF-8 BOM and CRLF.
 *
 * The block itself may be empty: CodeBuddy's documented always-applied example
 * declares a frontmatter holding nothing but a comment, and two markers with
 * nothing between them declare the same thing. Without the optional inner
 * newline that shape was not recognised as a fence at all, so it arrived at the
 * classifier as bare markdown and was reported as an unclosed fence.
 */
const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

/**
 * Keys we read. Anything else is ignored (Claude Code ignores them too).
 *
 * The list is the union of what the supported conventions document, because a
 * field this parser does not read is a field that disappears: Trae's `scene`,
 * Copilot's `excludeAgent`, Continue's `regex` and CodeBuddy's `updatedAt` /
 * `provider` metadata all reach `values` now, even where nothing acts on them
 * yet. `applyTo` is Copilot's only required field on an `.instructions.md`
 * file, so reading it is what lets a file that declares nothing else be
 * recognised at all.
 *
 * `glob`, `pattern` and `fileMatchPattern` are the singular spellings of the
 * same idea: Qoder documents `glob` as equivalent to `paths`, Antigravity
 * accepts `glob` beside `globs`, Kiro scopes a `fileMatch` rule with
 * `fileMatchPattern`, and JetBrains writes `pattern` in the example file it
 * publishes.
 */
const SCALAR_KEYS = ['name', 'description', 'alwaysApply', 'enabled', 'type', 'trigger', 'inclusion', 'applyTo', 'scene', 'excludeAgent', 'regex', 'updatedAt', 'provider'] as const
const LIST_KEYS = ['paths', 'globs', 'glob', 'pattern', 'fileMatchPattern'] as const

/**
 * Fields whose accepted values are a closed set.
 *
 * A trailing `#` comment is stripped from these only. `description` and `name`
 * are free text and are never touched, so `description: 处理 #1 问题` survives
 * intact even though strict YAML would cut it. Kiro's `inclusion` and Trae's
 * `scene` are closed vocabularies too, so they take the same treatment as
 * `trigger` instead of carrying a comment into the value.
 */
const COMMENT_KEYS = new Set(['alwaysApply', 'enabled', 'type', 'trigger', 'inclusion', 'scene'])

export interface Frontmatter {
  readonly values: Readonly<Record<string, string | readonly string[]>>
  readonly body: string
  readonly diagnostics: readonly Diagnostic[]
  /**
   * File line number of each key, 1-based, for diagnostics that point at a line.
   *
   * The parse loop counts inside the fenced block, which starts on the file's
   * second line, so the index it holds is never the number a reader would count
   * in their editor. Absent when there was no fence at all.
   */
  readonly lines?: Readonly<Record<string, number>>
  /**
   * Whether a fenced block was found at all. A file with no fence is not the
   * same as one whose fence parsed to nothing: conventions differ on whether
   * a bare markdown file in their directory is one of their rules.
   */
  readonly fenced: boolean
}

/** Split a `---`-fenced block from the body. */
export function splitFrontmatter(text: string): Frontmatter {
  const diagnostics: Diagnostic[] = []
  const match = FRONTMATTER.exec(text)
  if (match === null) return { values: {}, body: text, diagnostics, fenced: false }

  const raw = match[1] ?? ''
  const body = text.slice(match[0].length)
  const values: Record<string, string | readonly string[]> = {}

  const lines = raw.split(/\r?\n/)
  // The BOM and the opening `---` are two lines the loop never sees, so every
  // index it produces is short by exactly that much.
  const lineOf = (index: number): number => index + 2
  const keyLines: Record<string, number> = {}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (kv === null) {
      diagnostics.push({ code: 'fm.malformed', detail: `无法解析的行：${line.trim().slice(0, 60)}`, line: lineOf(i) })
      continue
    }
    const key = kv[1] ?? ''
    const inline = (kv[2] ?? '').trim()
    keyLines[key] = lineOf(i)

    if ((LIST_KEYS as readonly string[]).includes(key)) {
      values[key] = readList(lines, i, inline, diagnostics, key, lineOf(i))
      // A block list consumed following lines; skip them.
      if (inline === '') i = skipBlockList(lines, i)
      continue
    }
    if ((SCALAR_KEYS as readonly string[]).includes(key)) {
      // Free-text fields keep a `#` verbatim: a description may legitimately
      // contain one. Only closed-vocabulary fields take the YAML comment rule.
      values[key] = unquote(COMMENT_KEYS.has(key) ? stripInlineComment(inline) : inline)
    }
    // Any other key is ignored silently — matches Claude Code's documented
    // behavior that "any other field is ignored without an error".
  }
  return { values, body, diagnostics, lines: keyLines, fenced: true }
}

/**
 * Read a flow list (`[a, b]` / `a, b`) or a block list (`- a`).
 *
 * `key` is carried only so the diagnostic can name the field it is about:
 * "the list field is empty" is not actionable when a file may declare two, and
 * `line` is the *file* line so the reader can open the file at it.
 */
function readList(
  lines: readonly string[],
  index: number,
  inline: string,
  diagnostics: Diagnostic[],
  key: string,
  keyLine: number,
): readonly string[] {
  if (inline !== '') {
    // Unquote the whole value before splitting. Antigravity writes a list as
    // one quoted comma string (`globs: "*.ts, *.tsx"`), and splitting first
    // would leave the outer quotes glued to the first and last pattern.
    const outer = unquote(inline)
    const inner = outer.startsWith('[') && outer.endsWith(']') ? outer.slice(1, -1) : outer
    const parts = splitListItems(inner).map((part) => unquote(part.trim())).filter((part) => part !== '')
    // `paths: []` is a declared empty list, not a missing one, and it means the
    // opposite of what the derived state will show: Cline documents it as "the
    // rule never activates. Use this to temporarily disable a rule." The three
    // states cannot express that, so the file keeps its derived state and this
    // diagnosis says what the empty list was for.
    if (parts.length === 0) diagnostics.push({ code: 'list.empty', detail: `列表字段声明为空：${key}`, line: keyLine })
    return parts
  }
  const out: string[] = []
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const item = /^\s*-\s*(.*)$/.exec(line)
    if (item === null) break
    // Cline comments each pattern in its own example (- "src/**"  # All files
    // under src/), so the comment is cut before the quotes are peeled.
    const value = unquote(stripInlineComment((item[1] ?? '').trim()))
    if (value !== '') out.push(value)
  }
  if (out.length === 0) diagnostics.push({ code: 'fm.emptyList', detail: `列表字段为空：${key}`, line: keyLine })
  return out
}

/**
 * Split on commas that are not inside quotes, braces, or brackets.
 *
 * A brace expansion such as a glob ending in "{js,ts}" carries a meaningful
 * comma: picomatch expands it, so a blind split turns one working pattern into
 * two broken halves. Brackets are tracked for the same reason (a character
 * class may contain a comma), and quotes so `["a,b", "c"]` stays two items.
 */
function splitListItems(text: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  let braces = 0
  let brackets = 0
  for (const ch of text) {
    if (quote !== null) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if (ch === '{') { braces++; current += ch; continue }
    if (ch === '}') { braces = Math.max(0, braces - 1); current += ch; continue }
    if (ch === '[') { brackets++; current += ch; continue }
    if (ch === ']') { brackets = Math.max(0, brackets - 1); current += ch; continue }
    if (ch === ',' && braces === 0 && brackets === 0) { out.push(current); current = ''; continue }
    current += ch
  }
  out.push(current)
  return out
}

/** Index of the last line a block list consumed. */
function skipBlockList(lines: readonly string[], index: number): number {
  let last = index
  for (let i = index + 1; i < lines.length; i++) {
    if (!/^\s*-\s*/.test(lines[i] ?? '')) break
    last = i
  }
  return last
}

/**
 * Cut a trailing `#` comment from a closed-vocabulary value.
 *
 * YAML requires whitespace before the marker, and a quoted value is returned
 * untouched, so `globs: "a#b"` and `type: always # note` both behave.
 */
function stripInlineComment(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value
  }
  const match = /(^|\s)#/.exec(value)
  return match === null || match.index === undefined ? value : value.slice(0, match.index).trimEnd()
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1)
  }
  return value
}

export interface DeriveInput {
  readonly path: string
  readonly family: RuleFamily
  readonly sourceKey: string
  /** Which tier the file came from; see `Rule.scope`. */
  readonly scope: RuleScope
  /** Strict sources drop a file with no usable `trigger`; see `classify`. */
  readonly strict?: boolean
  /**
   * What a file that declares nothing at all means for this convention.
   *
   * Most conventions apply such a file to every request and some make it
   * on-demand, so the answer is per source and travels here from the scan
   * table. `none` keeps the older behaviour: a file with no rule field is not
   * a rule, which is what the classify gate enforces before parsing.
   */
  readonly emptyRuleType?: EmptyRuleType
  /**
   * The user tier's own answer, when it differs from {@link emptyRuleType}.
   *
   * Augment documents that a rule under `~/.augment/rules/` is always-on
   * whatever its frontmatter says, so the scope — known here — decides which
   * answer applies instead of a second pass over the scan results.
   */
  readonly userRuleType?: EmptyRuleType
  readonly values: Readonly<Record<string, string | readonly string[]>>
  readonly body: string
  /** File line of each frontmatter key; see {@link splitFrontmatter}. */
  readonly lines?: Readonly<Record<string, number>>
  /** Mutable: derivation appends its own diagnostics to the parse ones. */
  readonly diagnostics: Diagnostic[]
}

/**
 * Derive the three-state value.
 *
 * Three declarations are honored, in this order, before the derived formula:
 *
 * 1. `trigger` - Antigravity / `agent-rules-spec`: `always_on` or `always`,
 *    `model_decision` or `auto`, `glob`, or `manual`.
 * 2. `type` - CodeBuddy's intranet build: `always` | `requested` | `manual`.
 * 3. CodeBuddy public order: `alwaysApply` wins, then a non-empty
 *    `description`, else manual.
 *
 * Values are compared case-insensitively, and an unrecognized value is
 * reported and falls through to the older rungs. A strict source never reaches
 * that fallback, because `classify` rejects such a file first.
 */
/** `trigger` aliases, mapped onto the three internal states. */
const TRIGGER_TYPES: Readonly<Record<string, RuleType>> = {
  // Kiro's `inclusion` modes are read through this table: "always" is the
  // default always-on state, "fileMatch" and "auto" both scope a rule to
  // matching paths, and "manual" is invoked by name. Kiro's own patterns live in
  // `fileMatchPattern`, which this plugin does not read yet, so a fileMatch rule
  // is a requested rule with no patterns.
  filematch: 'requested',
  always_on: 'always',
  always: 'always',
  model_decision: 'requested',
  auto: 'requested',
  glob: 'requested',
  manual: 'manual',
  // Devin's CLI page lists the same vocabulary with one more value: "the
  // trigger values always_on, manual, model_decision, agent, and glob all
  // apply". `agent` is the agent-decided mode, so it maps onto `requested`
  // exactly like `model_decision` does.
  agent: 'requested',
}

export function deriveRule(input: DeriveInput): Rule {
  const { values, diagnostics } = input
  // Every diagnosis below names the file line its key was declared on, so the
  // panel can send a reader to the right place instead of only naming the
  // problem. A key with no recorded line (an unfenced file) omits it.
  const lines = input.lines ?? {}
  const report = (key: string, code: string, detail: string): void => {
    const line = lines[key]
    diagnostics.push(line === undefined ? { code, detail } : { code, detail, line })
  }
  const alwaysApply = values['alwaysApply'] === 'true'
  const enabled = values['enabled'] !== 'false'
  const description = typeof values['description'] === 'string' ? values['description'].trim() : ''
  const declared = typeof values['type'] === 'string' ? values['type'].trim().toLowerCase() : ''
  // Kiro names the same three states in `inclusion` instead of `trigger`, and
  // its page spells one mode "fileMatch (formerly auto)". Reading the field here
  // keeps one mapping table for both vocabularies.
  const declaredTrigger = typeof values['trigger'] === 'string' ? values['trigger'].trim().toLowerCase() : ''
  const trigger = typeof values['inclusion'] === 'string'
    ? values['inclusion'].trim().toLowerCase()
    : declaredTrigger
  // Every source collects both spellings, so a rule whose `trigger: glob` names
  // its files gets them here without a second code path. The singular keys are
  // the same concept where they appear: Qoder documents `glob` as equivalent to
  // `paths`, Antigravity accepts a singular `glob:`, Kiro scopes a fileMatch
  // rule with `fileMatchPattern` alone, and JetBrains writes `pattern`.
  const patterns = [
    ...asArray(values['paths']),
    ...asArray(values['globs']),
    ...asArray(values['glob']),
    ...asArray(values['pattern']),
    ...asArray(values['fileMatchPattern']),
    // Copilot spells file scoping applyTo; it is the same concept, so a rule
    // that carries it belongs in the on-demand state rather than in manual.
    ...asArray(values['applyTo']),
  ]
  // Continue scopes a rule by file *content* with `regex`. That is a statement
  // about when the rule applies, exactly like a glob is, so it has to count as
  // one below - otherwise a regex-only file would fall through to the source's
  // answer for files that declare nothing at all.
  const regex = typeof values['regex'] === 'string' ? values['regex'].trim() : ''

  const triggered = TRIGGER_TYPES[trigger]
  if (input.strict === true && triggered === undefined) {
    // Unreachable through scanAll, which rejects this file before parsing.
    report('trigger', 'trigger.missing', '严格来源缺少有效的 trigger 字段')
  }

  let type: RuleType
  // A tier can answer before the file does. Augment documents that a rule under
  // `~/.augment/rules/` "is always treated as always_apply" and that user rules
  // "do not support other frontmatter types", while the same file shape in a
  // workspace keeps the normal derivation below. The scope is known here, so
  // the tier's answer lands once, ahead of every declaration.
  const tierAnswer = input.scope === 'user' ? input.userRuleType : undefined
  if (tierAnswer !== undefined && tierAnswer !== 'none') {
    type = tierAnswer
    // Said out loud, because the file's own frontmatter is being ignored and
    // the panel is the only place that can explain why the state looks wrong.
    if (declared !== '' || trigger !== '' || values['alwaysApply'] !== undefined) {
      report('type', 'type.tierOverridden', `用户级规则不受 frontmatter 影响，固定为 ${tierAnswer}`)
    }
  } else if (triggered !== undefined) {
    type = triggered
  } else {
    if (trigger !== '') {
      report('trigger', 'trigger.unknown', '未知的 trigger 值：' + trigger + '，已按推导规则处理')
    }
    if (declared === 'always' || declared === 'requested' || declared === 'manual') {
      type = declared
    } else if (declared === 'always_apply' || declared === 'agent_requested' || declared === 'always on') {
      // Augment Code spells the always-on state `always_apply`, and JetBrains
      // writes `type: always on` in the example rule file it publishes. Both
      // name the same state, and the space is theirs, so it is compared as is.
      type = declared === 'agent_requested' ? 'requested' : 'always'
    } else {
      if (declared !== '') {
        report('type', 'type.unknown', '未知的 type 值：' + declared + '，已按推导规则处理')
      }
      // A file that declares nothing at all is the only case the source's own
      // answer decides: Cline and CodeBuddy apply such a file to every request,
      // Cursor's documented table puts an `.mdc` with no state field behind an
      // @-mention, and Copilot's instruction file is inert without `applyTo`.
      // Anything that declares a field keeps the normal derivation below.
      // "Declares nothing" has to include the boolean fields: a file whose
      // only line is alwaysApply: false has declared its state, so the
      // source's answer for empty files must not overrule it.
      const declaredNothing = values['alwaysApply'] === undefined && values['enabled'] === undefined
      const undeclared = declaredNothing && description === '' && trigger === '' && declared === '' && patterns.length === 0 && regex === ''
      const empty = input.emptyRuleType ?? 'none'
      type = empty !== 'none' && undeclared
        ? empty
        // A file scoped to paths is on-demand even with no description: Claude
        // Code loads it when a matching file is touched, and Continue's globs
        // pull it in the same way, so reading it as manual would invert it.
        // A `regex` scope lands in the same state; it counts as a declaration
        // above so that it never reaches this rung as an empty file.
        : alwaysApply ? 'always'
          : description !== '' ? 'requested'
            : patterns.length > 0 || regex !== '' ? 'requested'
              : 'manual'
    }
  }

  if (type === 'requested' && description === '') {
    report('description', 'requested.noDescription', 'requested 类型缺少 description')
  }

  const name = typeof values['name'] === 'string' && values['name'] !== ''
    ? values['name']
    : basename(input.path, extname(input.path))

  return {
    path: input.path,
    name,
    type,
    enabled,
    description,
    body: input.body,
    family: input.family,
    sourceKey: input.sourceKey,
    scope: input.scope,
    patterns,
    descriptionTokens: estimateTokens(description),
    bodyTokens: estimateTokens(input.body),
    diagnostics,
  }
}

function asArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return []
  if (typeof value === 'string') return value === '' ? [] : [value]
  return value
}

/** Convenience: text + context -> Rule + diagnostics. */
export function parseRule(
  text: string,
  context: {
    path: string
    family: RuleFamily
    sourceKey: string
    scope: RuleScope
    strict?: boolean
    emptyRuleType?: EmptyRuleType
    /** The user tier's answer when the convention gives a different one. */
    userRuleType?: EmptyRuleType
  },
): { rule: Rule; diagnostics: readonly Diagnostic[] } {
  const fm = splitFrontmatter(text)
  const rule = deriveRule({
    path: context.path,
    family: context.family,
    sourceKey: context.sourceKey,
    scope: context.scope,
    strict: context.strict,
    emptyRuleType: context.emptyRuleType,
    userRuleType: context.userRuleType,
    values: fm.values,
    body: fm.body,
    lines: fm.lines,
    diagnostics: [...fm.diagnostics],
  })
  return { rule, diagnostics: rule.diagnostics }
}
