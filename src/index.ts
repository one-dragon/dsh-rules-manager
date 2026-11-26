/**
 * Plugin entry: scans rule files, injects the `<rules>` block, and registers
 * the `read_rules` tool.
 *
 * The block is injected as a durable user message from an `agent/pre-step`
 * listener, the same seam the host's own agent-instructions plugin uses. The
 * requestable index is rebuilt on each scan and read lazily by the tool.
 *
 * The same catalog is published over HTTP for the browser panel, which cannot
 * reach host memory directly.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { renderRulesBlock } from './render.ts'
import { planInjection } from './inject.ts'
import { findProjectRoot, scanAll, type ScanResult } from './scan.ts'
import { createReadRulesTool, type RequestableIndex } from './tool-read-rules.ts'
import { disabledPaths, isRuleDisabled, isSourceEnabled, readState, scopedKey, setStateDir, writeState } from './state.ts'
import type { ManagerState } from './state.ts'
import { SOURCES } from './scan.ts'
import { resolveWorkspace, type SessionsLike, type WorkspaceSource } from './workspace.ts'
import { attachedRules, createTouches, touchedFilesOf, type AttachResult, type Touches } from './attach.ts'
import { attachedNow, NO_ATTACHED } from './rule-layout.ts'
import type { Diagnostic, Rule } from './types.ts'
import './types.ts'   // side effect: declares the 'rules-context' message source
import type { Config } from './config.ts'
import { RULES_ROUTE, toPanelDiagnostics, type DiagnosticKind, type RuleDiagnosticRow, type RuleRow, type RuleSourceRow, type RulesAction, type RulesPayload } from './panel.ts'

/** Cordis entry id; matches `cordis.patch.yml` and stays short by convention. */
export const name = 'rules-manager'
export const inject = ['tools', 'workingDirectory']

/** A source the payload may report: `selected` is the panel's own choice. */
type PanelSource = WorkspaceSource | 'selected'

/**
 * Which list a diagnostic row is going into.
 *
 * The host states this per call site rather than letting the panel infer it:
 * the same code can be raised about a rule file or about the walk, and only the
 * caller knows which list it is building.
 */
const RULE_KIND: DiagnosticKind = 'rule'
const SCAN_KIND: DiagnosticKind = 'scan'

/** One agent's scanned catalog, its requestable subset, and the root it came from. */
interface ScanEntry {
  readonly rules: readonly Rule[]
  /** Everything scanned, before the state switches filtered it. */
  readonly allRules: readonly Rule[]
  readonly index: RequestableIndex
  readonly projectRoot: string | null
  /**
   * The session directory this scan was rooted from.
   *
   * A tool argument like `src/a.ts` is relative to it, so file-attachment
   * matching has to resolve against the same directory the tools did (see
   * `attach.ts`). Carried on the entry because the panel renders attachments
   * without any agent of its own to ask.
   */
  readonly cwd: string
  /** Every root that actually existed, with its real absolute path. */
  readonly roots: readonly { key: string; scope: 'user' | 'project'; path: string }[]
  /**
   * Problems the walk itself hit: an unreadable directory, a cap reached
   * part-way, a file that could not be read.
   *
   * Carried on the entry rather than recomputed, because this is the only place
   * that has them: the scan returns them and nothing downstream could derive
   * them from the rules. Without them the panel cannot tell a complete walk
   * from a truncated one.
   */
  readonly diagnostics: readonly Diagnostic[]
  /** Whether a directory or entry cap cut the walk short. */
  readonly truncated: boolean
  readonly at: number
}

/** Minimum interval between rescans. */
const RESCAN_INTERVAL_MS = 5000

/** How long an on-demand scan is reused before the next panel open rescans. */
const ON_DEMAND_TTL_MS = 30000

/** Human-readable name for a source key, for a group heading. */
function sourceLabelOf(key: string): string {
  return SOURCES.find((source) => source.key === key)?.label ?? key
}

/** A JSON response with the no-store headers the panel relies on. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** The query parameter the panel uses to name the workspace it is showing. */
const WORKSPACE_QUERY = 'workspace'

/** The query parameter that asks a read to ignore the scan caches. */
const REFRESH_QUERY = 'refresh'

/**
 * Whether this request asked to be answered by a fresh scan.
 *
 * A repeated read is normally served from a 30-second slot, which is right for
 * an open panel but wrong for the Refresh button: it returned the same bytes and
 * the "scanned at" stamp never moved. Only an explicit 1 counts, so a stale or
 * hand-edited parameter cannot turn every read into a rescan.
 */
function parseRefresh(url: string | undefined): boolean {
  if (url === undefined) return false
  try {
    return new URL(url, 'http://localhost/').searchParams.get(REFRESH_QUERY) === '1'
  } catch {
    return false
  }
}

/**
 * The absolute directory a request asked for, when it named one.
 *
 * Everything the panel cannot mean reads as "no request": a relative path, a
 * bare name, an empty value. The caller then keeps the default workspace instead
 * of scanning a directory the resolver never offered, so a malformed parameter
 * costs one resolve and can never widen the search.
 *
 * Trailing separators are dropped, because `D:/proj` and `D:/proj/` are the same
 * directory and a client may round-trip either spelling.
 */
function parseWorkspaceQuery(url: string | undefined): string | null {
  if (url === undefined) return null
  let value: string | null
  try {
    value = new URL(url, 'http://localhost/').searchParams.get(WORKSPACE_QUERY)
  } catch {
    return null
  }
  if (value === null) return null
  const trimmed = value.trim()
  // Windows accepts both separators and a UNC prefix; a POSIX host only sees `/`.
  const absolute = /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\\\')
  if (!absolute) return null
  const normalized = trimmed.replace(/[\\/]+$/, '')
  return normalized === '' ? trimmed : normalized
}

/**
 * The tier one request addresses, when it names a valid one.
 *
 * Absent or malformed stays `undefined`, which means "no tier named": the write
 * then lands on the legacy bare key rather than guessing a tier.
 */
function parseScope(value: unknown): 'user' | 'project' | undefined {
  return value === 'user' || value === 'project' ? value : undefined
}

/**
 * Validate one write request from the browser.
 *
 * The payload crosses a process boundary, so it is checked rather than trusted:
 * a malformed body must be rejected, never written to state.
 */
function parseAction(value: unknown): RulesAction | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate['enabled'] !== 'boolean') return null
  if (typeof candidate['key'] !== 'string' || candidate['key'] === '') return null
  if (candidate['action'] === 'setSource') {
    return {
      action: 'setSource', key: candidate['key'], enabled: candidate['enabled'],
      scope: parseScope(candidate['scope']),
    }
  }
  if (candidate['action'] === 'setRule') {
    if (typeof candidate['path'] !== 'string' || candidate['path'] === '') return null
    return {
      action: 'setRule', key: candidate['key'], path: candidate['path'], enabled: candidate['enabled'],
      scope: parseScope(candidate['scope']),
    }
  }
  return null
}

/**
 * Project one rule into the row shape the browser panel renders.
 *
 * Every scanned rule becomes a row, including the ones that are switched off:
 * the panel needs to *show* a disabled rule so the user can switch it back on,
 * and a row that simply disappeared could never be re-enabled. Which layer
 * switched it off is reported separately, so the UI can tell a rule disabled in
 * its own frontmatter from one this panel turned off.
 */
function toRow(
  rule: Rule,
  state: ManagerState,
  sourceOn: boolean,
  attached: ReadonlySet<string>,
): RuleRow {
  const byState = isRuleDisabled(state, rule.sourceKey, rule.path, rule.scope)
  const disabledBy: RuleRow['disabledBy'] = !sourceOn
    ? 'source'
    : byState
      ? 'state'
      : rule.enabled ? null : 'frontmatter'
  return {
    path: rule.path,
    name: rule.name,
    type: rule.type,
    description: rule.description,
    descriptionTokens: rule.descriptionTokens,
    bodyTokens: rule.bodyTokens,
    // Characters, not tokens: the injection budget is spent in characters
    // (8000 per rule, 6000/12000 per tier), and the panel cannot recover that
    // from a token estimate. The body never leaves this process.
    bodyLength: rule.body.length,
    // A property of the file, not of whether it is in effect.
    enabled: rule.enabled,
    active: disabledBy === null,
    disabledBy,
    sourceKey: rule.sourceKey,
    sourceLabel: sourceLabelOf(rule.sourceKey),
    // Carried from the scan root, so this never disagrees with what was scanned.
    scope: rule.scope,
    family: rule.family,
    patterns: rule.patterns,
    // A view of the current request, not a property of the file: the rule is
    // still written as on-demand, and stays on-demand in a session that never
    // touches a file its patterns match.
    attached: attachedNow(rule.type, attached, rule.path),
    // "line" travels only when the scanner had one: a diagnostic about a
    // directory has no line, and inventing one would point at a wrong place.
    // "kind" separates these from the scan's own rows, which are published
    // beside the rules rather than inside them.
    diagnostics: rule.diagnostics.map((d) => (d.line === undefined
      ? { code: d.code, detail: d.detail, kind: RULE_KIND }
      : { code: d.code, detail: d.detail, line: d.line, kind: RULE_KIND })),
  }
}

/** Whether one rule is in effect under the given state. */
function isActive(rule: Rule, state: ManagerState): boolean {
  return isSourceEnabled(state, rule.sourceKey, rule.scope)
    && !isRuleDisabled(state, rule.sourceKey, rule.path, rule.scope)
    && rule.enabled
}

/**
 * One row per scanned root, with the directory it resolved to.
 *
 * Counts come from the unfiltered scan: a root that is switched off still has
 * its rules on disk, and the panel needs to say how many it is hiding.
 */
function toSourceRows(entry: ScanEntry, state: ManagerState): RuleSourceRow[] {
  return entry.roots.map((root) => {
    // Scoped: the same key exists in both tiers, and this row describes one.
    const own = entry.allRules.filter((rule) => rule.sourceKey === root.key && rule.scope === root.scope)
    return {
      key: root.key,
      label: sourceLabelOf(root.key),
      scope: root.scope,
      path: root.path,
      enabled: isSourceEnabled(state, root.key, root.scope),
      // Both numbers, so the UI can say "2 rules, 1 in effect" rather than
      // being unable to distinguish "2 hidden" from "2 active".
      ruleCount: own.length,
      activeRuleCount: own.filter((rule) => isActive(rule, state)).length,
    }
  })
}

/**
 * Tail of the write queue, module-level so every concurrent POST is serialized
 * even across plugin instances in one process.
 *
 * A POST is a read-modify-write of one JSON file: two overlapping requests both
 * read the same snapshot, and the later rename silently drops the earlier
 * toggle. Chaining the apply steps makes each write see the previous one.
 */
let writeChain: Promise<unknown> = Promise.resolve()

export function apply(ctx: Context, config: Config): void {
  // A deployment-time override wins over the environment variable and the
  // default home. Applied before any state read.
  if (typeof config.stateDir === 'string' && config.stateDir !== '') setStateDir(config.stateDir)

  /**
   * Per-agent scan cache: rescanning on every step would stat the tree each turn.
   *
   * Scoped to this `apply` call rather than the module: a module-level cache is
   * shared by every plugin instance in the process, so one instance's scan (or
   * one test's fixture) would serve another's panel.
   */
  const scans = new WeakMap<object, ScanEntry>()

  /**
   * The files each agent has worked with, for file-scoped rule attachment.
   *
   * A second per-agent table rather than a field on `ScanEntry`, because the
   * two have different lifetimes: a rescan replaces the entry within seconds,
   * while a touch is a fact about the session that stays true for its whole
   * life. The host's own agent-instructions plugin is the same shape — it keeps
   * the applicable chain and refreshes it from successful filesystem calls.
   *
   * `attach.ts` owns what counts as a touch and what it makes resident.
   */
  const touches = new WeakMap<object, Touches>()

  /**
   * The most recent agent's touch list, for readers that have no agent.
   *
   * A panel request arrives over HTTP and carries no agent, so it cannot look
   * one up in the table above. The last session to touch a file is the best
   * available answer to "has this workspace been worked in", and it is only
   * ever used to describe rules the panel already lists.
   */
  let recentTouches: readonly string[] = []

  /**
   * The panel's last attachment answer, reused while its input is unchanged.
   *
   * A panel request carries no agent, so it answers with `recentTouches` — and
   * a browser polls this route, so re-running the pattern matchers on every poll
   * buys nothing. Identity is a sound key because both writers replace the list
   * rather than mutate it, and the directory is compared as well.
   */
  let lastPanelTouches: readonly string[] | null = null
  let lastPanelCwd: string | null = null
  let lastPanelAttachments: AttachResult = { attached: NO_ATTACHED, diagnostics: [] }

  /**
   * The session working directory the host last reported for one agent.
   *
   * A touch is a fact about a directory, not only about an agent: a relative
   * tool argument means nothing outside the tree it was resolved in. The host's
   * own agent-instructions plugin reloads its chain when the session moves, and
   * a list carried across that move would keep rules resident for a workspace
   * the session has left.
   *
   * The observer only sees tool calls, so a session that moved and has not
   * called a tool yet would still be matched against the directory it left.
   * `loadFor` asks the host for this directory on every request, which is the
   * documented source of it, so that is where the move is normally noticed.
   */
  const sessionDir = new WeakMap<object, string>()

  /**
   * Drop a touch list that belongs to a directory the session has left.
   *
   * A list no request has claimed yet belongs to no directory, so it is adopted
   * rather than dropped. Called from both places that learn the directory: the
   * per-request path and the tool observer.
   */
  const resetTouchesIfMoved = (agent: object, cwd: string): void => {
    if (sessionDir.has(agent) && sessionDir.get(agent) !== cwd) {
      touches.delete(agent)
      recentTouches = []
    }
    sessionDir.set(agent, cwd)
  }

  /** The touch list of one agent, created on first use. */
  const touchesOf = (agent: object): Touches => {
    const existing = touches.get(agent)
    if (existing !== undefined) return existing
    const created = createTouches()
    touches.set(agent, created)
    return created
  }

  /**
   * What the given rules and touches make resident, or nothing when unknown.
   *
   * `attach.ts` owns the decision; this only supplies the agent's touch list and
   * the two directories a relative tool argument could have been relative to.
   */
  const attachmentOf = (
    rules: readonly Rule[],
    touched: readonly string[],
    cwd: string,
    projectRoot: string | null,
  ): AttachResult => {
    if (touched.length === 0) return { attached: NO_ATTACHED, diagnostics: [] }
    return attachedRules({ rules, touched, cwd, projectRoot })
  }

  /**
   * Agents that have been scanned, so a write can invalidate their caches.
   *
   * A WeakMap cannot be cleared, and a stale entry would survive a settings
   * change; this holds the same objects strongly until they are dropped, which
   * is bounded by the number of live agents.
   */
  const knownAgents = new Set<object>()

  /**
   * The most recent catalog, for readers that have no agent of their own.
   *
   * A browser request carries no agent, so the panel cannot be served from the
   * per-agent cache above. It is trusted only while it is younger than
   * `ON_DEMAND_TTL_MS`; see `currentEntry`.
   */
  let lastScan: ScanEntry | null = null

  /**
   * A scan performed on the panel's behalf, before any agent has run.
   *
   * Without this, a freshly booted host served an empty panel: the catalog above
   * is only written by `loadFor`, which runs from `agent/pre-step`, and the user
   * opens the panel before sending anything. Cached so repeated panel opens do
   * not re-walk the tree, and invalidated by every write.
   */
  let onDemandScan: {
    readonly root: string | null
    readonly entry: ScanEntry | null
    readonly source: PanelSource
    /** The candidates the resolve that filled this slot saw, for the panel. */
    readonly candidates: readonly string[]
    /**
     * The request that filled this slot, or null when the default resolve did.
     * A plain read reuses only a slot the default filled; a requested read only
     * reuses its own, so A → B → A never answers with the wrong scan.
     */
    readonly explicit: string | null
    readonly at: number
  } | null = null

  /**
   * The workspace the current request asked for, if it named one.
   *
   * A GET sets it before reading; a POST reads its own from the body's request,
   * so a panel showing B keeps getting B when it writes a switch.
   */
  let requestedWorkspace: string | null = null

  /**
   * Candidate list from the most recent resolve.
   *
   * Both scan caches are dropped on every write, but a write does not change
   * which directories this host can describe — a panel that just toggled a rule
   * must keep offering the same switch, so the list outlives them. It is still
   * bounded by the same TTL, because the services behind it can change.
   */
  let lastCandidates: { readonly candidates: readonly string[]; readonly at: number } | null = null

  /**
   * The directories to offer the panel, given the scan the fast paths landed on.
   *
   * When the list remembered from the last resolve still contains `root` it is
   * the honest answer; otherwise the only directory known to be described is the
   * one already scanned, and claiming more would offer a switch to somewhere this
   * host never named.
   */
  const candidatesFor = (root: string | null): readonly string[] => {
    const remembered = lastCandidates
    if (remembered !== null && root !== null && Date.now() - remembered.at < ON_DEMAND_TTL_MS
      && remembered.candidates.includes(root)) {
      return remembered.candidates
    }
    return root === null ? [] : [root]
  }

  /**
   * The probes `resolveWorkspace` reads, without scanning any directory.
   *
   * Both services are optional and read with `ctx.get`; neither may join
   * `inject`, which would unmount the plugin wherever they are absent. The
   * candidate check stays next to the resolve it validates.
   *
   * `lastScanRoot` is the tree a session was last scanned in, which is the
   * first probe the resolver consults. `sessionId` stays unset: no host
   * contract names a session id for this context, and guessing one would let a
   * stale read pick a workspace the host never offered.
   */
  const workspaceProbes = (lastScanRoot: string | null) => ({
    lastScanRoot,
    registry: ctx.get?.('workspaceRegistry') as { list?(): unknown } | undefined,
    sessions: ctx.get?.('sessions') as SessionsLike | undefined,
    sessionId: undefined,
  })

  /**
   * Assemble one entry from a finished walk.
   *
   * Shared by the session path and the panel's on-demand path: both filter the
   * same way, project the same roots, and build the same requestable index, and
   * two copies of that had already drifted apart in nothing but variable names.
   * `cwd` and `projectRoot` are the two things the callers disagree about, so
   * they are parameters.
   */
  const buildEntry = (
    result: ScanResult,
    state: ManagerState,
    projectRoot: string | null,
    cwd: string,
  ): ScanEntry => {
    // The injected catalog stays filtered to rules that are in effect: the
    // panel's need to *list* a disabled rule must never add it to the prompt.
    const rules = result.rules.filter((rule) =>
      isSourceEnabled(state, rule.sourceKey, rule.scope)
        && !isRuleDisabled(state, rule.sourceKey, rule.path, rule.scope),
    )
    const roots = result.roots.map((root) => ({
      key: root.source.key,
      scope: root.scope,
      path: root.path,
    }))

    const index: Record<string, { path: string; name: string; body: string }> = {}
    for (const rule of rules) {
      // Only requestable rules are fetchable: always-on bodies are already in
      // context, and manual rules have no description to route on.
      if (rule.type !== 'requested') continue
      index[rule.path] = { path: rule.path, name: rule.name, body: rule.body }
    }
    return {
      rules,
      allRules: result.rules,
      index,
      projectRoot,
      roots,
      cwd,
      // Straight from the walk: a rule list alone cannot say that a directory
      // was skipped or that a cap stopped the scan early.
      diagnostics: result.diagnostics,
      truncated: result.truncated,
      at: Date.now(),
    }
  }

  /**
   * Scan (or reuse a recent scan) for one agent, honoring the state switches.
   *
   * The root is resolved from the agent's **session** working directory, never
   * from `process.cwd()`: that is the directory of the DSH host process, so
   * climbing from it finds no project marker and the project tier silently
   * scans zero files. The host's own `dsh-agent-instructions` resolves its root
   * the same way, through `ctx.workingDirectory.ensure(agent, signal)`.
   */
  const loadFor = async (agent: Agent, signal?: AbortSignal): Promise<ScanEntry> => {
    // The directory is asked for before the cache is consulted: `cached.at` is
    // the age of the walk, not of the session. A session that moved to another
    // tree must be noticed even while its scan is still fresh, or the previous
    // tree's touch list keeps deciding what is resident.
    const cwd = await ctx.workingDirectory.ensure(agent, signal)
    resetTouchesIfMoved(agent, cwd)
    const cached = scans.get(agent)
    if (cached !== undefined && Date.now() - cached.at < RESCAN_INTERVAL_MS) return cached

    const projectRoot = await findProjectRoot(cwd)
    const state = await readState()
    const result = await scanAll(projectRoot, { maxDepth: config.maxScanDepth })
    const entry = buildEntry(result, state, projectRoot, cwd)
    scans.set(agent, entry)
    if (typeof agent === 'object' && agent !== null) knownAgents.add(agent)
    lastScan = entry
    return entry
  }

  // The route goes through `ctx.connection.fetch`, NOT `ctx.webServer`:
  // Connection's exact Fetch registry mounts under its own `/api` FetchHandler,
  // so the request passes the browser-trust fence (Host/Origin checks plus an
  // authenticated, live Peer) that a bare `webServer` route would bypass. The
  // registry also answers 403 to every non-owner principal, which is exactly
  // the audience this payload is for. The reference plugin reaches the same
  // place the same way (`ctx.connection.fetch.register`).
  // `ctx.inject` rather than a one-shot `ctx.get`: the callback runs once the
  // service is available and **again whenever it changes**, per the documented
  // contract ("每当某个必需服务发生变化时，系统都会卸载并重新运行该回调").
  //
  // A one-shot `ctx.get` at apply time silently registers nothing when
  // Connection mounts later in the boot order. Measured on a scratch host: with
  // the plugin loaded, the route answered Connection's own 404 (body
  // `not found`) because the registration had been skipped.
  //
  // Connection stays out of the entry's `inject` array on purpose: a hard
  // dependency there unmounts this whole plugin wherever no web carrier exists,
  // which would take the `read_rules` tool down with it.
  const registerOnConnection = (owner: Context): void => {
    // Cordis hands the callback a scoped context whose service names are
    // properties; `get` covers a context that exposes services only that way.
    const connection = owner.connection ?? (owner.get?.('connection') as typeof owner.connection)
    const fetch = connection?.fetch
    if (fetch === undefined || typeof fetch.register !== 'function') return
    // A duplicate path throws, and this is the only registrar for this route.
    owner.effect(() => fetch.register({
      // Already carries the `/api` prefix; the framework validates it there.
      path: RULES_ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      // The registry always passes a Request; the default keeps a bare
      // call in a test (or a future in-process reader) working as a GET.
      fetch: async (request: Request = new Request('http://localhost/')): Promise<Response> => {
        if (request.method === 'POST') return handleAction(request)
        requestedWorkspace = parseWorkspaceQuery(request.url)
        // Parsed from this request rather than remembered, so a later POST
        // cannot inherit a refresh the panel asked for in an earlier read.
        return jsonResponse(await snapshot(undefined, requestedWorkspace, parseRefresh(request.url)))
      },
    }))
  }

  /**
   * Scan one directory outside any agent's session.
   *
   * Used only when no agent has run; the result is cached so opening the panel
   * repeatedly does not re-walk the tree. The caller passes the state it has
   * already read, so one request reads state.json once rather than once per scan.
   */
  const scanOutsideAgent = async (root: string | null, state: ManagerState): Promise<ScanEntry | null> => {
    if (root === null) return null
    const projectRoot = await findProjectRoot(root)
    const result = await scanAll(projectRoot, { maxDepth: config.maxScanDepth })
    // The panel asked for this directory and has no session of its own: a
    // relative tool argument would have been relative to it.
    return buildEntry(result, state, projectRoot, root)
  }

  /**
   * The cached on-demand scan that may answer this read, if any.
   *
   * The slot is shared by plain reads and explicit ones, so it remembers which
   * filled it: only a slot the default resolve filled answers a plain read, and
   * only a slot filled by the same request answers that request again. Anything
   * else misses, which keeps a no-parameter read on the default workspace and
   * stops selecting A after B from still showing B.
   */
  const cachedScanFor = (requested: string | null, now: number) => {
    const cached = onDemandScan
    if (cached === null || now - cached.at >= ON_DEMAND_TTL_MS) return null
    if (requested === null) return cached.explicit === null ? cached : null
    return cached.explicit === requested && cached.candidates.includes(requested) ? cached : null
  }

  /**
   * The entry to describe, resolving a workspace on demand when no agent has run.
   *
   * A recent `lastScan` wins: it is the workspace a real session is working
   * in, which is more trustworthy than any service lookup. It is only trusted
   * while it is fresh, though — the panel is one process-wide reader shared by
   * every window, so an unbounded entry would let a write made elsewhere go
   * unseen for the rest of the process's life. Past the TTL the workspace is
   * resolved from the optional services and scanned here, which also keeps the
   * panel working on a freshly booted host.
   *
   * `requested` is the directory the panel explicitly asked for, already checked
   * against the candidates a previous read reported. It narrows the choice to a
   * directory this host itself offered; it never widens it.
   *
   * A request for A must not be answered with B's scan, however fresh it is,
   * and the same directory makes `lastScan` exact rather than a guess. The
   * on-demand slot is shared by plain reads and explicit ones, so it also
   * remembers which of the two filled it: only a slot the default resolve
   * filled answers a plain read, and only a slot filled by the same request
   * answers that request again. Anything else falls through to a fresh resolve,
   * which keeps a no-parameter read on the default workspace.
   *
   * An explicit request is honored only for a directory the resolver itself
   * offered, and then it is the one scanned, not the default: a stale or
   * hand-edited parameter falls back to the default workspace instead of
   * scanning somewhere the host never named.
   */
  const currentEntry = async (state: ManagerState, requested: string | null, refresh = false): Promise<{
    entry: ScanEntry | null
    source: PanelSource
    root: string | null
    candidates: readonly string[]
  }> => {
    const recent = lastScan
    // A forced read skips both cache slots below; it is the only way a panel can
    // ask for the disk again inside the TTL.
    if (!refresh && recent !== null && (requested === null || recent.projectRoot === requested)
      && Date.now() - recent.at < ON_DEMAND_TTL_MS) {
      return {
        entry: recent,
        source: requested === null ? 'last-scan' : 'selected',
        root: recent.projectRoot,
        candidates: candidatesFor(recent.projectRoot),
      }
    }

    const now = Date.now()
    const cached = refresh ? null : cachedScanFor(requested, now)
    if (cached !== null) {
      return {
        entry: cached.entry,
        source: requested === null ? cached.source : 'selected',
        root: cached.root,
        candidates: cached.candidates,
      }
    }

    const resolved = resolveWorkspace(workspaceProbes(lastScan?.projectRoot ?? null))
    const chosen = requested !== null && resolved.candidates.includes(requested)
    const target = chosen && requested !== null ? requested : resolved.path
    const entry = await scanOutsideAgent(target, state)
    // A matched request is reported as chosen by the panel, not as the service
    // lookup that happened to produce the candidate list.
    const source: PanelSource = chosen ? 'selected' : resolved.source
    lastCandidates = { candidates: resolved.candidates, at: now }
    onDemandScan = {
      root: target, entry, source, candidates: resolved.candidates, at: now,
      explicit: chosen ? target : null,
    }
    return { entry, source, root: target, candidates: resolved.candidates }
  }

  const snapshot = async (preloaded?: ManagerState, requested: string | null = requestedWorkspace, refresh = false): Promise<RulesPayload> => {
    const state = preloaded ?? (await readState())
    const { entry, source, root, candidates } = await currentEntry(state, requested, refresh)
    if (entry === null) {
      return {
        rules: [],
        sources: [],
        scannedAt: 0,
        // No entry means no walk, so there is nothing to report: an empty list
        // here says "no problem", not "problems were hidden".
        diagnostics: [],
        truncated: false,
        workspace: { path: root, source, options: candidates },
      }
    }
    // A browser request carries no agent, so the attachments are the ones the
    // most recent session earned. A rule is published either way; this only
    // decides whether it reads as resident or as an index line.
    const attachment = entry.cwd === lastPanelCwd && recentTouches === lastPanelTouches
      ? lastPanelAttachments
      : attachmentOf(entry.rules, recentTouches, entry.cwd, entry.projectRoot)
    lastPanelTouches = recentTouches
    lastPanelCwd = entry.cwd
    lastPanelAttachments = attachment
    // Every scanned rule is published; `active`/`disabledBy` carry the state, so
    // the panel can list and toggle a disabled rule instead of losing it.
    const rules = entry.allRules.map((rule) =>
      toRow(rule, state, isSourceEnabled(state, rule.sourceKey, rule.scope), attachment.attached))
    return {
      rules,
      sources: toSourceRows(entry, state),
      scannedAt: entry.at,
      // The scan's own diagnostics are keyed by source, because that is what
      // they are about: a directory, not a rule. `root` is the directory this
      // document describes, which is the closest thing to a scope key for a
      // diagnostic raised before any source was resolved.
      // Attachment problems (a pattern skipped for backtracking risk, a cap on
      // how many rules may be compiled) are published with the scan's own: both
      // are "the walk or the matching had a limit", and the panel already has a
      // place for that.
      diagnostics: toPanelDiagnostics([...entry.diagnostics, ...attachment.diagnostics], root ?? undefined, SCAN_KIND),
      truncated: entry.truncated,
      workspace: { path: root, source, options: candidates },
    }
  }

  /**
   * Apply one write from the panel.
   *
   * Only state.json is written: external rule files are never touched, which is
   * the plugin's read-only promise. The per-agent scan cache is dropped
   * afterwards so the next read reflects the change immediately instead of up
   * to RESCAN_INTERVAL_MS later.
   */
  const applyAction = async (parsed: RulesAction, requested: string | null): Promise<Response> => {
    const state = await readState()
    let updated: ManagerState
    if (parsed.action === 'setSource') {
      // A scoped write lands under its scope-qualified key; an unscoped one keeps
      // writing the legacy bare entry, and neither ever removes the other.
      updated = { ...state, sources: { ...state.sources, [scopedKey(parsed.key, parsed.scope)]: parsed.enabled } }
    } else {
      // Start from the effective list: a scoped write replaces the whole list
      // under its key, so ignoring it would re-enable every other rule the legacy
      // bare entry (or this tier) had switched off.
      const current = disabledPaths(state, parsed.key, parsed.scope)
      const next = parsed.enabled
        ? current.filter((p) => p !== parsed.path)
        : current.includes(parsed.path) ? [...current] : [...current, parsed.path]
      updated = { ...state, disabled: { ...state.disabled, [scopedKey(parsed.key, parsed.scope)]: next } }
    }
    await writeState(updated)

    // Drop every cached scan so the next read re-runs with the new state.
    for (const agent of knownAgents) scans.delete(agent)
    knownAgents.clear()
    // Both panel-side caches hold a scan too, and both would otherwise keep
    // serving the pre-write rule set - including in the response to this very
    // request, which made a toggle look like it bounced straight back. The root
    // is read first so the rescan stays in the workspace the panel was showing.
    //
    // A write may name its workspace as well, and then it wins over both caches:
    // the panel is showing that directory, and answering a write made in B with
    // A's rules would look like a switch that bounced back. The name is honored
    // only when the resolver offers it, so a POST cannot point the rescan at a
    // directory the host never named; the candidates come back with it, keeping
    // the switch on offer in the response the panel renders from.
    const resolved = requested === null ? null : resolveWorkspace(workspaceProbes(lastScan?.projectRoot ?? null))
    const chosen = resolved !== null && requested !== null && resolved.candidates.includes(requested)
      ? requested
      : null
    if (resolved !== null) lastCandidates = { candidates: resolved.candidates, at: Date.now() }
    const panelRoot = chosen ?? lastScan?.projectRoot ?? onDemandScan?.root ?? null
    lastScan = null
    onDemandScan = null
    // The state this write produced is already in hand: rescanning and answering
    // with it keeps this whole request to a single read of state.json.
    if (panelRoot !== null) lastScan = await scanOutsideAgent(panelRoot, updated)
    // The write keeps the panel's own workspace when the resolver did not offer
    // it back: passing bare `chosen` answered a POST that named B with the
    // *default* workspace's rules, so a switch flipped in B looked like it had
    // bounced to A.
    return jsonResponse(await snapshot(updated, chosen ?? requested))
  }

  /**
   * Validate one POST and queue its write.
   *
   * The queue is what makes the read-modify-write atomic; a body that does not
   * parse never reaches it, so a malformed request cannot hold it up.
   */
  const handleAction = async (request: Request): Promise<Response> => {
    let action: unknown
    try {
      action = await request.json()
    } catch {
      return jsonResponse({ ok: false, error: 'invalid JSON body' }, 400)
    }
    const parsed = parseAction(action)
    if (parsed === null) return jsonResponse({ ok: false, error: 'unknown action' }, 400)

    // The workspace travels in the query of the POST that carries the write; a
    // body-only reader would answer with the default workspace's snapshot, and
    // the panel would jump back the moment a switch was flipped. It is read from
    // this request rather than from a shared slot: two windows write
    // concurrently, and a module-level "current request" let one window's write
    // be answered with the other's workspace.
    const requested = parseWorkspaceQuery(request.url) ?? requestedWorkspace
    const queued = writeChain.then(() => applyAction(parsed, requested))
    // Swallow a rejection so one failed write cannot wedge every later one.
    writeChain = queued.then(() => undefined, () => undefined)
    // The write itself can fail - state.json unreadable, or its directory not
    // writable - and a rejection escaping from here reaches the panel as a bare
    // transport error with no reason in it. Answer with the reason instead, so
    // the panel's own error line can say what went wrong.
    try {
      return await queued
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return jsonResponse({ ok: false, error: message }, 500)
    }
  }

  // `ctx.inject` is cordis's own late-binding entry point, typed on Context.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (scoped) => { registerOnConnection(scoped) })
  } else {
    // A context without `inject` (an older host, or a test double) still gets
    // the route when the service is already present; it cannot late-bind.
    registerOnConnection(ctx)
  }

  // The tool resolves its index per call from `exec.agent`, so one registration
  // serves every agent without capturing a stale catalog.
  ctx.tools.register(createReadRulesTool((agent) => {
    if (agent === undefined || agent === null || typeof agent !== 'object') return {}
    return scans.get(agent)?.index ?? {}
  }, config.readRulesOutput))

  /**
   * Learn which files the session worked with, from the host's tool pipeline.
   *
   * `tools/result` is the documented seam for observing settled outcomes
   * (`docs/subsystems/tools.md`: "Observe the frozen, lossless-JSON final
   * outcome. Listener failures are contained."), and the host keys its scoped
   * dispatch by `exec.agent`, which is exactly the granularity this cache has.
   * The host's own agent-instructions plugin learns its nested files from the
   * same kind of signal - "successful filesystem operations discover newly
   * relevant nested files" - rather than watching the disk. That matters here:
   * a watch would fire for edits made by anything, while a rule should become
   * resident because *this session* touched a matching file.
   *
   * Registered only for agents that could use it: with `injectRules: false`
   * there is no block to attach anything to.
   */
  const observeTouches = (scoped: Context): void => {
    scoped.on('tools/result', (
      exec: Readonly<ToolExecution>,
      result: Readonly<ToolExecutionResult>,
    ): undefined => {
      // A failed call is not a touch: a read that errored never put the file in
      // front of the model, and a failed edit changed nothing on disk.
      if (result.isError === true) return undefined
      const agent = exec.agent
      if (agent === undefined || agent === null || typeof agent !== 'object') return undefined
      // Unknown tools and malformed arguments yield no files rather than throw:
      // an observer must not be able to fail a tool call (the host would log it
      // and continue, but the cost is still a wasted turn).
      const files = touchedFilesOf(exec.name, exec.arguments)
      if (files.length === 0) return undefined
      // A session that moved to another tree starts over: the old list was built
      // against a directory the session has left, and a rule kept resident by it
      // would be charged as context it no longer describes.
      // A tool call can also be the first thing to arrive after the move.
      const cwd = scans.get(agent)?.cwd
      if (cwd !== undefined) resetTouchesIfMoved(agent, cwd)
      const list = touchesOf(agent)
      list.record(files)
      recentTouches = list.list()
      return undefined
    })
  }

  // `injectRules: false` keeps the tool available but stops the prompt block,
  // so a deployment can serve rules on demand only.
  if (!config.injectRules) return

  observeTouches(ctx)
  ctx.on('agent/pre-step', async (
    { agent, messages, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    signal.throwIfAborted()

    // A first step with nothing claimed owns no request: injecting here would
    // manufacture one. The host's own agent-instructions plugin guards the same
    // case (`step === 1 && decision.messages.length === 0`). Later steps may be
    // tool continuations that legitimately carry no user message.
    if (step === 1 && decision.messages.length === 0) return decision

    const { rules, projectRoot, cwd } = await loadFor(agent, signal)
    // The session's own files decide which on-demand rules stop being on demand
    // for this and every later request in the session (the touch list is not
    // consumed by reading it). See `attach.ts` for the matching rules.
    //
    // `loadFor` has already dropped a list collected under a directory the
    // session has left (it asks the host for the directory on every request).
    const attached = attachmentOf(rules, touches.get(agent)?.list() ?? [], cwd, projectRoot)
    const block = renderRulesBlock(rules, {
      projectRoot,
      perRuleMax: config.perRuleMax,
      userRulesTotal: config.userRulesTotal,
      projectRulesTotal: config.projectRulesTotal,
      attached: attached.attached,
    })
    if (block === '') return decision

    const injection = createUserMessage({
      content: [{ type: 'text', text: block }],
      source: { kind: 'rules-context', form: 'instructions' },
    })
    // Fold the block right after the claimed batch, so the direct prompt
    // precedes it and driver-appended runtime context follows it.
    const planned = planInjection(decision.messages, messages, injection, block)
    if (planned.skipped !== undefined) return decision
    return { ...decision, messages: planned.messages }
  })
}

export { Config } from './config.ts'
