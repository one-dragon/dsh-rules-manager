/**
 * File-scoped attachment: which files a session has touched, and the on-demand
 * rules that makes resident.
 *
 * Every convention in the scan table that scopes a rule to files declares it
 * with one of a handful of frontmatter keys - Cursor's `globs`, Claude Code's
 * `paths`, GitHub Copilot's `applyTo`, Kiro's `fileMatchPattern`, Qoder's
 * `glob`, JetBrains AI Assistant's `pattern`. `parse.ts` already folds all of
 * them into `Rule.patterns`. The missing half is this one: a rule whose
 * patterns match a file the session has already worked with should stop being
 * an index line in the requestable section and become resident content.
 *
 * Official sources for the semantics implemented here:
 *
 * - Claude Code keeps a rule on demand only while it is path-scoped, and the
 *   scoping field is the only one read:
 *   "`paths` is the only field Claude Code reads from a rule; any other field
 *   is ignored without an error." and "A path-scoped rule loads when Claude
 *   uses the Read, Write, or Edit tool on a matching file."
 *   https://docs.claude.com/en/docs/claude-code/memory
 * - Cursor attaches on a matching file in context: "Auto-attached when a
 *   matching file is in context." https://cursor.com/docs/rules.md
 * - GitHub Copilot: "Path-specific instructions are included only when their
 *   `applyTo` value matches a file that Copilot CLI is working with."
 *   https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
 * - Kiro: a `fileMatch` rule is "included only when working with files that
 *   match the specified pattern", and V1/V2 "do not provide V3's complete
 *   matching and activation behavior". https://kiro.dev/docs/steering.md
 * - Antigravity: `trigger: glob` "Automatically activates when the agent
 *   interacts with files matching any comma-separated pattern in `globs`".
 *   https://antigravity.google/docs/rules
 *
 * The base directory most of these are relative to is not documented (see the
 * scope reports for the per-vendor detail); the one convention that states it
 * is Claude Code - "Project rules: the directory that contains the rule's
 * `.claude` folder" - which is the project root this plugin already scans, so
 * project rules are matched against the project root and user rules against
 * the directory their own file lives in.
 *
 * The touch signal comes from the host's own tool pipeline. `tools/result` is
 * the documented seam for observing outcomes without transforming them:
 *
 *   "observe immutable authoritative outcomes with `tools/result`; use
 *    `tools/post-execute` instead only when the plugin needs to transform
 *    results or add context"
 *   - docs/cookbook/extension-cookbook.md
 *
 * The argument shapes below are the host tool catalog's (docs/tool-catalog.md):
 * `read`, `read_image`, `write` and `edit` carry `file_path`;
 * `str_replace_editor` carries `path`; `apply_patch` carries a patch document
 * whose `*** Add File:` / `*** Update File:` / `*** Move to:` /
 * `*** Delete File:` lines name the files it touches. A failed call touched
 * nothing, so only successes are recorded.
 */
import { dirname, isAbsolute, resolve } from 'node:path'
import { compilePatterns, matchesAny, selfCheck } from './globs.ts'
import type { Diagnostic, Rule } from './types.ts'

/**
 * How many distinct files one session's touch log keeps.
 *
 * The log only ever grows within a session, and every entry is compared
 * against every compiled rule, so it is bounded. Two thousand files is far
 * more than a working session reads, and dropping the oldest entries cannot
 * un-attach a rule that already matched - attachment is sticky - so the bound
 * only limits how late in a very long session a new rule can still attach.
 */
export const MAX_TOUCHED_PATHS = 2000

/**
 * How many rules one resolution compiles patterns for.
 *
 * Compilation happens once per touched-file change, not per rule per request,
 * but a pathological corpus could still carry thousands of scoped rules. Past
 * the cap the remaining rules stay on demand and a diagnostic says so.
 */
export const MAX_COMPILED_RULES = 256

/**
 * Tool argument field that names the file a call worked with.
 *
 * `apply_patch` is absent on purpose: its files live inside the patch document
 * and are parsed by {@link patchFiles}.
 */
const FILE_FIELDS: Readonly<Record<string, string>> = {
  read: 'file_path',
  read_image: 'file_path',
  write: 'file_path',
  edit: 'file_path',
  str_replace_editor: 'path',
}

/**
 * `*** Add File: p` and friends; `*** Move to: p` names the destination.
 *
 * `*** Delete File:` is included: a deletion is the strongest possible touch of
 * that path, and a rule scoped to it should attach for the same reason a read
 * does. The upstream patch grammar is documented in docs/tool-catalog.md under
 * `apply_patch` (`@deepseek-ai/dsh-tool-fs`, packages/fs/tool-fs/src/index.ts).
 */
const PATCH_LINE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

/**
 * Absolute paths one finished tool call worked with, or none.
 *
 * Unknown tools and malformed arguments return an empty list rather than
 * throwing: this runs inside a `tools/result` listener, which observes every
 * call the session makes, including calls to tools that have nothing to do
 * with files.
 */
export function touchedFilesOf(toolName: unknown, args: unknown): readonly string[] {
  if (typeof toolName !== 'string' || args === null || typeof args !== 'object') return []
  const record = args as Record<string, unknown>
  if (toolName === 'apply_patch') return patchFiles(record['input'])
  const field = FILE_FIELDS[toolName]
  if (field === undefined) return []
  const value = record[field]
  return typeof value === 'string' && value.trim() !== '' ? [value.trim()] : []
}

function patchFiles(input: unknown): readonly string[] {
  if (typeof input !== 'string' || input === '') return []
  const files: string[] = []
  for (const match of input.matchAll(PATCH_LINE)) {
    const file = match[1]?.trim()
    if (file !== undefined && file !== '') files.push(file)
  }
  return files
}

/** A bounded, insertion-ordered set of touched files. */
export interface Touches {
  /** Record the files one finished tool call worked with. */
  record(files: readonly string[]): void
  /** Absolute paths touched so far, oldest first. */
  list(): readonly string[]
}

export function createTouches(max = MAX_TOUCHED_PATHS): Touches {
  const seen = new Set<string>()
  const order: string[] = []
  return {
    record(files) {
      for (const file of files) {
        if (seen.has(file)) continue
        seen.add(file)
        order.push(file)
        while (order.length > max) {
          const dropped = order.shift()
          if (dropped !== undefined) seen.delete(dropped)
        }
      }
    },
    list() {
      return order
    },
  }
}

export interface AttachInput {
  readonly rules: readonly Rule[]
  /** Raw touched paths; relative ones resolve against `cwd`. */
  readonly touched: readonly string[]
  readonly cwd: string
  readonly projectRoot: string | null
}

export interface AttachResult {
  /** Rule paths, as scanned, whose patterns match a touched file. */
  readonly attached: ReadonlySet<string>
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * Which rules a set of touched files makes resident.
 *
 * Only enabled, on-demand rules with at least one pattern are candidates: an
 * always-on rule is already resident, a manual rule is never auto-attached by
 * any documented convention, and a rule with no pattern cannot match.
 */
export function attachedRules(input: AttachInput): AttachResult {
  const attached = new Set<string>()
  const diagnostics: Diagnostic[] = []
  if (input.touched.length === 0) return { attached, diagnostics }
  const touched = input.touched.map((file) => isAbsolute(file) ? file : resolve(input.cwd, file))
  let compiled = 0
  for (const rule of input.rules) {
    if (!rule.enabled || rule.type !== 'requested' || rule.patterns.length === 0) continue
    if (compiled >= MAX_COMPILED_RULES) {
      diagnostics.push({ code: 'attach.limit', detail: `一次最多编译 ${MAX_COMPILED_RULES} 条按需规则的匹配式，其余规则保持按需加载`, path: rule.path })
      break
    }
    compiled++
    const base = rule.scope === 'user' ? dirname(rule.path) : (input.projectRoot ?? input.cwd)
    const { matchers, warnings } = compilePatterns(rule.patterns)
    for (const warning of warnings) {
      diagnostics.push({ code: 'attach.pattern', detail: warning, path: rule.path })
    }
    if (matchers.length === 0) continue
    if (!selfCheck(matchers)) {
      diagnostics.push({ code: 'attach.slow', detail: '匹配式超出耗时预算，该规则保持按需加载', path: rule.path })
      continue
    }
    if (touched.some((file) => matchesAny(matchers, file, base))) attached.add(rule.path)
  }
  return { attached, diagnostics }
}
