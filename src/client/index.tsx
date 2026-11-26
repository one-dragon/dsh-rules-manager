/**
 * Browser entry: the settings section, the sidebar entry, and the main panel.
 *
 * The client half must **return a plugin object**, not a bag of named exports:
 * DSH's own loader rejects anything else.
 * \`dsh-cordis-client-runner/src/client/evaluator.ts\` guards the closure's
 * return value with \`isDynamicCordisPlugin\` and throws
 * "client half must \`return\` a plugin: a function, or an object with an
 * \`apply(ctx)\` method" otherwise. Without an \`apply\` export every
 * registration below is dead code: no settings section, no sidebar entry.
 *
 * \`inject\` lists only \`slots\`. Cordis has no optional-dependency syntax
 * (\`docs/cordis-tutorial/03-services.zh.md\`): a missing injected service
 * unmounts the whole plugin, so \`locale\` — a nice-to-have — is probed at
 * use time through \`ctx.get('locale')\` instead.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { installPanelStyles } from './styles.ts'
import { BRAND_ICONS } from './brand-icons.ts'
import { RULES_ROUTE, resolveUrl, type RuleDiagnosticRow, type RuleRow, type RuleSourceRow, type RulesAction, type RulesPayload } from '../panel.ts'
import {
  costReport, disabledReasonKey, filterByScope, filterRules, format, groupBySource, noteKeyOf, optimistic,
  residentTokens, ruleCost, ruleSourceId, scopeIn, sortByCost, sourceId, sourceKeyOf, statusCounts, statusIn, statusOf,
  tabStep, totalResidentTokens, type SourceGroup, type ScopeTab, type StatusTab,
} from './group.ts'

// Re-exported so the existing tests and any consumer keep resolving them here.
export { filterRules, residentTokens, groupBySource, sortByCost, totalResidentTokens, statusOf, statusCounts, optimistic, scopeIn }

// Re-exported so a consumer of the browser entry finds the contract here too.
export { RULES_ROUTE }
export type { RuleRow, RuleSourceRow, RulesAction, RulesPayload }

const SECTION_ID = 'dsh-rules-manager'
const PANEL_ID = 'dsh-rules-manager'
const NS = 'dshRulesManager'

/** DOM id of one tab, so a tablist's roving tab stop has a stable target. */
const tabId = (list: 'scope' | 'status', key: string): string => SECTION_ID + '-' + list + '-tab-' + key

/** The one region both tablists filter; every tab points at it via aria-controls. */
const PANEL_BODY_ID = SECTION_ID + '-panel-body'

/**
 * Move selection and focus inside one tablist, per the APG tabs pattern.
 *
 * Automatic activation: the arrow key selects the tab and moves focus to it,
 * which is what the packaged SegmentedTabs does too. Only the keys the pattern
 * defines are consumed, so typing or scrolling inside the panel is untouched.
 */
function onTabKey<T extends string>(keys: readonly T[], value: T, select: (next: T) => void) {
  return (event: KeyboardEvent<HTMLButtonElement>): void => {
    const next = tabStep(event.key, keys.indexOf(value), keys.length)
    if (next === null) return
    const target = keys[next]
    if (target === undefined) return
    event.preventDefault()
    select(target)
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
}

export interface RulesPanelProps {
  readonly ctx: Context
  readonly t: (key: string) => string
}

/**
 * The panel body, laid out like the reference skills-manager.
 *
 * Information density is the point: a titled header, a stat bar, full-width
 * tabs, labelled filter fields, then one card per source whose header carries
 * the **real absolute directory** — the thing users most often cannot find.
 *
 * All capability is preserved from the earlier layout: scope and status tabs
 * (including Disabled), grouping by source, cost sorting with the explanatory
 * footnote, per-rule and per-source switches, optimistic writes, and the three
 * disabled reasons. A disabled rule is never hidden, because a row that
 * vanished could never be switched back on.
 */
/**
 * The mark that heads a source card: the vendor's own artwork where one is
 * vendored (`brand-icons.ts`), and the label's initials where none exists.
 *
 * The initials are not a placeholder for a missing icon — several conventions
 * (`.agents`, Junie, Copilot) have no mark to draw, and inventing one would
 * claim an identity that does not exist.
 */
function SourceBadge({ group }: { group: SourceGroup }) {
  // The family rides on the rules, not on the source row; a source whose rules
  // were all filtered out simply falls back to its initials.
  const family = group.rules[0]?.family
  const icon = family === undefined ? undefined : BRAND_ICONS[family]
  return (
    <span className={'dshrm-badge s-' + sourceKeyOf(group.key) + (icon === undefined ? '' : ' has-brand')}>
      {icon === undefined
        ? group.label.slice(0, 2).toUpperCase()
        : (
          <svg
            className="dshrm-brand"
            viewBox={icon.viewBox}
            role="img"
            aria-label={icon.title}
            dangerouslySetInnerHTML={{ __html: icon.body }}
          />
        )}
    </span>
  )
}

/**
 * Whether the read about to start is the one the Refresh button asked for.
 *
 * A refresh is an ascending tick plus the tick the last read served; they are
 * equal whenever an ordinary read is due. Extracted because this single
 * comparison is what decides both "keep the rows on screen" and "?refresh=1",
 * and it used to be unreachable for a test while it lived inside the effect.
 */
export function isForcedRead(tick: number, served: number): boolean {
  return tick !== served
}

/**
 * The receipt behind the cost line.
 *
 * The line states one number and the number is an aggregate: it does not say
 * which rule holds the tokens, or which of them are only paid for on demand.
 * A dialog rather than a hover card, because the figures have to stay on screen
 * while the reader compares them and a native title is neither selectable nor
 * reachable on a touch screen. It is a pure function of the rows, so the whole
 * table can be asserted without a DOM.
 */
export function TokenBreakdown({ rules, diagnostics, t, onClose }: {
  rules: readonly RuleRow[]
  /**
   * The scan's own diagnostics, which are not attached to any rule.
   *
   * They belong in this table because they are part of the same question —
   * where did the tokens go, and is this list the whole story — and because a
   * count that appears in the panel but nowhere in the receipt would leave the
   * two totals disagreeing.
   */
  diagnostics: readonly RuleDiagnosticRow[]
  t: (key: string) => string
  onClose: () => void
}) {
  // Heaviest first: the point of the table is where the tokens went.
  const rows = [...rules].sort((a, b) => ruleCost(b).resident - ruleCost(a).resident || a.name.localeCompare(b.name))
  // One report for the whole table. The per-rule figures come from the same
  // maths, and the two rows that belong to no rule — the requestable index's
  // scaffolding and the scan's own complaints — come from here too, so the
  // totals below are a sum of the rows *above* them rather than a second
  // arithmetic that could drift.
  const report = costReport(rules)
  // Only text that is really injected counts as resident: the scan's own
  // complaints are not tokens, so they are reported as a note rather than
  // quietly folded into the total.
  const resident = report.resident + report.catalog
  const onDemand = report.onDemand
  // Focus moves into the dialog and comes back afterwards. Without it a
  // keyboard user who opened the table was left behind it: Tab walked the panel
  // underneath, and Escape was not observed at all.
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const restore = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null
    cardRef.current?.focus()
    // `KeyboardEvent` here is React's, which is not what a document listener
    // receives; the DOM one is what the handler is actually handed.
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (restore !== null && typeof restore.focus === 'function') restore.focus()
    }
  }, [onClose])
  return (
    <div className="dshrm-modal" role="dialog" aria-modal="true" aria-label={t('costDetails')} onClick={onClose}>
      <div className="dshrm-modal-card" ref={cardRef} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="dshrm-modal-head">
          <h2 className="dshrm-modal-title">{t('costDetails')}</h2>
          <button type="button" className="dshrm-btn" onClick={onClose}>{t('close')}</button>
        </div>
        <div className="dshrm-modal-body">
          <table className="dshrm-cost-table">
            <thead>
              <tr>
                <th className="dshrm-cost-th">{t('costRule')}</th>
                <th className="dshrm-cost-th">{t('costState')}</th>
                <th className="dshrm-cost-th">{t('costResident')}</th>
                <th className="dshrm-cost-th">{t('costOnDemand')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rule) => {
                const cost = ruleCost(rule)
                // An inactive rule has no cost of either kind, so it is listed
                // by why it is out rather than by a type it is not paying for.
                const state = rule.active ? t('type.' + rule.type) : t('stat.disabled')
                return (
                  <tr key={rule.scope + ':' + rule.path + ':' + rule.name}>
                    <td className="dshrm-cost-td">{rule.name}</td>
                    <td className="dshrm-cost-td">{state}</td>
                    <td className="dshrm-cost-td">{cost.resident}</td>
                    <td className="dshrm-cost-td">{cost.onDemand}</td>
                  </tr>
                )
              })}
              {/* A row that belongs to no rule: the requestable index's own
                  tags, preamble and boilerplate. It is resident whenever any
                  rule is requestable, so leaving it out made the total an
                  under-count that no reader could see the shape of. */}
              {report.catalog > 0
                ? (
                  <tr className="dshrm-cost-fixed">
                    <td className="dshrm-cost-td">{t('costCatalog')}</td>
                    <td className="dshrm-cost-td">{t('costCatalogNote')}</td>
                    <td className="dshrm-cost-td">{report.catalog}</td>
                    <td className="dshrm-cost-td">0</td>
                  </tr>
                )
                : null}
              <tr className="dshrm-cost-total">
                <td className="dshrm-cost-td">{format(t('costTotal'), { n: rows.length })}</td>
                <td className="dshrm-cost-td" />
                <td className="dshrm-cost-td">{resident}</td>
                <td className="dshrm-cost-td">{onDemand}</td>
              </tr>
            </tbody>
          </table>
          {/* What the budget did to the rows above: a clipped body is charged
              less than its own length, and a dropped rule is charged nothing at
              all. Both make the table's numbers differ from the file sizes, so
              they are stated rather than left to be discovered. */}
          {report.truncated.length > 0
            ? <p className="dshrm-cost-note">{format(t('costTruncated'), { n: report.truncated.length })}</p>
            : null}
          {report.omitted.length > 0
            ? <p className="dshrm-cost-note">{format(t('costOmitted'), { n: report.omitted.length })}</p>
            : null}
          {/* The scan is the other half of "is this list the whole truth": the
              totals can be perfectly accurate for a walk that stopped early. */}
          {diagnostics.length > 0
            ? (
              <div className="dshrm-cost-note">
                <p className="dshrm-cost-note-p">{format(t('costScanNote'), { n: diagnostics.length })}</p>
                <ul className="dshrm-diag-list">
                  {diagnostics.map((d, index) => (
                    <ScanDiagnosticRow key={d.code + '-' + index} row={d} t={t} />
                  ))}
                </ul>
              </div>
            )
            : null}
          <p className="dshrm-cost-hint">{t('costHint')}</p>
        </div>
      </div>
    </div>
  )
}

export function RulesPanel({ ctx, t, rules, sources, workspace, scannedAt = 0, selectedWorkspace = null, onSelectWorkspace, state, onRetry, refreshing = false, onRefresh, onToggleRule, onToggleSource, pending, error, scanDiagnostics = [], truncated = false }: RulesPanelProps & {
  rules: readonly RuleRow[]
  sources: readonly RuleSourceRow[]
  workspace: { readonly path: string | null; readonly source: string; readonly options?: readonly string[] }
  /** When the catalog behind this render was scanned, for the header's stamp. */
  readonly scannedAt?: number
  /** Which workspace the panel is showing; null means the host's own choice. */
  readonly selectedWorkspace?: string | null
  /** Switch to another workspace the host offered. */
  readonly onSelectWorkspace?: (path: string) => void
  state: 'loading' | 'ready' | 'failed'
  onRetry: () => void
  /** True while a forced read is in flight, so the button can say so. */
  readonly refreshing?: boolean
  /** Force a read past the host's caches; falls back to onRetry when absent. */
  readonly onRefresh?: () => void
  onToggleRule: (rule: RuleRow, enabled: boolean) => void
  onToggleSource: (group: SourceGroup, enabled: boolean) => void
  /** Paths/keys currently waiting on the host, so a row can disable itself. */
  pending: readonly string[]
  /** The last write failure, shown until the next successful write. */
  error: string | null
  /**
   * Problems the scan itself hit, which belong to no rule.
   *
   * Named apart from the `diagnostics` count below, which counts *rules* with
   * diagnostics. These are about the walk — a directory that could not be read,
   * or a cap that was reached — and they are the only thing that can say
   * whether the list underneath is the whole story.
   */
  readonly scanDiagnostics?: readonly RuleDiagnosticRow[]
  /** True when the walk stopped at one of its caps. */
  readonly truncated?: boolean
}) {
  const [query, setQuery] = useState('')
  // The project tier, not "all": a host with no user-level sources would
  // otherwise open on a view that lists the same cards as Project does, with a
  // workspace picker that only ever changes the project half of it.
  const [scope, setScope] = useState<ScopeTab>('project')
  const [status, setStatus] = useState<StatusTab>('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [collapsed, setCollapsed] = useState<readonly string[]>([])
  const [detailsOpen, setDetailsOpen] = useState(false)
  // The findings list is the long form of one number in the stat bar, so it
  // starts folded: a walk with a dozen skips must not push the rules off screen.
  const [scanDiagOpen, setScanDiagOpen] = useState(false)

  // A failed or empty read must still say something: a blank panel is
  // indistinguishable from a broken plugin.
  if (state !== 'ready') {
    const message = state === 'failed' ? t('loadFailed') : t('loading')
    return (
      <div className="dshrm-panel">
        <div className="dshrm-empty dshrm-full" role={state === 'failed' ? 'alert' : 'status'}>
          {message}
          {state === 'failed'
            ? <div style={{ marginTop: 10 }}><button type="button" className="dshrm-retry" onClick={onRetry}>{t('retry')}</button></div>
            : null}
        </div>
      </div>
    )
  }

  // Search, then scope. Both narrow the catalog *and* every number the panel
  // prints about it, so they run before the counts: the stat bar, the tab
  // labels and the source dropdown all describe the rows underneath the tabs.
  // Counting the unscoped catalog left "全局" showing an empty list next to an
  // "全部（14）" tab — a tab that looked like it did nothing at all.
  const inScope = scopeIn(filterRules(rules, query), scope)
  const counts = statusCounts(inScope)
  const enabled = inScope.filter((rule) => rule.active).length
  const diagnostics = inScope.filter((rule) => rule.diagnostics.length > 0).length
  // Cost is reported over the search result, so switching a status tab does not
  // change what the number means.
  const resident = totalResidentTokens(inScope)

  const byStatus = statusIn(inScope, status)
  // The source filter carries the scope: the same key exists in both tiers, so a
  // bare key would mix a project source into a user-scope view. The dropdown
  // also carries a diagnostics pseudo-source, so the warning colour in the stat
  // bar is not the end of the trail: clicking that number lands here.
  const bySource = sourceFilter === 'all'
    ? byStatus
    : sourceFilter === 'diag'
      ? byStatus.filter((rule) => rule.diagnostics.length > 0)
      : byStatus.filter((rule) => ruleSourceId(rule) === sourceFilter)
  // `'diag'` is the one source of truth for the diagnostics view. A second
  // boolean drifted out of step as soon as anything set the dropdown directly
  // (switching workspace, or picking "all sources"): the list was then filtered
  // by diagnostics twice, the count fell to zero, and the two controls that
  // could undo it — the stat button and the dropdown option — disappeared with
  // it. The panel sat on an empty list with no way back.
  const diagOnly = sourceFilter === 'diag'
  // Only the sources this tier can contribute from. Handing over the full list
  // kept every group card on screen after a tab switch — the other tier stayed
  // visible as an empty "0 rules" card, which reads as "the tab did nothing".
  const scopedSources = filterByScope(sources, scope)
  const groups = groupBySource(sortByCost(bySource), scopedSources)
  // What the *search* matched, before the tier narrows it. An empty tier is not
  // an empty search, and the panel used to word both as "no rule matches":
  // switching to 全局 in a project-only catalog said the filters had failed when
  // nothing had been filtered at all.
  const inQuery = filterRules(rules, query)
  const hasAnyRule = inQuery.length > 0
  // The region both tablists filter is named by both selected tabs.
  const panelLabel = tabId('scope', scope) + ' ' + tabId('status', status)

  const toggleCollapse = (key: string) => setCollapsed((current) =>
    current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
  )

  // Picking a tier also drops the source filter: that filter names a scoped
  // source id, which the other tier never contains.
  const selectScope = (next: ScopeTab) => { setScope(next); setSourceFilter('all') }
  const setDiagnosticsView = (on: boolean): void => { setSourceFilter(on ? 'diag' : 'all') }

  // No "all" tab: it showed both tiers at once while the workspace picker under
  // it still only moved the project half, so it read as a second Project tab.
  // `scopeIn`/`filterByScope` keep the 'all' branch for callers that want it.
  const scopeTabs: ReadonlyArray<readonly [ScopeTab, string]> = [
    ['user', t('scope.user')],
    ['project', t('scope.project')],
  ]
  const statusTabs: ReadonlyArray<readonly [StatusTab, string]> = [
    ['all', format(t('tab.all'), { n: counts.always + counts.requested + counts.manual + counts.off })],
    ['always', format(t('tab.always'), { n: counts.always })],
    ['requested', format(t('tab.requested'), { n: counts.requested })],
    ['manual', format(t('tab.manual'), { n: counts.manual })],
    ['off', format(t('tab.off'), { n: counts.off })],
  ]
  // Distinct scope-qualified source ids the active tier can contribute from.
  const sourceChoices = [...new Set(scopedSources.map(sourceId))]
  // Workspaces the host offered, minus the one already on screen. A single-entry
  // list is the normal case and must not grow a control that does nothing.
  const workspaceOptions = (workspace.options ?? []).filter((option) => option !== workspace.path)

  return (
    <div className="dshrm-panel">
      <header className="dshrm-head">
        <h1 className="dshrm-title">{t('title')}</h1>
        <p className="dshrm-sub">{t('subtitle')}</p>
        <div className="dshrm-actions">
          {/* A refresh that looks like nothing happened is worse than no button.
              The host answers a repeated read from its 30s cache, so the stamp
              below does not move on its own: this one forces a rescan and says
              so while it does. */}
          <button type="button" className="dshrm-btn" disabled={refreshing} onClick={onRefresh ?? onRetry}>
            {refreshing ? t('refreshing') : t('refresh')}
          </button>
          {scannedAt > 0
            ? (
              <span className="dshrm-cost-l" title={new Date(scannedAt).toLocaleString()}>
                {format(t('scannedAt'), { time: new Date(scannedAt).toLocaleTimeString() })}
              </span>
            )
            : null}
        </div>
      </header>

      <div className="dshrm-stats">
        <div className="dshrm-stat">
          <span className="dshrm-stat-n">{inScope.length}</span>
          <span className="dshrm-stat-l">{t('stat.total')}</span>
        </div>
        <div className="dshrm-stat on">
          <span className="dshrm-stat-n">{enabled}</span>
          <span className="dshrm-stat-l">{t('stat.enabled')}</span>
        </div>
        <div className="dshrm-stat off">
          <span className="dshrm-stat-n">{inScope.length - enabled}</span>
          <span className="dshrm-stat-l">{t('stat.disabled')}</span>
        </div>
        <div className={diagnostics > 0 ? 'dshrm-stat warn' : 'dshrm-stat'}>
          {diagnostics > 0 || diagOnly
            ? (
              <button
                type="button"
                className={'dshrm-stat-btn' + (diagOnly ? ' on' : '')}
                aria-pressed={diagOnly}
                title={t('statDiagnosticsHint')}
                onClick={() => setDiagnosticsView(!diagOnly)}
              >
                <span className="dshrm-stat-n">{diagnostics}</span>
                <span className="dshrm-stat-l">{t('stat.diagnostics')}</span>
              </button>
            )
            : (
              <>
                <span className="dshrm-stat-n">{diagnostics}</span>
                <span className="dshrm-stat-l">{t('stat.diagnostics')}</span>
              </>
            )}
        </div>
      </div>

      <p className="dshrm-cost">
        <span className="dshrm-cost-n">{format(t('costValue'), { n: resident })}</span>
        <span className="dshrm-cost-l">{t('costLabel')}</span>
        <button type="button" className="dshrm-link" onClick={() => setDetailsOpen(true)}>{t('costDetails')}</button>
      </p>
      <p className="dshrm-note">{t('tokenNote')}</p>
      {error !== null ? <p className="dshrm-error" role="alert">{format(t('writeFailed'), { message: error })}</p> : null}
      {detailsOpen
        ? <TokenBreakdown rules={inScope} diagnostics={scanDiagnostics} t={t} onClose={() => setDetailsOpen(false)} />
        : null}

      {/* Two tablists used to be the same shape and the same size, an inch
          apart, with their names visible only to a screen reader — which is why
          they were easy to confuse. Each group now shows its own label. */}
      <div className="dshrm-tabgroup">
        <span className="dshrm-field-l" aria-hidden="true">{t('tablist.scope')}</span>
        <div className="dshrm-tabs dshrm-tabs-seg" role="tablist" aria-label={t('tablist.scope')}>
        {scopeTabs.map(([key, label]) => (
          <button
            key={key}
            id={tabId('scope', key)}
            type="button"
            role="tab"
            aria-selected={scope === key}
            aria-controls={PANEL_BODY_ID}
            tabIndex={scope === key ? 0 : -1}
            className={'dshrm-tab' + (scope === key ? ' on' : '')}
            onClick={() => selectScope(key)}
            onKeyDown={onTabKey(scopeTabs.map(([tabKey]) => tabKey), scope, selectScope)}
          >{label}</button>
        ))}
        </div>
      </div>
      <div className="dshrm-tabgroup">
        <span className="dshrm-field-l" aria-hidden="true">{t('tablist.status')}</span>
        <div className="dshrm-tabs" role="tablist" aria-label={t('tablist.status')}>
        {statusTabs.map(([key, label]) => (
          <button
            key={key}
            id={tabId('status', key)}
            type="button"
            role="tab"
            aria-selected={status === key}
            aria-controls={PANEL_BODY_ID}
            tabIndex={status === key ? 0 : -1}
            className={'dshrm-tab' + (status === key ? ' on' : '')}
            onClick={() => setStatus(key)}
            onKeyDown={onTabKey(statusTabs.map(([tabKey]) => tabKey), status, setStatus)}
          >{label}</button>
        ))}
        </div>
      </div>

      <div className="dshrm-filters">
        <label className="dshrm-field">
          <span className="dshrm-field-l">{t('filter.source')}</span>
          <select
            className="dshrm-select"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.currentTarget.value)}
          >
            <option value="all">{format(t('filter.allSources'), { n: inScope.length })}</option>
            {/* Selected by clicking the diagnostics number; kept in the dropdown so
                the state is visible and can be left again. */}
            {diagnostics > 0 || diagOnly
              ? <option value="diag">{format(t('filter.diagnostics'), { n: diagnostics })}</option>
              : null}
            {sourceChoices.map((choice) => {
              const label = scopedSources.find((entry) => sourceId(entry) === choice)?.label ?? choice
              const n = inScope.filter((rule) => ruleSourceId(rule) === choice).length
              return <option key={choice} value={choice}>{label + ' (' + n + ')'}</option>
            })}
          </select>
        </label>
        <label className="dshrm-field">
          <span className="dshrm-field-l">{t('filter.search')}</span>
          <input
            className="dshrm-search"
            value={query}
            placeholder={t('search')}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        {/* A workspace only ever changes where the *project* tier is scanned
            from. In the global tier it is pure noise, and noise that contradicts
            the tab above it: the dropdown was offered while the list was showing
            user-level rules only. */}
        {onSelectWorkspace !== undefined && workspaceOptions.length > 0 && scope !== 'user'
          ? (
            <label className="dshrm-field">
              <span className="dshrm-field-l">{t('filter.workspace')}</span>
              <select
                className="dshrm-select"
                value={workspace.path ?? ''}
                title={t('selectWorkspace')}
                onChange={(event) => onSelectWorkspace(event.currentTarget.value)}
              >
                {workspace.path !== null ? <option value={workspace.path}>{workspace.path}</option> : null}
                {workspaceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          )
          : null}
      </div>

      {/* A walk that hit one of its caps still lists real rules — it just may
          not list all of them. Saying so above the list is the only place the
          user can learn it: a directory that was skipped leaves no row behind. */}
      {truncated || scanDiagnostics.length > 0
        ? (
          <p className="dshrm-note dshrm-scan-note" role="status">
            {truncated ? t('scanTruncated') + ' ' : ''}
            {scanDiagnostics.length > 0 ? format(t('scanDiagnostics'), { n: scanDiagnostics.length }) : ''}
          </p>
        )
        : null}

      {/* The note above says how many; it cannot say what. Each finding keeps
          its code, its line, the file it came from and the meaning of the code —
          the four things a count alone withholds. */}
      {scanDiagnostics.length > 0
        ? (
          <details className="dshrm-diag dshrm-scan-diag" open={scanDiagOpen} onToggle={(event) => setScanDiagOpen(event.currentTarget.open)}>
            <summary>{format(t('rowDiagnostics'), { n: scanDiagnostics.length })}</summary>
            <ul className="dshrm-diag-list">
              {scanDiagnostics.map((d, index) => (
                <ScanDiagnosticRow key={d.code + '-' + index} row={d} t={t} />
              ))}
            </ul>
          </details>
        )
        : null}

      {!hasAnyRule
        ? (
          <p className="dshrm-empty dshrm-full" role="tabpanel" id={PANEL_BODY_ID} aria-labelledby={panelLabel}>
            {workspace.source === 'none' ? t('noWorkspace') : t('empty')}
            {workspace.path !== null ? <span className="dshrm-group-path">{workspace.path}</span> : null}
          </p>
        )
        : inScope.length === 0
          ? <p className="dshrm-empty dshrm-full" role="tabpanel" id={PANEL_BODY_ID} aria-labelledby={panelLabel}>{t('tierEmpty')}</p>
          : bySource.length === 0
            ? <p className="dshrm-empty dshrm-full" role="tabpanel" id={PANEL_BODY_ID} aria-labelledby={panelLabel}>{t('noMatch')}</p>
          : (
            <div className="dshrm-groups" role="tabpanel" id={PANEL_BODY_ID} aria-labelledby={panelLabel}>
              {groups.map((group) => (
                <section key={group.key} className="dshrm-group">
                  <header className="dshrm-group-head">
                    <button
                      type="button"
                      className="dshrm-fold"
                      aria-expanded={!collapsed.includes(group.key)}
                      onClick={() => toggleCollapse(group.key)}
                    >
                      <span className="dshrm-caret">{collapsed.includes(group.key) ? '\u25B6' : '\u25BC'}</span>
                      <SourceBadge group={group} />
                      <span className="dshrm-group-label">{group.label}</span>
                      <span className="dshrm-scope-tag">{t('scope.' + group.scope)}</span>
                      <span className="dshrm-group-count">
                        {format(t('groupCount'), { total: group.rules.length })}
                      </span>
                    </button>
                    {/* A row of identical unlabelled checkboxes: each one needs
                        its own name, or a screen reader announces "checkbox"
                        once per source with no way to tell them apart. */}
                    <label className="dshrm-switch" title={t('toggleSource')}>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-checked={group.enabled}
                        aria-label={format(t('switchSource'), { name: group.label })}
                        checked={group.enabled}
                        disabled={pending.includes(group.key)}
                        onChange={(event) => onToggleSource(group, event.currentTarget.checked)}
                      />
                      <span className="dshrm-track" />
                    </label>
                  </header>
                  {group.path !== ''
                    ? <p className="dshrm-group-path" title={group.path}>{group.path}</p>
                    : null}
                  {collapsed.includes(group.key) ? null : group.rules.length === 0 ? (
                    <p className="dshrm-empty dshrm-full">{t('groupEmpty')}</p>
                  ) : (
                    <ul className="dshrm-list">
                      {group.rules.map((rule) => (
                        <RuleItem
                          key={rule.path}
                          rule={rule}
                          t={t}
                          busy={pending.includes(rule.path)}
                          onToggle={onToggleRule}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
    </div>
  )
}

/**
 * The plain-language meaning of one diagnostic code, or null when the table has
 * none.
 *
 * The table is keyed by the codes the scanner actually emits, so this reads
 * through `t` and treats "the key came back unchanged" as "no explanation for
 * this code" — a code added on the host side degrades to the bare diagnostic
 * instead of printing a locale key at the user.
 */
function diagHelp(t: (key: string) => string, code: string): string | null {
  const key = 'diag.' + code
  const text = t(key)
  return text === key ? null : text
}

/**
 * One scan-level finding: what the scanner said, where it said it, and what the
 * code means.
 *
 * These used to be flattened into a single sentence of explanations joined by
 * semicolons, which lost the one thing the scanner had already worked out — the
 * field, the line, the file. "the field was declared but has no entries" is
 * meaningless without the field's name.
 *
 * The path is printed only when the detail does not already carry it: the codes
 * raised per file end their detail with the path, and printing it twice would
 * read as two findings.
 */
export function ScanDiagnosticRow({ row, t }: {
  row: RuleDiagnosticRow
  t: (key: string) => string
}) {
  const help = diagHelp(t, row.code)
  const path = row.path !== undefined && !row.detail.includes(row.path) ? row.path : undefined
  return (
    <li>
      <span className="dshrm-diag-code">{row.code}</span>
      {row.line === undefined ? null : <span className="dshrm-diag-line">{format(t('diagLine'), { line: row.line })}</span>}
      {': ' + row.detail}
      {path === undefined ? null : <span className="dshrm-diag-path">{format(t('diagPath'), { path })}</span>}
      {help === null ? null : <span className="dshrm-diag-help">{help}</span>}
    </li>
  )
}

/** One rule row: name, badges, two-line description, reason, and its switch. */
export function RuleItem({ rule, t, busy, onToggle, openDiagnostics, onToggleDiagnostics }: {
  rule: RuleRow
  t: (key: string) => string
  busy: boolean
  onToggle: (rule: RuleRow, enabled: boolean) => void
  /** Controlled fold state; omit to let the row own it. */
  openDiagnostics?: boolean
  onToggleDiagnostics?: (open: boolean) => void
}) {
  const bucket = statusOf(rule)
  const cost = ruleCost(rule)
  const reason = disabledReasonKey(rule)
  const note = t(noteKeyOf(rule))
  // The row owns the fold state unless a caller supplies one, so the static
  // markup tests and a consumer that wants the fold open both work.
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openDiagnostics ?? ownOpen
  const setOpen = openDiagnostics === undefined ? setOwnOpen : onToggleDiagnostics ?? (() => {})
  return (
    <li className={'dshrm-row dshrm-' + bucket} data-rule={rule.path}>
      <div className="dshrm-row-main">
        <div className="dshrm-row-top">
          <span className="dshrm-name" title={rule.path}>{rule.name}</span>
          {/* The tag still names the file's own state ("on demand"); the extra
              class and title say why it is resident in this session anyway. */}
          <span
            className={'dshrm-type' + (rule.attached === true ? ' is-attached' : '')}
            title={rule.attached === true ? t('note.attached') : undefined}
          >
            {t('type.' + rule.type)}
          </span>
          <span className="dshrm-tokens">{format(t('tokens'), { n: cost.resident })}</span>
        </div>
        {rule.description !== ''
          ? <p className="dshrm-desc">{rule.description}</p>
          : null}
        <span className="dshrm-row-note">
          {reason === null ? note : format(t('offWith'), { reason: t(reason) })}
        </span>
        {/* The stat bar counts diagnostics; without this the number had no outlet.
            A fold rather than a tooltip: the text has to be readable and
            selectable, and a native title is neither of those on a touch screen. */}
        {rule.diagnostics.length > 0
          ? (
            <details className="dshrm-diag" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
              <summary>{format(t('rowDiagnostics'), { n: rule.diagnostics.length })}</summary>
              <ul className="dshrm-diag-list">
                {rule.diagnostics.map((d, index) => {
                  const help = diagHelp(t, d.code)
                  return (
                    <li key={d.code + '-' + index}>
                      <span className="dshrm-diag-code">{d.code}</span>
                      {d.line === undefined ? null : <span className="dshrm-diag-line">{format(t('diagLine'), { line: d.line })}</span>}
                      {': ' + d.detail}
                      {help === null ? null : <span className="dshrm-diag-help">{help}</span>}
                    </li>
                  )
                })}
              </ul>
            </details>
          )
          : null}
      </div>
      {/* The name carries the tier as well: the same rule can exist in both,
          and "a" twice over is exactly the ambiguity this is here to remove. */}
      <label className="dshrm-switch" title={t('toggleRule')}>
        <input
          type="checkbox"
          role="switch"
          aria-checked={rule.active}
          aria-label={format(t('switchRule'), { name: rule.name, scope: t('scope.' + rule.scope) })}
          checked={rule.active}
          disabled={busy || rule.disabledBy === 'frontmatter' || rule.disabledBy === 'source'}
          onChange={(event) => onToggle(rule, event.currentTarget.checked)}
        />
        <span className="dshrm-track" />
      </label>
    </li>
  )
}

/**
 * Carry the workspace the panel is looking at on the route itself.
 *
 * `route` already owns its query string (`RULES_ROUTE` has none today, but a
 * caller may pass one), so the parameter is appended with `&` when needed
 * rather than blindly with `?`.
 */
export function withWorkspace(route: string, workspace: string | null): string {
  if (workspace === null || workspace === '') return route
  const separator = route.includes('?') ? '&' : '?'
  return route + separator + 'workspace=' + encodeURIComponent(workspace)
}

/**
 * Ask the host to ignore its caches for one read.
 *
 * A repeated read is deliberately cheap — the host answers it from a 30-second
 * slot — which makes the Refresh button look broken: the timestamp it prints
 * does not move. The parameter is what makes the button mean what it says.
 */
export function withRefresh(route: string): string {
  const separator = route.includes('?') ? '&' : '?'
  return route + separator + 'refresh=1'
}

/**
 * Read the host's catalog. Throws on a failed request or a malformed body.
 *
 * Only `rules` is required: `sources`/`scannedAt` arrived later, and a host
 * built before them must still render its list rather than fail outright.
 */
export async function fetchRules(
  route: string = RULES_ROUTE,
  doFetch: typeof fetch | undefined = globalThis.fetch,
  workspacePath: string | null = null,
  refresh = false,
): Promise<RulesPayload> {
  if (typeof doFetch !== 'function') throw new Error('no fetch in this environment')
  const target = withWorkspace(route, workspacePath)
  const response = await doFetch(resolveUrl(refresh ? withRefresh(target) : target), { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`rules request failed: ${response.status}`)
  const body: unknown = await response.json()
  // The host is a different process boundary, so the shape is checked rather
  // than trusted; a bad payload must not render as a half-populated list.
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { rules?: unknown }).rules)) {
    throw new Error('rules response is not a list')
  }
  const payload = body as Partial<RulesPayload>
  return {
    rules: payload.rules ?? [],
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    scannedAt: typeof payload.scannedAt === 'number' ? payload.scannedAt : 0,
    // A host built before these fields sends neither, which reads as "the walk
    // was whole" — the same thing its silence used to mean.
    diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
    truncated: payload.truncated === true,
    workspace: payload.workspace ?? { path: null, source: 'none' },
  }
}

/** Send one write to the host and return the refreshed document. */
export async function postAction(
  action: RulesAction,
  route: string = RULES_ROUTE,
  doFetch: typeof fetch | undefined = globalThis.fetch,
  workspacePath: string | null = null,
): Promise<RulesPayload> {
  if (typeof doFetch !== 'function') throw new Error('no fetch in this environment')
  const response = await doFetch(resolveUrl(withWorkspace(route, workspacePath)), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  })
  if (!response.ok) throw new Error(`rules update failed: ${response.status}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { rules?: unknown }).rules)) {
    throw new Error('rules response is not a list')
  }
  const payload = body as Partial<RulesPayload>
  return {
    rules: payload.rules ?? [],
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    scannedAt: typeof payload.scannedAt === 'number' ? payload.scannedAt : 0,
    diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
    truncated: payload.truncated === true,
    workspace: payload.workspace ?? { path: null, source: 'none' },
  }
}

/**
 * Panel state: the catalog, how the read went, and the two write actions.
 *
 * A write is **optimistic then reconciled**: the row flips immediately so the
 * checkbox does not lag, the host's response replaces the payload, and a
 * failure rolls the flip back and surfaces the error. Nothing is left showing a
 * state the host did not confirm.
 */
export function useRules(route: string = RULES_ROUTE) {
  const [payload, setPayload] = useState<RulesPayload>({ rules: [], sources: [], scannedAt: 0, diagnostics: [], truncated: false, workspace: { path: null, source: 'none' } })
  // Which directory the panel is showing. null is the host's own choice, which
  // is also what a panel that never had a choice keeps sending.
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [nonce, setNonce] = useState(0)
  const [pending, setPending] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // A refresh is an ascending tick plus the tick the last read served. The
  // effect can only tell the two apart after the read settles: comparing them
  // anywhere earlier made a StrictMode double-invoke mark its own second run as
  // satisfied, and the forced flag then never reached the request.
  const [refreshTick, setRefreshTick] = useState(0)
  const servedRefresh = useRef(0)

  const EMPTY: RulesPayload = { rules: [], sources: [], scannedAt: 0, diagnostics: [], truncated: false, workspace: { path: null, source: 'none' } }

  useEffect(() => {
    let cancelled = false
    const tick = refreshTick
    const forced = isForcedRead(tick, servedRefresh.current)
    // A forced read must not blank the panel: it already has rows, and swapping
    // them for the loading state is what made a refresh look like a reload.
    if (!forced) setState('loading')
    setRefreshing(forced)
    fetchRules(route, undefined, workspacePath, forced)
      .then((next) => { if (!cancelled) { setPayload(next); setState('ready') } })
      .catch(() => { if (!cancelled) { setPayload(EMPTY); setState('failed') } })
      .finally(() => {
        if (cancelled) return
        // Only the read that answered this tick may retire it, so two clicks in
        // a row stay two forced reads and neither blanks the list.
        servedRefresh.current = tick
        setRefreshing(false)
      })
    return () => { cancelled = true }
  }, [route, nonce, workspacePath, refreshTick])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  /**
   * The Refresh button: read again, past the host's caches.
   *
   * The tick only moves here; the effect decides whether the read it starts is
   * a forced one, and retires the tick from the read's own finally.
   */
  const refresh = useCallback(() => {
    setRefreshTick((n) => n + 1)
  }, [])

  // The callbacks below need the latest payload without re-creating themselves
  // on every read; a ref keeps 'send' stable for the memoized rows. Declared
  // before 'send' so the ref exists for the whole life of the callback.
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  // A write that settles after the panel is gone must not touch its state: the
  // payload is discarded anyway. Reset on mount so a StrictMode remount - whose
  // cleanup runs before the effect runs again - cannot leave it false.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  /** Send one action, then reconcile or roll back. */
  const send = useCallback(async (action: RulesAction, toggling: string) => {
    const before = payloadRef.current
    setPending((current) => [...current, toggling])
    setError(null)
    setPayload(optimistic(before, action))
    try {
      const next = await postAction(action, route, undefined, workspacePath)
      if (!alive.current) return
      setPayload(next)
    } catch (cause) {
      if (!alive.current) return
      // Roll back to exactly what the host last confirmed.
      setPayload(before)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setPending((current) => current.filter((key) => key !== toggling))
    }
  }, [route, workspacePath])

  const toggleRule = useCallback((rule: RuleRow, enabled: boolean) => {
    // The tier travels with the write, so a row in one tier cannot flip the
    // same-named rule in the other.
    void send({ action: 'setRule', key: rule.sourceKey, path: rule.path, enabled, scope: rule.scope }, rule.path)
  }, [send])

  const toggleSource = useCallback((group: SourceGroup, enabled: boolean) => {
    void send({ action: 'setSource', key: sourceKeyOf(group.key), enabled, scope: group.scope }, group.key)
  }, [send])

  const selectWorkspace = useCallback((path: string) => { setWorkspacePath(path) }, [])

  return {
    rules: payload.rules, sources: payload.sources, scannedAt: payload.scannedAt,
    scanDiagnostics: payload.diagnostics ?? [], truncated: payload.truncated === true,
    workspace: payload.workspace,
    state, retry, refresh, refreshing, setPayload, pending, error, toggleRule, toggleSource,
    selectedWorkspace: workspacePath, selectWorkspace,
  }
}



function ListIcon({ size }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size ?? 16} height={size ?? 16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  )
}

/**
 * Register every entry point.
 *
 * Returns a disposer that removes all of them. Each \`inject\` callback hands
 * back the disposal function it received from \`register\`, so unloading the
 * plugin leaves no stale slot.
 */
export function register(ctx: Context, t: (key: string) => string): () => void {
  // Styles ride the first registration rather than a module side effect, so a
  // bundle that is loaded but never registered leaves no stray <style> behind.
  installPanelStyles()

  const disposers: Array<() => void> = []
  // One disposer per slot: `inject` re-runs its callback when its service
  // changes, and a second disposer for the same slot would be called twice.
  const kept = new Set<string>()
  const panel = () => {
    const {
      rules, sources, workspace, scannedAt, state, retry, refresh, refreshing, pending, error,
      toggleRule, toggleSource, selectedWorkspace, selectWorkspace, scanDiagnostics, truncated,
    } = useRules()
    return (
      <RulesPanel
        ctx={ctx}
        t={t}
        rules={rules}
        sources={sources}
        workspace={workspace}
        scannedAt={scannedAt}
        selectedWorkspace={selectedWorkspace}
        onSelectWorkspace={selectWorkspace}
        state={state}
        onRetry={retry}
        refreshing={refreshing}
        onRefresh={refresh}
        scanDiagnostics={scanDiagnostics}
        truncated={truncated}
        onToggleRule={toggleRule}
        onToggleSource={toggleSource}
        pending={pending}
        error={error}
      />
    )
  }

  const keep = (slot: string, result: unknown): void => {
    if (kept.has(slot)) return
    kept.add(slot)
    if (typeof result === 'function') disposers.push(result as () => void)
  }

  // The section and its icon share one id; a mismatch means no icon renders.
  ctx.slots.inject('settings.section', () =>
    keep('settings.section', ctx.slots.register(
      { name: 'settings.section', id: SECTION_ID, order: 30, label: () => t('title'), locale: NS },
      panel,
    )))
  ctx.slots.inject('settings.section.icon', () =>
    keep('settings.section.icon', ctx.slots.register(
      { name: 'settings.section.icon', id: SECTION_ID, locale: NS },
      ListIcon,
    )))
  ctx.slots.inject('sidebar.panellist', () =>
    keep('sidebar.panellist', ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 3, label: () => t('panel'), locale: NS },
      ListIcon,
    )))
  // Clicking the sidebar entry opens this panel: \`key\` must equal the
  // \`sidebar.panellist\` id or the click has nothing to render. The host's own
  // plugin manager pairs them the same way (\`main\` key \`plugins\` /
  // \`sidebar.panellist\` id \`plugins\`).
  ctx.slots.inject('main', () =>
    keep('main', ctx.slots.register(
      { name: 'main', key: PANEL_ID, locale: NS },
      panel,
    )))

  return () => { for (const dispose of disposers) dispose() }
}

/** Panel strings; the locale files carry only the plugin's catalog metadata. */
export const TEXT: Record<'en' | 'zh', Record<string, string>> = {
  en: {
    title: 'Rules',
    panel: 'Rules',
    search: 'Search rules by name or description',
    tokens: '≈{n} tokens',
    empty: 'No rules found for this workspace.',
    subtitle: 'Rules from 22 conventions on disk (CodeBuddy, Cursor, Claude Code, Trae, Qoder and more) — always-on, on demand, or disabled. Read-only: this panel only writes its own settings.',
    'stat.total': 'rules',
    'stat.enabled': 'active',
    'stat.disabled': 'disabled',
    'stat.diagnostics': 'diagnostics',
    'costValue': '≈{n}',
    'costLabel': 'tokens resident in every request',
  'costDetails': 'Details',
  'close': 'Close',
  'costRule': 'Rule',
  'costState': 'Loading',
  'costResident': 'Resident',
  'costOnDemand': 'On demand',
  'costTotal': '{n} rules',
  'costCatalog': 'On-demand index overhead',
  'costCatalogNote': 'The tags and instructions that wrap the on-demand lines — not a rule; resident whenever any rule is on demand',
  'costTruncated': '{n} rule(s) clipped by the 8000-character cap',
  'costOmitted': '{n} rule(s) dropped by a tier budget (6000 user / 12000 project)',
  // The panel above lists every finding with its file and its line; this table
  // only has to say that the same findings are counted here too.
  'costScanNote': 'The scan also reported {n} problem(s), itemised below:',
  // The injection model, stated once and correctly: an always-on rule injects
  // its body and nothing else, an on-demand rule injects one index line, and a
  // manual rule is not injected by any path at all.
  'costHint': "Always-on rules put their body in the prompt on every request; their description is not injected. On-demand rules keep one index line - path and description - in the prompt, and the body is passed in only when the model actually reads the rule. Manual rules are never injected by any path at all. The row above the total is the wrapper that text sits in, which is why it belongs to no single rule.",
  'scanTruncated': 'The scan stopped at one of its caps, so rules may be missing from this list.',
  'scanDiagnostics': '{n} scan problem(s), which belong to no single rule:',
  'tierEmpty': 'No rule of this catalog is in this scope.',
  'switchSource': 'Turn {name} rules on or off (writes state.json only)',
  'switchRule': 'Turn {name} on or off in {scope} (writes state.json only)',
    'filter.source': 'Source',
    'filter.allSources': 'All sources ({n})',
    'filter.diagnostics': 'Rules with diagnostics ({n})',
    'filter.workspace': 'Workspace',
    'selectWorkspace': 'Workspace shown by this panel',
    'statDiagnosticsHint': 'Show only the rules with diagnostics',
    // The panel shows a diagnostic's code and its line; these two say what the
    // code means, which is the part a bare code never conveyed.
    'diagLine': 'line {line}',
    'diagPath': 'in {path}',
    'diag.fm.malformed': 'not a key: value line, so it was ignored',
    'diag.fm.emptyList': 'the field was declared but has no entries',
    'diag.list.empty': 'declared as an empty list, so the rule matches no file',
    'diag.trigger.missing': 'this convention requires a trigger field',
    'diag.trigger.unknown': 'unrecognised trigger, handled by the fallback rule',
    'diag.type.unknown': 'unrecognised type, handled by the fallback rule',
    'diag.type.tierOverridden': 'this convention keeps user-level rules always on, so the file state is ignored',
    'diag.requested.noDescription': 'an on-demand rule is only discoverable through its description',
    'diag.scan.truncated': 'the depth or entry limit was reached; some rules may be missing',
    'diag.scan.unreadable': 'the directory could not be read, so it was skipped',
    'diag.read.failed': 'the file could not be read, so it was skipped',
    'diag.classify.skipped': 'not recognised as a rule file, so it was skipped',
    // src/attach.ts: file-scoped attachment of on-demand rules.
    'diag.attach.limit': 'more file-scoped rules declared patterns than can be compiled at once; the rest stay on demand',
    'diag.attach.pattern': 'this pattern was skipped as too risky to match against',
    'diag.attach.slow': 'the pattern exceeded the match time budget, so the rule stays on demand',
    'filter.search': 'Search',
    // The scan only creates a card for a directory it resolved, so "does not
    // exist" was never the reason this line appeared: the card is here because
    // the directory *does* exist and holds nothing (or nothing matching).
    'groupEmpty': 'This source directory exists, but has no rules yet.',
    noWorkspace: 'No workspace could be determined yet, so there is nothing to scan. Open a folder, or send one message, then reload.',
    loading: 'Loading rules…',
    loadFailed: 'Could not load rules from the host.',
    retry: 'Retry',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    'scannedAt': 'Scanned {time}',
    'rowDiagnostics': '{n} diagnostics',
    'type.always': 'always',
    'type.requested': 'on demand',
    'type.manual': 'not injected',
      'scope.user': 'Global',
    'scope.project': 'Project',
    'tablist.scope': 'Scope',
    'tablist.status': 'Status',
    'tab.all': 'All ({n})',
    'tab.always': 'Always ({n})',
    'tab.requested': 'On demand ({n})',
    'tab.manual': 'Not injected ({n})',
    'tab.off': 'Disabled ({n})',
    'groupCount': '{total} rules',
    'toggleSource': 'Turn this source on or off (writes state.json only)',
    'toggleRule': 'Turn this rule on or off (writes state.json only)',
    'tokenNote': 'Always-on rules keep their whole text in the prompt; on-demand rules keep only their description line, and the body loads when the model asks; manual rules are never injected at all.',
    'noMatch': 'No rule matches the current filters.',
    'writeFailed': 'Could not save: {message}',
    'offWith': 'Disabled — {reason}',
    'offReason.frontmatter': 'in the file (enabled: false)',
    'offReason.state': 'turned off here',
    'offReason.source': 'its source is off',
    'note.always': 'Full text resident',
    'note.requested': 'Description resident; body loads on demand',
    'note.manual': 'Never injected',
    'note.off': 'Disabled',
    // The fourth reason a body can be in the prompt, and the only one that is a
    // fact about this session rather than about the file.
    'note.attached': 'Body resident - this session touched a matching file',
  },
  zh: {
    title: '规则',
    panel: '规则',
    search: '按名称或描述搜索规则',
    tokens: '≈{n} token',
    empty: '当前工作区没有规则。',
    subtitle: '汇集磁盘上 22 种约定的规则（CodeBuddy、Cursor、Claude Code、Trae、Qoder 等），支持全文常驻 / 按需加载 / 停用。只读：本面板只写自己的设置。',
    'stat.total': '条规则',
    'stat.enabled': '生效中',
    // Matches the panel's other states: a diagnostic is a hint about a file,
    // not a failure of the catalog.
    'stat.disabled': '已停用',
    'stat.diagnostics': '诊断提示',
    'costValue': '≈{n}',
    'costLabel': '每次请求常驻的 token 约数',
  'costDetails': '详情',
  'close': '关闭',
  'costRule': '规则',
  'costState': '加载方式',
  'costResident': '常驻',
  'costOnDemand': '按需',
  'costTotal': '共 {n} 条',
  'costCatalog': '按需清单的固定开销',
  'costCatalogNote': '包裹按需索引行的标签与说明文字，不属于任何规则；只要存在按需规则就会常驻',
  'costTruncated': '有 {n} 条正文超过 8000 字符上限，已截断后计费',
  'costOmitted': '有 {n} 条因档位预算（全局 6000 / 项目 12000 字符）被整条丢弃',
  // 上面的面板会逐条列出每条问题的文件与行号，这里只需说明同一批问题在此处也计入了。
  'costScanNote': '扫描另有 {n} 条问题，明细如下：',
  // 注入模型只说一次、说对：全文常驻只注入正文，按需加载注入一行索引，
  // 不注入类没有任何路径会把它放进提示词。
  'costHint': '全文常驻类：每次请求都把正文放进提示词，描述不注入。按需加载类：只有一行索引（路径 + 描述）常驻，正文在模型真正读取这条规则时才传入。不注入类：任何路径都不会把它放进提示词。合计上方那一行就是包住这些索引行的固定文字，所以它不属于任何单条规则。',
  'scanTruncated': '扫描已达上限而中止，列表里可能缺规则。',
  'scanDiagnostics': '扫描发现 {n} 个问题，它们不属于任何单条规则：',
  'tierEmpty': '本档位没有规则。',
  'switchSource': '开关 {name} 来源的规则（只写 state.json）',
  'switchRule': '开关 {name}（{scope}，只写 state.json）',
    'filter.source': '来源',
    'filter.allSources': '全部来源（{n}）',
    'filter.diagnostics': '有诊断的规则（{n}）',
    'filter.workspace': '工作区',
    'selectWorkspace': '本面板展示的工作区',
    'statDiagnosticsHint': '只看有诊断的规则',
    // 诊断原本只有代码与详情两段，看不懂。行号说明它在文件里的位置，
    // 解释一句说明它意味着什么、要不要处理。
    'diagLine': '第 {line} 行',
    'diagPath': '位于 {path}',
    'diag.fm.malformed': '不是 key: value 形式，已忽略该行',
    'diag.fm.emptyList': '字段已声明但没有填任何值',
    'diag.list.empty': '声明为空列表，任何文件都匹配不到',
    'diag.trigger.missing': '该约定要求提供 trigger 字段',
    'diag.trigger.unknown': 'trigger 取值不认识，已按推导规则处理',
    'diag.type.unknown': 'type 取值不认识，已按推导规则处理',
    'diag.type.tierOverridden': '该约定的用户级规则一律常驻，文件里写的状态会被忽略',
    'diag.requested.noDescription': '按需加载类只靠描述被发现，缺描述等于找不到',
    'diag.scan.truncated': '已达深度或条目上限，可能有规则没扫到',
    'diag.scan.unreadable': '该目录读不了，已跳过',
    'diag.read.failed': '该文件读不了，已跳过',
    'diag.classify.skipped': '不是可识别的规则文件，已跳过',
    // src/attach.ts：按文件自动附着。
    'diag.attach.limit': '声明匹配式的按需规则超出一次可编译的上限，其余仍按需加载',
    'diag.attach.pattern': '该匹配式回溯风险过高，已跳过',
    'diag.attach.slow': '匹配式超出耗时预算，该规则仍按需加载',
    'filter.search': '搜索',
    'groupEmpty': '该来源目录存在，但里面还没有规则。',
    noWorkspace: '尚未能确定工作区，因此无处可扫。请先打开一个目录，或发一条消息，然后重新加载。',
    loading: '正在加载规则…',
    loadFailed: '无法从宿主加载规则。',
    retry: '重试',
    refresh: '刷新',
    refreshing: '刷新中…',
    'scannedAt': '扫描于 {time}',
    'rowDiagnostics': '{n} 条诊断',
    'type.always': '全文常驻',
    'type.requested': '按需加载',
    'type.manual': '不注入',
      'scope.user': '全局',
    'scope.project': '项目',
    'tablist.scope': '范围',
    'tablist.status': '状态',
    'tab.all': '全部（{n}）',
    'tab.always': '全文常驻（{n}）',
    'tab.requested': '按需加载（{n}）',
    'tab.manual': '不注入（{n}）',
    'tab.off': '已停用（{n}）',
    'groupCount': '{total} 条',
    'toggleSource': '开关该来源（只写 state.json）',
    'toggleRule': '开关该规则（只写 state.json）',
    'tokenNote': '全文常驻类的规则正文整体进入提示词；按需加载类只有描述一行常驻，正文在模型调用时才加载；不注入类从不进入提示词。',
    'noMatch': '当前筛选条件下没有匹配的规则。',
    'writeFailed': '保存失败：{message}',
    'offWith': '已停用 —— {reason}',
    'offReason.frontmatter': '文件里写了 enabled: false',
    'offReason.state': '在此处关闭',
    'offReason.source': '其来源已关闭',
    'note.always': '全文常驻',
    'note.requested': '仅描述常驻，正文按需加载',
    'note.manual': '从不注入',
    'note.off': '已停用',
    'note.attached': '正文常驻 - 本会话已触碰匹配的文件',
  },
}

/**
 * The plugin object the loader mounts.
 *
 * \`inject\` names only the hard dependency. A locale service, when present,
 * supplies the panel catalog; otherwise the bundled {@link TEXT} is used.
 */
export const inject = ['slots']

export function apply(ctx: Context): () => void {
  const locale = localeOf(ctx)
  // The official pattern (dsh-client-ui-sidebar does the same): publish the
  // dictionaries once, under the namespace the slot definitions already name.
  // `register` throws on a duplicate (ns, locale), so this runs once per mount.
  if (typeof locale?.register === 'function' && typeof ctx.effect === 'function') {
    ctx.effect(() => locale.register?.(NS, { en: TEXT.en, zh: TEXT.zh }), 'rules-manager: locale dictionaries')
  }
  return register(ctx, (key) => resolveText(ctx, key))
}

/**
 * The locale service, as this plugin uses it.
 *
 * Read structurally rather than imported: `@deepseek-ai/dsh-client-locale` is a
 * host peer. The members are the real ones —
 * `dsh-client-locale/src/client/index.ts` declares
 * `getSnapshot(): LocaleSnapshot` where `LocaleSnapshot.active` is the locale id,
 * `register(ns, dicts): () => void`, and `bind(ns): Translate`.
 *
 * There is **no** `current` member; an earlier version of this file read one and
 * so always reported English.
 */
interface LocaleLike {
  register?(ns: string, dicts: Record<string, Record<string, string>>): unknown
  bind?(ns: string): (key: string) => string
  getSnapshot?(): { active?: string }
}

/** The locale service when one is loaded, else undefined. */
function localeOf(ctx: Context): LocaleLike | undefined {
  const locale = ctx.get?.('locale') as LocaleLike | undefined
  return locale !== undefined && locale !== null && typeof locale === 'object' ? locale : undefined
}

/**
 * Panel text.
 *
 * Preferred path: the text goes through the host's own translator, so it follows
 * the active locale exactly as every other plugin's copy does. The dictionary is
 * registered into {@link NS} by {@link apply}; `bind` returns a function that
 * reads the active locale at call time, so no snapshot needs to be watched here.
 *
 * Fallback path (no locale service, or an unexpected shape): the bundled table,
 * keyed by `LocaleSnapshot.active`. The service is optional, so a missing or
 * partially-shaped one must degrade to English rather than throw.
 */
export function resolveText(ctx: Context, key: string): string {
  const locale = localeOf(ctx)
  if (typeof locale?.bind === 'function') {
    try {
      const bound = locale.bind(NS)(key)
      // The host translator answers with the key itself when it misses (see
      // LocaleRuntime.translate: namespace, then the shared vocabulary, then
      // the key). Only a real answer may shadow the bundled table.
      if (typeof bound === 'string' && bound !== '' && bound !== key) return bound
    } catch {
      // An unexpected service shape falls through to the bundled table.
    }
  }
  const active = locale?.getSnapshot?.()?.active
  // The host reports ids like `zh-CN` / `zh-Hans`, so an exact match on `zh`
  // sent every Chinese locale to the English table.
  const lang = typeof active === 'string' && active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return TEXT[lang][key] ?? TEXT.en[key] ?? key
}

/** Declare the slots this plugin contributes and its locale namespace. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.section': { kind: 'list'; scope: 'root'; owner: unknown }
    'settings.section.icon': { kind: 'list'; scope: 'root'; inline: true; owner: unknown }
    'sidebar.panellist': { kind: 'list'; scope: 'root'; owner: unknown }
    'main': { kind: 'keyed'; scope: 'root' }
  }
  interface LocaleNamespaceMap {
    dshRulesManager: string
  }
}

/**
 * The \`slots\` service is provided by the host at runtime and typed by the
 * slots package's own service registration, which a plugin declares here the
 * same way a working local plugin declares it. \`get\` is cordis's own
 * optional-service probe.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly slots: {
      register(definition: Record<string, unknown>, component: unknown): unknown
      inject(name: string, callback: () => void): void
    }
    get(name: string): unknown
    /** Registers a disposer tied to this plugin's lifetime. */
    effect(callback: () => unknown, label?: string): void
  }
}
