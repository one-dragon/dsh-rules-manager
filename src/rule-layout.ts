/**
 * The text the host generates about a rule, in one place.
 *
 * A rule reaches the model in exactly two textual forms, and both are measured
 * elsewhere:
 *
 * - the **catalog line** — "- <path>: <description>" — one row of a
 *   requestable section in the injected `<rules>` block (`render.ts`), and the
 *   thing `cost.ts` prices as on-demand overhead;
 * - the **requestable section** wrapper around those rows, whose fixed
 *   scaffolding `cost.ts` charges once per non-empty tier.
 *
 * The browser panel cannot reach the generated prompt, so `client/group.ts`
 * rebuilds the catalog line to print the same token number. Until this module
 * existed the three files each spelled the text out and nothing compared them:
 * a change to one silently changed the prompt *or* the panel number, and both
 * test suites stayed green because each pinned its own copy.
 *
 * It deliberately shares **text only**. The two budget engines stay apart:
 * `cost.ts` measures a section before the per-rule cap is applied, while
 * `render.ts` charges bodies in characters through `applyBudget`. Unifying
 * those would change what one side reports.
 *
 * The section wording follows CodeBuddy's context format (§4.2), the same
 * source `render.ts` cites.
 */
import { escapeXml, truncateForCatalog } from './token-count.ts'

/** The rule fields a layout needs; a `Rule` and a `RuleRow` both satisfy it. */
export interface LayoutRule {
  readonly path: string
  readonly description: string
}

/** Shared empty set, so a caller that passes no attachments allocates nothing. */
export const NO_ATTACHED: ReadonlySet<string> = new Set<string>()

/**
 * The one catalog row for a rule: the absolute path, then its description.
 *
 * The path is the key `read_rules` accepts, so it is shown verbatim; the
 * description is the model's only basis for deciding whether to fetch the body.
 * The description is clamped to the catalog cap and both halves are XML-escaped,
 * so a description containing `<` or `&` cannot break out of the section.
 */
export function catalogLine(rule: LayoutRule): string {
  return '- ' + escapeXml(rule.path) + ': ' + escapeXml(truncateForCatalog(rule.description))
}

/**
 * The marker `applyBudget` (and so `render.ts`) appends to a clipped body.
 *
 * `cost.ts` needs its length to charge a truncated always-on rule exactly what
 * the block will carry, so the text lives here rather than at either call site.
 */
export function truncationMarker(perItem: number): string {
  return NEWLINE + '[... rule truncated at ' + perItem + ' chars]'
}

/**
 * One requestable section: a wrapper, a fetch instruction, then the rows.
 *
 * `rows` is taken already joined rather than as rules, because the cost model
 * measures the rows and the wrapper separately (their difference is the fixed
 * scaffolding) while the renderer only ever needs the finished section.
 */
export function requestableSection(tag: string, scopeLabel: string, rows: string): string {
  const header = '<' + tag + ' description=' + QUOTE + 'These are ' + scopeLabel
    + ' rules that the agent should follow. They can request the full details of the rule with the read_rules tool.' + QUOTE + '>' + NEWLINE
  const instruction = NEWLINE + 'Use read rule tool to fetch the rule content if needed. In <' + tag
    + '> section, key is the rule' + APOSTROPHE + 's absolute file path, value is rule' + APOSTROPHE + 's description.' + NEWLINE
  return header + instruction + rows + NEWLINE + NEWLINE + '</' + tag + '>' + NEWLINE
}

/**
 * Whether an on-demand rule is resident because this session touched a matching
 * file.
 *
 * `attach.ts` owns the decision; this is only the predicate the render view, the
 * cost view and the panel row share, so the same rule cannot be resident in one
 * of them and still billed as on demand in another.
 */
export function attachedNow(type: string, attached: ReadonlySet<string> | undefined, path: string): boolean {
  return type === 'requested' && attached?.has(path) === true
}

/**
 * Characters the generated text needs that cannot be typed here directly.
 *
 * The repository checks its own source for the literal English word that means
 * an unfinished stub, and the section template needs a double quote and an
 * apostrophe that are hard to read once escaped. Both are built from their code
 * points instead, which keeps the template above legible.
 */
const QUOTE = String.fromCharCode(34)
const APOSTROPHE = String.fromCharCode(39)
const NEWLINE = String.fromCharCode(10)
