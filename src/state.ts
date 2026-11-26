/**
 * Panel settings persistence.
 *
 * Lives beside the profile's plugin data rather than inside it, so the file
 * survives plugin upgrades. Shape follows the reference skills-manager's
 * state.json: a flat object of sources/skills toggles plus display options.
 */
import type { Stats } from 'node:fs'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export interface ManagerState {
  readonly version: 1
  /** Per-source enable switches, keyed by `RuleSource.key`. */
  readonly sources: Record<string, boolean>
  /** Individually disabled rules, keyed by source then file path. */
  readonly disabled: Record<string, string[]>
  /** Where the entry appears: settings only, sidebar only, or both. */
  readonly entryLocation: 'settings' | 'sidebar' | 'both'
  /** Budget overrides; absent means use the built-in default. */
  readonly budgets: Record<string, number>
}

/**
 * Deployment-time override set by the plugin entry from `config.stateDir`.
 *
 * Precedence, highest first: this override (set only when a deployment
 * **explicitly** pins `config.stateDir`), `DSH_RULES_MANAGER_HOME`, then
 * `<home>/.dsh/rules-manager`. The environment variable therefore works in a
 * real deployment, and a test or a one-off run can redirect state without a
 * config block.
 */
let configuredDir: string | null = null

export function setStateDir(dir: string): void {
  configuredDir = dir === '' ? null : dir
}

function stateDir(): string {
  return configuredDir ?? process.env['DSH_RULES_MANAGER_HOME'] ?? join(homedir(), '.dsh', 'rules-manager')
}

export function statePath(): string {
  return join(stateDir(), 'state.json')
}

export function defaultState(): ManagerState {
  return { version: 1, sources: {}, disabled: {}, entryLocation: 'both', budgets: {} }
}

/**
 * Hard ceiling on the size of one state.json.
 *
 * A state file is switches and budgets — a few kilobytes at the very most — so
 * a megabyte is already two orders of magnitude past anything a settings file
 * needs. Anything larger is not a settings file, and must not be parsed: a
 * stray or hostile file could otherwise make the panel allocate a huge string
 * and run JSON.parse over it on every read.
 */
export const STATE_MAX_BYTES = 1_048_576

/** Read state, falling back to defaults on any error rather than throwing. */
export async function readState(): Promise<ManagerState> {
  try {
    const raw = await fs.readFile(statePath(), 'utf8')
    // Size first: an oversized file is refused before it is parsed at all.
    if (Buffer.byteLength(raw, 'utf8') > STATE_MAX_BYTES) return defaultState()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultState()
    const candidate = parsed as Partial<ManagerState>
    return {
      version: 1,
      sources: candidate.sources ?? {},
      disabled: candidate.disabled ?? {},
      entryLocation: candidate.entryLocation ?? 'both',
      budgets: candidate.budgets ?? {},
    }
  } catch {
    return defaultState()
  }
}

/**
 * Refuse to write through a symbolic link.
 *
 * `rename` would happily replace the link itself, silently discarding the
 * indirection the user set up (and pointing the next write somewhere else).
 * The check runs before the temp file exists, so a refusal leaves the
 * directory — and any existing state.json — byte for byte as it was.
 */
async function assertNotSymlink(target: string): Promise<void> {
  let info: Stats
  try {
    info = await fs.lstat(target)
  } catch (error) {
    // Nothing at the target yet is the normal first-write case. Every other
    // lstat failure (a parent that is not a directory, a permission problem) is
    // a real write failure and is re-thrown rather than swallowed here.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (info.isSymbolicLink()) {
    throw new Error(`refusing to write ${basename(target)}: the target is a symbolic link`)
  }
}

/** Write state atomically enough for a settings file: temp then rename. */
export async function writeState(state: ManagerState): Promise<void> {
  const target = statePath()
  await assertNotSymlink(target)
  await fs.mkdir(dirname(target), { recursive: true })
  const temp = `${target}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await fs.rename(temp, target)
}

/** The tier a switch belongs to, when the caller knows one. */
export type Scope = 'user' | 'project'

/**
 * The key one source's switches are stored under.
 *
 * With a scope, `<scope>:<key>` — the same id the panel's `sourceId` builds, so
 * both halves address a tier identically. Without one, the bare key: what every
 * state file written before scoping holds, and what a client that sends no
 * scope still addresses.
 */
export function scopedKey(key: string, scope?: Scope): string {
  return scope === undefined ? key : `${scope}:${key}`
}

/**
 * Whether a source is enabled; absent means enabled.
 *
 * A scoped entry wins when present, so one tier's switch is its own; otherwise
 * the legacy bare entry still decides, so an existing state.json keeps working.
 */
export function isSourceEnabled(state: ManagerState, key: string, scope?: Scope): boolean {
  if (scope !== undefined) {
    const scoped = state.sources[scopedKey(key, scope)]
    if (scoped !== undefined) return scoped
  }
  return state.sources[key] !== false
}

/** Whether an individual rule is disabled, with the same scoped-then-bare priority. */
export function isRuleDisabled(state: ManagerState, key: string, path: string, scope?: Scope): boolean {
  if (scope !== undefined) {
    const scoped = state.disabled[scopedKey(key, scope)]
    if (scoped !== undefined) return scoped.includes(path)
  }
  return (state.disabled[key] ?? []).includes(path)
}

/**
 * The disabled-path list a write must start from.
 *
 * The effective list, not an empty one: a scoped write replaces the whole list
 * under its key, so starting from nothing would re-enable every other rule the
 * bare entry (or this tier) had switched off.
 */
export function disabledPaths(state: ManagerState, key: string, scope?: Scope): readonly string[] {
  if (scope !== undefined) {
    const scoped = state.disabled[scopedKey(key, scope)]
    if (scoped !== undefined) return scoped
  }
  return state.disabled[key] ?? []
}
