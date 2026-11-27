/**
 * The `read_rules` tool: fetch rule bodies the catalog only described.
 *
 * Four-tier key resolution and the 60000-character output budget are both
 * CodeBuddy's (§6). Resolution is deliberately forgiving — models routinely
 * pass a bare filename instead of the absolute path — but it never guesses:
 * an ambiguous key reports its candidates so the model can retry precisely.
 *
 * `output.render` is mandatory on a tool definition: it is the pure projection
 * from a validated canonical value to model content. See
 * `dsh-tool-skill/src/index.ts` for the same shape.
 */
import { basename } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { consumeOutputBudget, READ_RULES_OUTPUT_MAX } from './budget.ts'

/** A rule available to `read_rules` this turn. */
export interface RequestableRule {
  readonly path: string
  readonly name: string
  readonly body: string
}

/** Index keyed by absolute path, as shown in the catalog. */
export type RequestableIndex = Readonly<Record<string, RequestableRule>>

export interface Resolution {
  readonly resolved: readonly RequestableRule[]
  readonly notFound: readonly string[]
  readonly ambiguous: readonly { input: string; candidates: readonly string[] }[]
}

/**
 * Resolve requested keys against the index.
 *
 * Tiers, in order: exact absolute path; case-insensitive path; unique
 * basename; unique rule name. More than one candidate at either of the last
 * two tiers is reported as ambiguous rather than picked arbitrarily.
 */
export function resolveRequested(index: RequestableIndex, requested: readonly string[]): Resolution {
  const keys = Object.keys(index)
  const lower = new Map(keys.map((key) => [key.toLowerCase(), key]))
  const resolved: RequestableRule[] = []
  const notFound: string[] = []
  const ambiguous: { input: string; candidates: readonly string[] }[] = []
  const taken = new Set<string>()

  for (const raw of requested) {
    const input = raw.trim()
    if (input === '') continue

    let hit: string | undefined
    if (index[input] !== undefined) {
      hit = input
    } else {
      const ci = lower.get(input.toLowerCase())
      if (ci !== undefined) {
        hit = ci
      } else {
        const byBase = keys.filter((key) => basename(key) === basename(input))
        if (byBase.length === 1) hit = byBase[0]
        else if (byBase.length > 1) { ambiguous.push({ input, candidates: byBase }); continue }
        else {
          const byName = keys.filter((key) => index[key]?.name === input)
          if (byName.length === 1) hit = byName[0]
          else if (byName.length > 1) { ambiguous.push({ input, candidates: byName }); continue }
        }
      }
    }

    if (hit === undefined) { notFound.push(input); continue }
    if (taken.has(hit)) continue
    taken.add(hit)
    const rule = index[hit]
    if (rule !== undefined) resolved.push(rule)
  }
  return { resolved, notFound, ambiguous }
}

/** Format resolved rules as `<rule>` blocks under the output budget. */
export function formatResolved(resolution: Resolution, total: number = READ_RULES_OUTPUT_MAX): string {
  const blocks = resolution.resolved.map((rule) =>
    `<rule name="${rule.name}" scope="rule" path="${rule.path}">\n${rule.body}\n</rule>`,
  )
  const { kept, truncated } = consumeOutputBudget(blocks, total)
  const out = [...kept]
  if (resolution.notFound.length > 0) {
    out.push(`[Not found (not in the requestable rules list): ${resolution.notFound.join(', ')}]`)
  }
  if (resolution.ambiguous.length > 0) {
    const list = resolution.ambiguous
      .map((entry) => `${entry.input} -> ${entry.candidates.join(' | ')}`)
      .join('; ')
    out.push(`[Ambiguous (matched more than one rule): ${list}. Retry with one exact absolute path from that list.]`)
  }
  if (truncated) out.push('[Some rule content was truncated to fit the read_rules output budget.]')
  return out.join('\n\n')
}

/** Canonical value the tool returns; `render` turns it into model content. */
export interface ReadRulesValue {
  readonly content: string
  readonly resolvedCount: number
  readonly notFoundCount: number
  readonly ambiguousCount: number
}

/**
 * Build the tool definition.
 *
 * The index is resolved **per call**, from `exec.agent`, because the tool is
 * registered once but each agent has its own catalog. `exec.agent` is the same
 * field the host's own `skill` tool reads (`dsh-tool-skill/src/index.ts:136`).
 */
export function createReadRulesTool(
  indexFor: (agent: Agent | undefined) => RequestableIndex,
  outputMax: number = READ_RULES_OUTPUT_MAX,
) {
  return defineTool({
    name: 'read_rules',
    description:
      'Load rules listed in <agent_requestable_workspace_rules> or <agent_requestable_user_rules>.\n'
      + 'When a listed description matches the task, fetch the rule before acting. Batch relevant keys in one call.\n'
      + 'Always-applied rules are already in context; do not fetch them again. '
      + 'Only listed keys are allowed, not arbitrary files.\n'
      + 'When one key matches several rules, the result lists the candidates; retry with one exact absolute path.',
    parameters: {
      ruleNames: {
        type: 'array',
        required: true,
        description: 'Array of exact rule keys (absolute paths) from the requestable-rules sections.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
          resolvedCount: { type: 'number', required: true },
          notFoundCount: { type: 'number', required: true },
          ambiguousCount: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String((value as ReadRulesValue).content) }],
    },
    async execute(args, exec) {
      // `defineTool` validates the parameter schema before `execute` runs:
      // https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/tools
      // (`@deepseek-ai/dsh-tools` declares that directory as its source, and the
      // bundled `lib/index.js` of the installed copy is where the check happens.)
      // So `ruleNames` is always an array here, and a guard for the other shape
      // would be an unreachable arm. The filter is not decorative: a model can
      // put a number or a null inside that array.
      const { ruleNames } = args as { ruleNames: readonly unknown[] }
      const requested = ruleNames.filter((name): name is string => typeof name === 'string')
      const resolution = resolveRequested(indexFor(exec.agent), requested)
      const content = formatResolved(resolution, outputMax)
      const value: ReadRulesValue = {
        content,
        resolvedCount: resolution.resolved.length,
        notFoundCount: resolution.notFound.length,
        ambiguousCount: resolution.ambiguous.length,
      }
      return value
    },
  })
}
