/**
 * The contract shared by the host half and the browser half.
 *
 * Kept in its own module, importing neither React nor the slots package: the
 * host bundle is built for Node, and pulling the browser entry in for two
 * symbols would drag React and every component into it.
 */
import type { Diagnostic } from './types.ts'

/**
 * Where the host publishes the current catalog, and what the panel fetches.
 *
 * The `/api` prefix is **required and belongs to the host**, not to the caller:
 * `connection.fetch.register` validates the path with
 * `endpointFromPath(API_PATH, route.path)`, which returns `undefined` unless the
 * path literally starts with `/api/`, and `assertFetchRoute` then throws
 * (`dsh-client-connection/src/rpc-host.ts`). Registering here is also what
 * routes the request through Connection's browser-trust fence, so only an owner
 * Peer (the local GUI) can read it.
 *
 * One constant, both halves: the host registers exactly what the panel fetches.
 */
export const RULES_ROUTE = '/api/rules-manager/rules.json'

/**
 * Resolve a plugin route against the document base.
 *
 * A bare \`fetch('/api/...')\` resolves against the *origin* root, which drops
 * the directory the GUI is actually mounted at; the window URL may also be a
 * \`file://\` URL under Electron. Resolving against \`document.baseURI\` keeps the
 * mount point, which is what the reference plugin does. The launch token in the
 * query is deliberately not carried over: by the time the panel runs, the
 * window has been redirected to the clean URL and authentication rides the
 * signed cookie the browser attaches to same-origin requests anyway.
 *
 * \`base\` is a parameter so the behavior is testable without a DOM. A base whose
 * last segment looks like a file name is reduced to its directory.
 */
export function resolveUrl(path: string, base?: string): string {
  // Protocol-relative (\`//host/x\`) and non-absolute paths are already usable.
  if (!path.startsWith('/') || path.startsWith('//')) return path
  const resolved = base ?? (typeof document === 'undefined' ? undefined : document.baseURI)
  if (resolved === undefined || resolved === '') return path
  try {
    const rooted = new URL(resolved)
    // A document URL that names a file (…/index.html, and every file:// page)
    // must be reduced to its directory first, or that file name is treated as a
    // path segment and the result points one level too deep.
    if (!rooted.pathname.endsWith('/')) {
      const last = rooted.pathname.slice(rooted.pathname.lastIndexOf('/') + 1)
      rooted.pathname = last.includes('.')
        ? rooted.pathname.slice(0, rooted.pathname.lastIndexOf('/') + 1)
        : rooted.pathname + '/'
    }
    return new URL(path.slice(1), rooted.href).href
  } catch {
    return path
  }
}

/**
 * Which side of the panel a diagnostic belongs to.
 *
 * `rule` means it is about one rule file and is shown inside that rule's row;
 * `scan` means it is about the walk itself — an unreadable directory, a cap
 * that was reached — and is published beside the rules instead.
 */
export type DiagnosticKind = 'rule' | 'scan'

/** One diagnostic attached to a rule, as the panel shows it. */
export interface RuleDiagnosticRow {
  readonly code: string
  readonly detail: string
  /**
   * 1-based line in the rule file, when the diagnostic knows one.
   *
   * Optional because half of them are about a file or a directory rather than a
   * line; the panel shows it only when the host sent it.
   */
  readonly line?: number
  /**
   * Whether this came from parsing a rule file or from the scan itself — an
   * unreadable directory, or a cap that was reached part-way.
   *
   * Always present: the host states it at each call site rather than deriving it
   * from the code, because the same code can be raised on either side and only
   * the caller knows which list the row is going into.
   */
  readonly kind: DiagnosticKind
  /**
   * The rule's absolute path, or the source's scope-qualified key for a scan
   * diagnostic that has no single file to point at.
   *
   * Carried so the cost report can list these rows beside the real ones without
   * mistaking two sources' diagnostics for each other.
   */
  readonly key?: string
  /**
   * Absolute path of the file this was parsed out of, when there is one.
   *
   * A rule-level code reaches the panel twice: attached to its rule row, and
   * again in the walk-level list, where it is the only trace left when the file
   * was rejected and produced no row at all. That second appearance needs the
   * path to say which file it is about — and to be recognisable as the same
   * finding the rule row already shows, rather than a second problem.
   */
  readonly path?: string
}

/**
 * One rule as the browser panel renders it.
 *
 * The panel groups by source and scope, so it needs to know where each rule
 * came from — not just what it says. Every field the panel does not strictly
 * need to *render* is still here because a row is the only handle the UI has:
 * a missing `sourceKey` makes grouping impossible, and a missing `enabled`
 * distinction makes a disabled rule look active.
 */
export interface RuleRow {
  readonly path: string
  readonly name: string
  readonly type: 'always' | 'requested' | 'manual'
  readonly description: string
  readonly descriptionTokens: number
  readonly bodyTokens: number
  /**
   * Characters in the body, the unit the injection budget charges.
   *
   * Published beside `bodyTokens` because the two answer different questions:
   * the budget is spent in characters (8000 per rule, 6000/12000 per tier) and
   * the panel cannot reproduce that arithmetic from a token estimate.
   */
  readonly bodyLength: number
  /**
   * Whether the file itself is enabled — the frontmatter's own `enabled: false`.
   *
   * This is a property of the *file*, not of whether the rule is in effect. Use
   * {@link RuleRow.active} for that: a rule disabled from the panel keeps
   * `enabled: true` here and reports `active: false`.
   */
  readonly enabled: boolean
  /**
   * Whether this rule actually takes effect right now.
   *
   * True only when the file is enabled, its source is switched on, and the rule
   * has not been disabled from the panel. This is what a UI filters on, and it
   * is the reason every scanned rule stays in the payload: a rule that simply
   * vanished could never be re-enabled.
   */
  readonly active: boolean
  /**
   * Which layer switched the rule off, or null when it is active.
   *
   * Distinguishes \`'frontmatter'\` (written in the file, not toggleable here)
   * from \`'state'\` (this panel turned it off), and \`'source'\` (its whole
   * source is off).
   */
  readonly disabledBy: 'frontmatter' | 'state' | 'source' | null
  /** The convention's stable key: codebuddy, cursor, claude, agents. */
  readonly sourceKey: string
  /** Human-readable source name, for a group heading. */
  readonly sourceLabel: string
  /** Which tier it came from: the user's home, or the session's project. */
  readonly scope: 'user' | 'project'
  /** Which convention family the file follows. */
  readonly family: string
  /** Glob/path patterns the rule declares. */
  readonly patterns: readonly string[]
  /**
   * Whether the rule's body is resident because this *session* touched a file
   * its patterns match.
   *
   * A view of the current session, not a property of the file: the rule is still
   * written as on-demand and stays on-demand in a session that never touches a
   * matching file. True only for an active `requested` rule; the host decides it
   * in `src/attach.ts`.
   */
  readonly attached: boolean
  /** Non-fatal problems found while reading it. */
  readonly diagnostics: readonly RuleDiagnosticRow[]
}

/** One scanned root, with the real directory it resolved to. */
export interface RuleSourceRow {
  readonly key: string
  readonly label: string
  readonly scope: 'user' | 'project'
  /** Absolute path on disk — the directory the user asked to see. */
  readonly path: string
  /** Whether this source is switched on in state.json. */
  readonly enabled: boolean
  /** How many rules this root contributed, switched off or not. */
  readonly ruleCount: number
  /** How many of them are in effect (see {@link RuleRow.active}). */
  readonly activeRuleCount: number
}

/**
 * The published document.
 *
 * An object rather than a bare array so it can grow; `rules` stays the first
 * field so a reader written against the original shape keeps working.
 */
export interface RulesPayload {
  readonly rules: readonly RuleRow[]
  readonly sources: readonly RuleSourceRow[]
  /** When the scan behind this document ran, in epoch milliseconds. */
  readonly scannedAt: number
  /**
   * Problems the scan hit that belong to no single rule.
   *
   * A directory it could not read, or a cap it reached part-way. They are the
   * diagnostics that decide whether the rule list is *complete*, so they have
   * to travel outside the rows: without them the panel presents a truncated
   * walk as the whole truth.
   *
   * Optional: a host built before this field sends none, which reads as "no
   * scan-level problem" — the same thing an old host meant by being silent.
   */
  readonly diagnostics?: readonly RuleDiagnosticRow[]
  /**
   * True when the scan stopped at one of its directory or entry caps.
   *
   * Distinct from `diagnostics` because it is the one condition the panel must
   * word most carefully: everything listed is real, but it may not be all.
   */
  readonly truncated?: boolean
  /**
   * Which directory the document describes, and how it was chosen.
   *
   * `null` means no workspace could be resolved at all, which the panel must
   * word differently from "this workspace has no rules" — the two look
   * identical to a user staring at an empty list.
   */
  readonly workspace: RuleWorkspaceInfo
}

/**
 * Project the host's own diagnostics into the rows the panel renders.
 *
 * Two sources feed one list. A rule-level diagnostic rides on its rule row and
 * is shown inside it; a scan-level one — an unreadable directory, a cap that
 * was reached — belongs to no single rule, so it is lifted out here and
 * published beside the rules instead of being dropped on the floor. Dropping it
 * was the worst possible outcome: the panel then presented a truncated walk as
 * a complete list of rules.
 *
 * `key` carries the rule's path, or the scope-qualified source key when the
 * diagnostic is about a directory rather than a file, so two sources' rows
 * cannot be confused for each other in the report.
 *
 * `kind` is the caller's statement about where the row came from, not something
 * derived from the code: the same code can be raised about a rule or about the
 * walk (a skipped pattern is a rule's problem, a reached cap is the walk's), and
 * only the call site knows which. Both call sites say so explicitly.
 */
export function toPanelDiagnostics(
  diagnostics: readonly Diagnostic[],
  key: string | undefined,
  kind: DiagnosticKind,
): RuleDiagnosticRow[] {
  return diagnostics.map((d) => {
    const row: { code: string; detail: string; line?: number; kind: DiagnosticKind; key?: string; path?: string } = {
      code: d.code,
      detail: d.detail,
      kind,
    }
    if (d.line !== undefined) row.line = d.line
    if (d.path !== undefined) row.path = d.path
    if (key !== undefined) row.key = key
    return row
  })
}

/** The directory a document describes, and where it came from. */
export interface RuleWorkspaceInfo {
  readonly path: string | null
  /**
   * `selected` means the panel asked for this directory explicitly, through the
   * route's `?workspace=` parameter, rather than the host picking one for it.
   */
  readonly source: 'last-scan' | 'workspace-registry' | 'sessions' | 'selected' | 'none'
  /**
   * Every directory the host could describe, in its own precedence order, so a
   * panel sitting in a workspace with more than one project can offer a switch.
   *
   * Optional: a host built before this field existed sends none, and an empty
   * or absent list must simply mean "one workspace, no switch".
   */
  readonly options?: readonly string[]
}

/**
 * A write request the panel may send.
 *
 * `scope` is optional on the wire: a client that predates scoping sends none,
 * and the write then lands on the legacy bare key. The current panel always
 * names the tier, which is what keeps one tier's switch from flipping the same
 * key in the other.
 */
export type RulesAction =
  | { readonly action: 'setSource'; readonly key: string; readonly enabled: boolean; readonly scope?: 'user' | 'project' }
  | { readonly action: 'setRule'; readonly key: string; readonly path: string; readonly enabled: boolean; readonly scope?: 'user' | 'project' }
