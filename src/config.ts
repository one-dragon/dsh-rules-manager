/**
 * Optional config, read from the plugin entry's `config:` block.
 *
 * Every field has a working default, so the plugin runs with no configuration.
 * Panel-editable values live in state.json instead; this block is for
 * deployment-time pinning only.
 *
 * The `Config: z<Config>` annotation is the host's own pattern: schemastery
 * validates and defaults the value, while the interface gives the plugin a
 * plain type to read. See `dsh-tool-skill/src/index.ts`.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { PER_RULE_MAX, PROJECT_RULES_TOTAL_MAX, READ_RULES_OUTPUT_MAX, USER_RULES_TOTAL_MAX } from './budget.ts'

export interface Config {
  /**
   * Pins where state.json lives. Empty means **unpinned**, and the fallback
   * chain in `state.ts` decides: `DSH_RULES_MANAGER_HOME`, then
   * `<home>/.dsh/rules-manager`.
   *
   * Empty rather than the resolved home directory on purpose: schemastery
   * cannot tell a default from an explicit value (measured: `Config({})` and
   * `Config({ stateDir: <home> })` produce the same string). A computed default
   * would therefore make `apply`'s `setStateDir` fire on every run and pin the
   * directory, so `DSH_RULES_MANAGER_HOME` could never take effect.
   */
  stateDir: string
  /**
   * Per-rule cap, in characters. At least 100: the truncation note is itself
   * about 35 characters, so a smaller cap would run past the cap it announces.
   * At most 2,000,000, which is already a megabyte of a single rule.
   */
  perRuleMax: number
  /** Total cap for user-scope always-on rules, 0 to 2,000,000 characters. */
  userRulesTotal: number
  /** Total cap for project-scope always-on rules, 0 to 2,000,000 characters. */
  projectRulesTotal: number
  /** Total cap for one read_rules result, 1,000 to 4,000,000 characters. */
  readRulesOutput: number
  /**
   * Recursion depth cap per source root. 0 reads the root only. At most 100:
   * the deepest layout any convention documents is four levels, so a pin past
   * this is a typo rather than a layout.
   */
  maxScanDepth: number
  /** Inject the rules block at all. */
  injectRules: boolean
}

export const Config: z<Config> = z.object({
  // Empty is the "unset" sentinel; see the interface comment above.
  stateDir: z.string().default(''),
  // Bounded on purpose. Measured before the bounds existed: `-1` was accepted
  // and truncated every rule at `-1 chars`, and `NaN` skipped truncation
  // entirely, so a typo in a deployment pin turned into silent nonsense. A
  // `null` still resolves to the default (measured), so a half-written block
  // degrades instead of failing to load.
  // The defaults are the budget module's own constants, not repeated numbers:
  // a deployment that pins nothing must get exactly what the renderer and the
  // cost model already assume.
  perRuleMax: z.number().step(1).min(100).max(2_000_000).default(PER_RULE_MAX),
  userRulesTotal: z.number().step(1).min(0).max(2_000_000).default(USER_RULES_TOTAL_MAX),
  projectRulesTotal: z.number().step(1).min(0).max(2_000_000).default(PROJECT_RULES_TOTAL_MAX),
  readRulesOutput: z.number().step(1).min(1000).max(4_000_000).default(READ_RULES_OUTPUT_MAX),
  maxScanDepth: z.number().step(1).min(0).max(100).default(6),
  injectRules: z.boolean().default(true),
})
