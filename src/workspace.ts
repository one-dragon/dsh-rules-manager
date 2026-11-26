/**
 * Resolve a workspace to scan when no agent has run yet.
 *
 * The panel used to read a module-level `lastScan` that only `loadFor` ever
 * wrote, and `loadFor` runs from `agent/pre-step`. A freshly booted host has
 * not run a step, so the panel showed zero rules until the user happened to
 * send a message — reported as "all tabs are 0" right after a restart.
 *
 * The fix is to resolve a directory on demand. Every service here is **optional**
 * and read through `ctx.get`; none may join `inject`, because cordis has no
 * optional-dependency form and a hard dependency would unmount the whole plugin
 * wherever the service is absent.
 *
 * Shapes are taken from the host's own sources, not guessed:
 * - `@deepseek-ai/dsh-workspace/src/index.ts` — `class WorkspaceRegistry`
 *   provides `list(): Workspace[]`; `entity.ts` gives `Workspace.path`.
 * - `SessionHeader` (`dsh-session`) carries `readonly cwd?: string`, and the
 *   sessions service exposes `get(id)` / `list()`.
 */

/** The shape this module needs from a workspace entry. */
export interface WorkspaceLike {
  readonly path?: unknown
  readonly cwd?: unknown
}

/** The shape this module needs from the sessions service. */
export interface SessionsLike {
  get?(id: string): unknown
  list?(): unknown
}

/** The shape this module needs from the workspace registry. */
export interface RegistryLike {
  list?(): unknown
}

/** Where a resolved directory came from, for the empty-state message. */
export type WorkspaceSource = 'last-scan' | 'workspace-registry' | 'sessions' | 'none'

export interface ResolvedWorkspace {
  readonly path: string | null
  readonly source: WorkspaceSource
  /** Every candidate seen, in the order they were considered. */
  readonly candidates: readonly string[]
}

/** Keep only non-empty strings, preserving order and dropping duplicates. */
function clean(values: readonly unknown[]): string[] {
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '' || out.includes(trimmed)) continue
    out.push(trimmed)
  }
  return out
}

/** Paths from `workspaceRegistry.list()`. Never throws. */
export function workspacePaths(registry: RegistryLike | undefined): string[] {
  if (registry === undefined || registry === null || typeof registry.list !== 'function') return []
  try {
    const listed = registry.list()
    if (!Array.isArray(listed)) return []
    return clean(listed.map((item) => {
      const workspace = item as WorkspaceLike | null
      // `path` is the real accessor (WorkspaceEntity); `cwd` is the older
      // spelling other releases used, kept so both shapes work.
      return workspace?.path ?? workspace?.cwd
    }))
  } catch {
    // A registry that throws must not take the panel down with it.
    return []
  }
}

/** cwds from the sessions service: a known session, else every listed one. */
export function sessionCwds(sessions: SessionsLike | undefined, sessionId?: string): string[] {
  if (sessions === undefined || sessions === null) return []
  const headerCwd = (value: unknown): unknown => (value as { header?: { cwd?: unknown } } | null)?.header?.cwd
  const byId = (value: unknown): unknown =>
    (value as { cwd?: unknown } | null)?.cwd ?? headerCwd(value)
  try {
    if (typeof sessionId === 'string' && sessionId.trim() !== '' && typeof sessions.get === 'function') {
      const direct = clean([byId(sessions.get(sessionId))])
      if (direct.length > 0) return direct
    }
    if (typeof sessions.list !== 'function') return []
    const listed = sessions.list()
    if (!Array.isArray(listed)) return []
    // Newest-looking entries are not knowable here, so the service's own order
    // is kept; the caller only needs *a* workspace, not a ranking.
    return clean(listed.map(byId))
  } catch {
    return []
  }
}

/** The optional services this module reads, already probed by the caller. */
export interface WorkspaceProbes {
  /** The directory of the most recent scan, when one happened. */
  readonly lastScanRoot?: string | null
  readonly registry?: RegistryLike | undefined
  readonly sessions?: SessionsLike | undefined
  readonly sessionId?: string | undefined
}

/**
 * Pick the directory to scan.
 *
 * Order, and why:
 * 1. **The last scan's project root** — it is the workspace a real session is
 *    actually working in, so it beats any guess and needs no I/O.
 * 2. **`workspaceRegistry`** — the durable list of directories the user has
 *    ever opened, in registry order. The first entry is the most recently
 *    created one (the registry prepends new workspaces), which is the closest
 *    thing to "where the user is now".
 * 3. **`sessions`** — the cwd recorded on a session header, used when no
 *    workspace is registered (a fresh profile with one open session).
 *
 * Multiple workspaces yield the **first** candidate rather than nothing: being
 * unable to choose is not a reason to show an empty panel, and the resolver
 * always returns what it saw so the UI can be honest about which directory it
 * picked.
 */
export function resolveWorkspace(probes: WorkspaceProbes): ResolvedWorkspace {
  const fromRegistry = workspacePaths(probes.registry)
  const fromSessions = sessionCwds(probes.sessions, probes.sessionId)

  const candidates = clean([
    probes.lastScanRoot,
    ...fromRegistry,
    ...fromSessions,
  ])

  const pick = (values: readonly string[]): string | null => values[0] ?? null

  if (typeof probes.lastScanRoot === 'string' && probes.lastScanRoot.trim() !== '') {
    return { path: probes.lastScanRoot.trim(), source: 'last-scan', candidates }
  }
  const registryPick = pick(fromRegistry)
  if (registryPick !== null) return { path: registryPick, source: 'workspace-registry', candidates }
  const sessionPick = pick(fromSessions)
  if (sessionPick !== null) return { path: sessionPick, source: 'sessions', candidates }
  return { path: null, source: 'none', candidates }
}
