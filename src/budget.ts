/**
 * Budgets and truncation for rule content.
 *
 * Constants and the "truncate per item, drop whole items past the total" order
 * are taken from CodeBuddy's applyRuleBudget (see §7). They differ from the
 * per-chain maxBytes the host's own agent-instructions plugin uses, because
 * rules need a per-item cap as well as a per-tier total.
 */
import { truncationMarker } from './rule-layout.ts'

/** Per-rule cap when rendering a rule body inline. */
export const PER_RULE_MAX = 8000
/** Total cap for always-on rules whose scope is the user. */
export const USER_RULES_TOTAL_MAX = 6000
/** Total cap for always-on rules whose scope is the project. */
export const PROJECT_RULES_TOTAL_MAX = 12000
/** Total cap for one `read_rules` result. */
export const READ_RULES_OUTPUT_MAX = 60000

export interface BudgetItem {
  readonly key: string
  readonly content: string
}

export interface BudgetResult {
  /** Content kept, in input order. */
  readonly kept: readonly string[]
  /** Items dropped entirely because the running total would exceed the cap. */
  readonly omitted: readonly { key: string; chars: number }[]
  /** Keys whose content was truncated to the per-item cap. */
  readonly truncated: readonly string[]
}

/**
 * Apply a per-item cap and a total cap.
 *
 * Per item: truncate and keep. Past the total: drop the whole item. The order
 * matters and is deliberate — a rule that is merely long still informs, while
 * one that would blow the budget cannot be included at all.
 */
export function applyBudget(
  items: readonly BudgetItem[],
  perItem: number = PER_RULE_MAX,
  total: number = PROJECT_RULES_TOTAL_MAX,
): BudgetResult {
  const kept: string[] = []
  const omitted: { key: string; chars: number }[] = []
  const truncated: string[] = []
  let used = 0

  for (const item of items) {
    let content = item.content
    if (content.length > perItem) {
      content = safeSlice(content, perItem) + truncationMarker(perItem)
      truncated.push(item.key)
    }
    if (used + content.length > total) {
      omitted.push({ key: item.key, chars: item.content.length })
      continue
    }
    kept.push(content)
    used += content.length
  }
  return { kept, omitted, truncated }
}

/** Human-readable line naming what was dropped, for the rendered block. */
export function formatOmittedLine(omitted: readonly { key: string; chars: number }[]): string {
  if (omitted.length === 0) return ''
  const list = omitted
    .map((item) => `${item.key} (${Math.max(1, Math.round(item.chars / 1024))}KB)`)
    .join(', ')
  return `[... ${omitted.length} rule(s) omitted due to context budget: ${list}]`
}

/**
 * Consume a cumulative budget across whole blocks, in order.
 *
 * Used by `read_rules`, whose output is a sequence of `<rule>` blocks: earlier
 * rules are served in full, later ones truncate or drop. This ordering is why
 * the tool description tells the model to batch keys in one call.
 */
export function consumeOutputBudget(
  blocks: readonly string[],
  total: number = READ_RULES_OUTPUT_MAX,
): { readonly kept: readonly string[]; readonly truncated: boolean } {
  const kept: string[] = []
  let used = 0
  for (const block of blocks) {
    const left = total - used
    if (left <= 0) return { kept, truncated: true }
    if (block.length > left) {
      kept.push(`${safeSlice(block, left)}\n[... rule content truncated due to read_rules output budget]`)
      return { kept, truncated: true }
    }
    kept.push(block)
    used += block.length
  }
  return { kept, truncated: false }
}

/**
 * Slice without leaving a lone high surrogate at the end.
 *
 * A cut that lands *between* the two halves of a surrogate pair leaves the
 * string ending in a high surrogate (U+D800–U+DBFF), which renders as a
 * replacement character. That is the case to fix, so the test is on the high
 * range.
 *
 * Note: CodeBuddy's own `safeSlice` tests the *low* range
 * (`0xDC00 <= c <= 0xDFFF`) — verbatim: `56320<=rn&&rn<=57343?tn.slice(0,-1):tn`.
 * Measured on `"ab😀cd"` with a limit of 4, that drops a complete pair and
 * returns a lone high surrogate; with a limit of 3 it also returns one. The
 * intended guard is on the high range, which is what this implementation does.
 */
export function safeSlice(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}
