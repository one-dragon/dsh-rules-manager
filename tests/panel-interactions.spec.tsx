/**
 * Panel interactions: the handlers, folds and effects that only run when a user
 * acts on the panel, plus the write path's optimistic flip and its rollback.
 *
 * The workspace ships no DOM library, so no real event can be dispatched and
 * `react-dom/server` never runs an effect. This file drives the components the
 * way React does instead: a minimal hook runtime is installed on React's own
 * dispatcher for the duration of one component call, the element tree that call
 * returns is walked, and the handler props are invoked with synthetic events
 * carrying the same `currentTarget` shape the source reads. Assertions are then
 * made against the tree the *next* render produces, so each one states what the
 * user sees after acting rather than that some callback was reached.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { RuleItem, RulesPanel, TokenBreakdown, register, resolveText, useRules, TEXT } from '../src/client/index.tsx'
import { groupBySource, optimistic } from '../src/client/group.ts'
import { installPanelStyles } from '../src/client/styles.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { RuleDiagnosticRow, RuleRow, RuleSourceRow, RulesPayload } from '../src/panel.ts'

const NOOP = () => {}
const t = (key: string): string => TEXT.zh[key] ?? TEXT.en[key] ?? key

// --- fixtures ---------------------------------------------------------------

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  path: '/p/codebuddy/a.mdc',
  name: 'a',
  type: 'always',
  description: 'd',
  descriptionTokens: 10,
  bodyTokens: 100,
  bodyLength: 100,
  enabled: true,
  active: true,
  disabledBy: null,
  sourceKey: 'codebuddy',
  sourceLabel: 'CodeBuddy',
  scope: 'project',
  family: 'codebuddy',
  patterns: [],
  attached: false,
  diagnostics: [],
  ...over,
})

const source = (over: Partial<RuleSourceRow> = {}): RuleSourceRow => ({
  key: 'codebuddy',
  label: 'CodeBuddy',
  scope: 'project',
  path: 'D:/repo/.codebuddy/rules',
  enabled: true,
  ruleCount: 1,
  activeRuleCount: 1,
  ...over,
})

const diag = (over: Partial<RuleDiagnosticRow> = {}): RuleDiagnosticRow => ({
  code: 'scan.truncated',
  detail: 'stopped early',
  kind: 'scan',
  ...over,
})

// --- hook runtime -----------------------------------------------------------

interface Slot {
  value: unknown
}

let slots: Array<Slot | undefined> = []
let cursor = 0
let recorded: Array<() => (() => void) | undefined> = []

const resolve = (next: unknown, previous: unknown): unknown =>
  typeof next === 'function' ? (next as (prev: unknown) => unknown)(previous) : next

// Effects and callbacks occupy a hook position but need no storage; padding the
// array keeps every later hook at the index it had on the first render.
const slotAt = (index: number): { slot: Slot; created: boolean } => {
  while (slots.length <= index) slots.push(undefined)
  const existing = slots[index]
  if (existing !== undefined) return { slot: existing, created: false }
  const created: Slot = { value: undefined }
  slots[index] = created
  return { slot: created, created: true }
}

const useStateHook = <T,>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] => {
  const index = cursor
  cursor += 1
  const { slot, created } = slotAt(index)
  if (created) slot.value = resolve(initial, undefined)
  const set = (next: unknown): void => { slot.value = resolve(next, slot.value) }
  return [slot.value as T, set as (next: T | ((prev: T) => T)) => void]
}

const useRefHook = <T,>(initial: T): { current: T } => {
  const index = cursor
  cursor += 1
  const { slot, created } = slotAt(index)
  if (created) slot.value = { current: initial }
  return slot.value as { current: T }
}

const useEffectHook = (run: () => (() => void) | undefined): void => {
  cursor += 1
  recorded.push(run)
}

const hooks = {
  useState: useStateHook,
  useRef: useRefHook,
  useEffect: useEffectHook,
  useLayoutEffect: useEffectHook,
  useCallback: (callback: unknown): unknown => { cursor += 1; return callback },
  useMemo: (factory: () => unknown): unknown => { cursor += 1; return factory() },
}

const internals = (React as unknown as {
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: { ReactCurrentDispatcher: { current: unknown } }
}).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

interface Rendered {
  readonly element: React.ReactElement
  readonly effects: ReadonlyArray<() => (() => void) | undefined>
}

/** Call one component the way React would, with the hook runtime in place. */
const renderComponent = <P,>(Component: (props: P) => React.ReactElement, props: P): Rendered => {
  cursor = 0
  recorded = []
  const dispatcher = internals.ReactCurrentDispatcher
  const previous = dispatcher.current
  dispatcher.current = hooks
  try {
    return { element: Component(props), effects: recorded }
  } finally {
    dispatcher.current = previous
  }
}

const runEffects = (effects: Rendered['effects']): Array<() => void> =>
  effects
    .map((effect) => effect())
    .filter((cleanup): cleanup is () => void => typeof cleanup === 'function')

// --- element tree walking ---------------------------------------------------

interface TreeNode {
  readonly type: unknown
  readonly props: Record<string, unknown>
}

const isTreeNode = (node: unknown): node is TreeNode =>
  typeof node === 'object' && node !== null && 'type' in node && 'props' in node

const walk = (node: unknown, visit: (element: TreeNode) => void): void => {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isTreeNode(node)) return
  visit(node)
  walk(node.props['children'], visit)
}

const findAll = (root: unknown, matches: (element: TreeNode) => boolean): TreeNode[] => {
  const found: TreeNode[] = []
  walk(root, (element) => { if (matches(element)) found.push(element) })
  return found
}

const find = (root: unknown, matches: (element: TreeNode) => boolean): TreeNode | undefined =>
  findAll(root, matches)[0]

const byClass = (className: string) => (element: TreeNode): boolean =>
  String(element.props['className'] ?? '').split(' ').includes(className)

const sourceSwitch = (root: unknown): TreeNode | undefined =>
  find(root, (element) => element.props['role'] === 'switch' && String(element.props['aria-label']).includes('来源'))

const markup = (element: React.ReactElement): string => renderToStaticMarkup(element)

/** Attach a stand-in node to every element ref, as React would on commit. */
const attachRefs = (root: unknown, node: { focus: () => void }): number => {
  let attached = 0
  walk(root, (element) => {
    const ref = (element as unknown as { ref?: unknown }).ref
    if (typeof ref === 'object' && ref !== null && 'current' in ref) {
      ;(ref as { current: unknown }).current = node
      attached += 1
    }
  })
  return attached
}

// --- synthetic events -------------------------------------------------------

const call = (handler: unknown, event: unknown): void => {
  if (typeof handler === 'function') (handler as (argument: unknown) => void)(event)
}

const fireClick = (element: TreeNode, extra: Record<string, unknown> = {}): void =>
  call(element.props['onClick'], { preventDefault: NOOP, stopPropagation: NOOP, ...extra })

const fireChange = (element: TreeNode, value: string): void =>
  call(element.props['onChange'], { currentTarget: { value }, preventDefault: NOOP })

const fireCheck = (element: TreeNode, checked: boolean): void =>
  call(element.props['onChange'], { currentTarget: { checked }, preventDefault: NOOP })

const fireToggle = (element: TreeNode, open: boolean): void =>
  call(element.props['onToggle'], { currentTarget: { open }, preventDefault: NOOP })

const fireKey = (element: TreeNode, key: string, parentElement: unknown = null): { prevented: boolean } => {
  const state = { prevented: false }
  call(element.props['onKeyDown'], {
    key,
    currentTarget: { parentElement },
    preventDefault: () => { state.prevented = true },
    stopPropagation: NOOP,
  })
  return state
}

const tabStrip = (count: number): { parentElement: unknown; focused: number[]; selectors: string[] } => {
  const focused: number[] = []
  const selectors: string[] = []
  const nodes = Array.from({ length: count }, (_, index) => ({ focus: (): void => { focused.push(index) } }))
  return {
    parentElement: { querySelectorAll: (selector: string): unknown => { selectors.push(selector); return nodes } },
    focused,
    selectors,
  }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

afterEach(() => {
  vi.unstubAllGlobals()
  slots = []
  cursor = 0
  recorded = []
})

// --- the panel ---------------------------------------------------------------

type PanelProps = Parameters<typeof RulesPanel>[0]

interface PanelView {
  readonly element: React.ReactElement
  readonly props: PanelProps
  readonly writes: unknown[]
}

const panelProps = (over: Partial<PanelProps> = {}): PanelProps => ({
  ctx: undefined as never,
  t,
  rules: [rule()],
  sources: [source()],
  workspace: { path: '/p', source: 'last-scan' },
  state: 'ready',
  onRetry: NOOP,
  onToggleRule: NOOP,
  onToggleSource: NOOP,
  pending: [],
  error: null,
  scanDiagnostics: [],
  truncated: false,
  ...over,
})

const renderPanel = (over: Partial<PanelProps> = {}): PanelView => {
  const writes: unknown[] = []
  const props = panelProps({
    onToggleRule: (row: RuleRow, enabled: boolean) => { writes.push(['rule', row.path, enabled]) },
    onToggleSource: (group: { key: string }, enabled: boolean) => { writes.push(['source', group.key, enabled]) },
    ...over,
  })
  return { element: renderComponent(RulesPanel, props).element, props, writes }
}

const again = (view: PanelView): React.ReactElement => renderComponent(RulesPanel, view.props).element

const scoped = (): { rules: RuleRow[]; sources: RuleSourceRow[] } => ({
  rules: [
    rule({ name: 'projrow', path: '/p/proj.mdc' }),
    rule({ name: 'userrow', path: '/u/user.mdc', scope: 'user', sourceKey: 'global', sourceLabel: 'Global' }),
  ],
  sources: [source(), source({ key: 'global', label: 'Global', scope: 'user' })],
})

describe('scope and status tabs', () => {
  it('switches the listed tier when a scope tab is pressed', () => {
    const { rules, sources } = scoped()
    const view = renderPanel({ rules, sources })
    expect(markup(view.element)).toContain('projrow')
    expect(markup(view.element)).not.toContain('userrow')

    const tab = find(view.element, (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-user')
    expect(tab).toBeDefined()
    expect(tab?.props['aria-selected']).toBe(false)
    fireClick(tab as TreeNode)

    const next = again(view)
    expect(markup(next)).toContain('userrow')
    expect(markup(next)).not.toContain('projrow')
    const userTab = find(next, (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-user')
    expect(userTab?.props['aria-selected']).toBe(true)
  })

  it('moves the selected scope and its focus with the arrow, home and end keys', () => {
    const { rules, sources } = scoped()
    const view = renderPanel({ rules, sources })
    const strip = tabStrip(2)
    const projectTab = find(view.element, (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-project')

    const right = fireKey(projectTab as TreeNode, 'ArrowRight', strip.parentElement)
    expect(right.prevented).toBe(true)
    expect(strip.focused).toEqual([0])
    expect(strip.selectors).toEqual(['[role="tab"]'])
    expect(markup(again(view))).toContain('userrow')

    const userTab = find(again(view), (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-user')
    fireKey(userTab as TreeNode, 'ArrowLeft', strip.parentElement)
    expect(markup(again(view))).toContain('projrow')

    fireKey(find(again(view), (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-project') as TreeNode, 'Home', strip.parentElement)
    expect(markup(again(view))).toContain('userrow')
    fireKey(find(again(view), (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-user') as TreeNode, 'End', strip.parentElement)
    expect(markup(again(view))).toContain('projrow')
  })

  it('leaves the scope alone for a key the tablist does not own', () => {
    const view = renderPanel()
    const tab = find(view.element, (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-project')
    const press = fireKey(tab as TreeNode, 'a')
    expect(press.prevented).toBe(false)
    expect(find(again(view), (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-project')?.props['aria-selected']).toBe(true)
  })

  it('filters the rows to the status tab that is pressed', () => {
    const rules = [
      rule({ name: 'alwayrow', path: '/p/a.mdc' }),
      rule({ name: 'reqrow', path: '/p/r.mdc', type: 'requested' }),
      rule({ name: 'offrow', path: '/p/o.mdc', active: false, enabled: false, disabledBy: 'state' }),
    ]
    const view = renderPanel({ rules })
    expect(markup(view.element)).toContain('offrow')

    fireClick(find(view.element, (element) => element.props['id'] === 'dsh-rules-manager-status-tab-off') as TreeNode)
    const next = again(view)
    const text = markup(next)
    expect(text).toContain('offrow')
    expect(text).not.toContain('alwayrow')
    expect(find(next, (element) => element.props['id'] === 'dsh-rules-manager-status-tab-off')?.props['aria-selected']).toBe(true)

    fireKey(find(next, (element) => element.props['id'] === 'dsh-rules-manager-status-tab-off') as TreeNode, 'Home', tabStrip(5).parentElement)
    expect(markup(again(view))).toContain('alwayrow')
  })
})

describe('filters and the workspace picker', () => {
  it('narrows the list to one source and back to all of them', () => {
    const rules = [
      rule({ name: 'buddyrow', path: '/p/b.mdc' }),
      rule({ name: 'otherrow', path: '/p/o.mdc', sourceKey: 'other', sourceLabel: 'Other' }),
    ]
    const sources = [source(), source({ key: 'other', label: 'Other' })]
    const view = renderPanel({ rules, sources })
    const select = find(view.element, (element) => byClass('dshrm-select')(element))

    expect(markup(view.element)).toContain('buddyrow')
    expect(markup(view.element)).toContain('otherrow')
    fireChange(select as TreeNode, 'project:other')
    const next = again(view)
    expect(markup(next)).toContain('otherrow')
    expect(markup(next)).not.toContain('buddyrow')

    fireChange(find(next, (element) => byClass('dshrm-select')(element)) as TreeNode, 'all')
    expect(markup(again(view))).toContain('buddyrow')
  })

  it('falls back to the source id when the host sends a source row without a name', () => {
    // The host boundary is unchecked, so a source row can arrive with no label.
    // The filter option must then name the scoped id it filters by instead of
    // rendering blank next to "all sources" and being unselectable in practice.
    const nameless = { ...source(), label: undefined } as unknown as RuleSourceRow
    const view = renderPanel({ rules: [rule()], sources: [nameless] })
    const options = findAll(view.element, (element) => element.type === 'option')
    expect(options.map((option) => option.props['value'])).toContain('project:codebuddy')
    expect(options.map((option) => option.props['children'])).toContain('project:codebuddy (1)')
  })

  it('only offers the diagnostics source once a row carries one', () => {
    const plain = renderPanel({ rules: [rule()] })
    expect(markup(plain.element)).not.toContain('value="diag"')

    const view = renderPanel({ rules: [rule({ diagnostics: [diag({ code: 'read.failed' })] })] })
    expect(markup(view.element)).toContain('value="diag"')
    fireChange(find(view.element, (element) => byClass('dshrm-select')(element)) as TreeNode, 'diag')
    const next = again(view)
    expect(markup(next)).toContain('value="diag" selected=""')
    expect(markup(next)).toContain(t('diag.read.failed'))
  })

  it('filters by what is typed into the search box', () => {
    const rules = [rule({ name: 'keeprow', path: '/p/k.mdc' }), rule({ name: 'droprow', path: '/p/d.mdc' })]
    const view = renderPanel({ rules })
    fireChange(find(view.element, byClass('dshrm-search')) as TreeNode, 'keeprow')
    const text = markup(again(view))
    expect(text).toContain('keeprow')
    expect(text).not.toContain('droprow')
  })

  it('says the tier is empty when the query only matches another tier', () => {
    const { rules, sources } = scoped()
    const view = renderPanel({ rules, sources })
    fireChange(find(view.element, byClass('dshrm-search')) as TreeNode, 'userrow')
    const text = markup(again(view))
    expect(text).toContain(t('tierEmpty'))
    expect(text).not.toContain('projrow')
  })

  it('says nothing matches when the status tab and the source filter leave no row', () => {
    const view = renderPanel({ rules: [rule({ name: 'alwayrow' }), rule({ name: 'reqrow', path: '/p/r.mdc', type: 'requested' })] })
    fireClick(find(view.element, (element) => element.props['id'] === 'dsh-rules-manager-status-tab-off') as TreeNode)
    expect(markup(again(view))).toContain(t('noMatch'))
  })

  it('names the empty panel and shows the folder the scan looked at', () => {
    const none = renderPanel({ rules: [], workspace: { path: null, source: 'none' } })
    expect(markup(none.element)).toContain(t('noWorkspace'))
    expect(markup(none.element)).not.toContain('/p/repo')

    const scanned = renderPanel({ rules: [], workspace: { path: '/p/repo', source: 'last-scan' } })
    const text = markup(scanned.element)
    expect(text).toContain(t('empty'))
    expect(text).toContain('/p/repo')
  })

  it('offers the other workspaces and reports the one that is picked', () => {
    const picked: string[] = []
    const view = renderPanel({
      workspace: { path: '/p', source: 'last-scan', options: ['/p', '/q'] },
      onSelectWorkspace: (path: string) => { picked.push(path) },
    })
    const select = find(view.element, (element) => element.props['title'] === t('selectWorkspace'))
    expect(select).toBeDefined()
    fireChange(select as TreeNode, '/q')
    expect(picked).toEqual(['/q'])
  })

  it('hides the workspace picker in the user tier and when the host offers none', () => {
    const withPicker = renderPanel({
      workspace: { path: '/p', source: 'last-scan', options: ['/p', '/q'] },
      onSelectWorkspace: NOOP,
    })
    expect(find(withPicker.element, (element) => element.props['title'] === t('selectWorkspace'))).toBeDefined()

    fireClick(find(withPicker.element, (element) => element.props['id'] === 'dsh-rules-manager-scope-tab-user') as TreeNode)
    expect(find(again(withPicker), (element) => element.props['title'] === t('selectWorkspace'))).toBeUndefined()

    const withoutOptions = renderPanel({ onSelectWorkspace: NOOP })
    expect(find(withoutOptions.element, (element) => element.props['title'] === t('selectWorkspace'))).toBeUndefined()
  })

  it('keeps the workspace picker usable before any folder has been scanned', () => {
    // The picker is the only way out of an unscanned panel, so it must not
    // disappear with the folder it would normally pre-select.
    const view = renderPanel({
      workspace: { path: null, source: 'none', options: ['/q'] },
      onSelectWorkspace: NOOP,
    })
    const select = find(view.element, (element) => element.props['title'] === t('selectWorkspace'))
    expect(select).toBeDefined()
    expect(select?.props['value']).toBe('')
    const options = findAll(select as TreeNode, (element) => element.type === 'option')
    expect(options.map((option) => option.props['value'])).toEqual(['/q'])
  })
})

describe('stats, refresh and errors', () => {
  it('turns the diagnostics counter into a filter while rows carry diagnostics', () => {
    const rules = [rule({ name: 'diagrow', path: '/p/d.mdc', diagnostics: [diag({ code: 'read.failed' })] }), rule({ name: 'cleanrow', path: '/p/c.mdc' })]
    const view = renderPanel({ rules })
    const button = find(view.element, byClass('dshrm-stat-btn'))
    expect(button?.props['aria-pressed']).toBe(false)

    fireClick(button as TreeNode)
    const next = again(view)
    expect(markup(next)).toContain('diagrow')
    expect(markup(next)).not.toContain('cleanrow')
    const pressed = find(next, byClass('dshrm-stat-btn'))
    expect(pressed?.props['aria-pressed']).toBe(true)
    expect(String(pressed?.props['className']).split(' ')).toContain('on')

    fireClick(pressed as TreeNode)
    const back = again(view)
    expect(markup(back)).toContain('cleanrow')
    expect(find(back, byClass('dshrm-stat-btn'))?.props['aria-pressed']).toBe(false)
  })

  it('keeps the diagnostics counter a plain figure when nothing reported one', () => {
    const view = renderPanel({ rules: [rule()] })
    expect(find(view.element, byClass('dshrm-stat-btn'))).toBeUndefined()
    expect(find(view.element, byClass('dshrm-stat'))).toBeDefined()
  })

  it('stamps the time of the scan it is showing', () => {
    const view = renderPanel({ scannedAt: 1_700_000_000_000 })
    const stamp = find(view.element, byClass('dshrm-cost-l'))
    expect(stamp).toBeDefined()
    expect(String(stamp?.props['title'])).toContain(String(new Date(1_700_000_000_000).getFullYear()))
    expect(markup(renderPanel().element)).not.toContain(t('scannedAt').replace('{time}', ''))
  })

  it('forces a rescan from the refresh button and falls back to a plain retry', () => {
    let refreshed = 0
    let retried = 0
    const view = renderPanel({
      refreshing: true,
      onRefresh: () => { refreshed += 1 },
      onRetry: () => { retried += 1 },
    })
    const button = find(view.element, (element) => byClass('dshrm-btn')(element))
    expect(button?.props['disabled']).toBe(true)
    expect(markup(view.element)).toContain(t('refreshing'))
    fireClick(button as TreeNode)
    expect(refreshed).toBe(1)

    const bare = renderPanel({ onRetry: () => { retried += 1 } })
    fireClick(find(bare.element, (element) => byClass('dshrm-btn')(element)) as TreeNode)
    expect(retried).toBe(1)
    expect(markup(bare.element)).toContain(t('refresh'))
  })

  it('shows the failed write the host rejected and the diagnostics the scan reported', () => {
    const view = renderPanel({
      error: 'boom',
      truncated: true,
      scanDiagnostics: [diag({ code: 'diag.scan.unreadable', detail: 'gone', line: 3, path: '/p/x.mdc' })],
    })
    const text = markup(view.element)
    expect(text).toContain(t('writeFailed').replace('{message}', 'boom'))
    expect(text).toContain(t('scanTruncated'))
    expect(text).toContain(t('scanDiagnostics').replace('{n}', '1'))
  })

  it('folds the scan diagnostics open and closed', () => {
    const view = renderPanel({ scanDiagnostics: [diag({ code: 'read.failed', detail: 'nope' })] })
    const details = find(view.element, byClass('dshrm-scan-diag'))
    expect(details?.props['open']).toBe(false)

    fireToggle(details as TreeNode, true)
    expect(find(again(view), byClass('dshrm-scan-diag'))?.props['open']).toBe(true)
    fireToggle(find(again(view), byClass('dshrm-scan-diag')) as TreeNode, false)
    expect(find(again(view), byClass('dshrm-scan-diag'))?.props['open']).toBe(false)
  })
})

describe('group folds and switches', () => {
  it('collapses one group without touching its neighbours', () => {
    const rules = [rule({ name: 'buddyrow', path: '/p/b.mdc' }), rule({ name: 'otherrow', path: '/p/o.mdc', sourceKey: 'other', sourceLabel: 'Other' })]
    const sources = [source(), source({ key: 'other', label: 'Other' })]
    const view = renderPanel({ rules, sources })
    const folds = findAll(view.element, byClass('dshrm-fold'))
    expect(folds).toHaveLength(2)
    expect(folds[0]?.props['aria-expanded']).toBe(true)

    fireClick(folds[0] as TreeNode)
    const next = again(view)
    const nextFolds = findAll(next, byClass('dshrm-fold'))
    expect(nextFolds[0]?.props['aria-expanded']).toBe(false)
    expect(nextFolds[1]?.props['aria-expanded']).toBe(true)
    expect(markup(next)).toContain('▶')
    expect(markup(next)).not.toContain('buddyrow')
    expect(markup(next)).toContain('otherrow')

    fireClick(findAll(again(view), byClass('dshrm-fold'))[0] as TreeNode)
    const expanded = again(view)
    expect(findAll(expanded, byClass('dshrm-fold'))[0]?.props['aria-expanded']).toBe(true)
    expect(markup(expanded)).toContain('buddyrow')
    expect(markup(expanded)).toContain('▼')
  })

  it('says a group has no rows when the status tab emptied it', () => {
    const rules = [rule({ name: 'buddyrow' }), rule({ name: 'otherrow', path: '/p/o.mdc', sourceKey: 'other', sourceLabel: 'Other', active: false, enabled: false, disabledBy: 'state' })]
    const sources = [source(), source({ key: 'other', label: 'Other' })]
    const view = renderPanel({ rules, sources })
    fireClick(find(view.element, (element) => element.props['id'] === 'dsh-rules-manager-status-tab-always') as TreeNode)
    const text = markup(again(view))
    expect(text).toContain(t('groupEmpty'))
    expect(text).toContain('buddyrow')
  })

  it('reports the folder of a listed source and omits it for a source only the rules knew', () => {
    const listed = renderPanel({ rules: [rule()], sources: [source()] })
    expect(find(listed.element, byClass('dshrm-group-path'))?.props['title']).toBe('D:/repo/.codebuddy/rules')

    const derived = renderPanel({ rules: [rule({ sourceKey: 'ghost', sourceLabel: 'Ghost' })], sources: [] })
    expect(find(derived.element, byClass('dshrm-group-path'))).toBeUndefined()
    expect(markup(derived.element)).toContain('Ghost')
  })

  it('writes a source switch with the value the user set, and holds it while the write is out', () => {
    const view = renderPanel({ rules: [rule({ active: false, enabled: false, disabledBy: 'state' })], sources: [source({ enabled: false })] })
    const toggle = sourceSwitch(view.element)
    expect(toggle?.props['checked']).toBe(false)
    fireCheck(toggle as TreeNode, true)
    expect(view.writes).toEqual([['source', 'project:codebuddy', true]])

    const held = renderPanel({ rules: [rule()], pending: ['project:codebuddy'] })
    expect(sourceSwitch(held.element)?.props['disabled']).toBe(true)
  })
})

describe('the rule row', () => {
  type RowProps = Parameters<typeof RuleItem>[0]

  const row = (over: Partial<RowProps> = {}): RowProps => ({
    rule: rule(),
    t,
    busy: false,
    onToggle: NOOP,
    ...over,
  })

  const fold = (view: { element: React.ReactElement }): TreeNode | undefined =>
    find(view.element, byClass('dshrm-diag'))

  it('folds its own diagnostics open and closed', () => {
    const props = row({ rule: rule({ diagnostics: [diag({ code: 'read.failed', detail: 'nope', line: 4 })] }) })
    const view = renderComponent(RuleItem, props)
    expect(fold(view)?.props['open']).toBe(false)
    fireToggle(fold(view) as TreeNode, true)
    expect(fold(renderComponent(RuleItem, props))?.props['open']).toBe(true)
  })

  it('lets the panel own the diagnostics fold when it passes one down', () => {
    const opened: boolean[] = []
    let props = row({
      rule: rule({ diagnostics: [diag({ code: 'read.failed', detail: 'nope' })] }),
      openDiagnostics: false,
      onToggleDiagnostics: (open: boolean) => { opened.push(open) },
    })
    fireToggle(fold(renderComponent(RuleItem, props)) as TreeNode, true)
    expect(opened).toEqual([true])
    expect(fold(renderComponent(RuleItem, props))?.props['open']).toBe(false)

    props = row({ rule: rule({ diagnostics: [diag({ code: 'read.failed', detail: 'nope' })] }), openDiagnostics: true })
    expect(fold(renderComponent(RuleItem, props))?.props['open']).toBe(true)
    fireToggle(fold(renderComponent(RuleItem, props)) as TreeNode, false)
    expect(fold(renderComponent(RuleItem, props))?.props['open']).toBe(true)
  })

  it('marks a rule attached from frontmatter and drops an empty description', () => {
    const attached = renderComponent(RuleItem, row({ rule: rule({ attached: true }) }))
    const badge = find(attached.element, (element) => String(element.props['className']).includes('is-attached'))
    expect(badge?.props['title']).toBe(t('note.attached'))

    const plain = renderComponent(RuleItem, row({ rule: rule({ description: '' }) }))
    expect(find(plain.element, byClass('dshrm-desc'))).toBeUndefined()
    expect(find(renderComponent(RuleItem, row()).element, byClass('dshrm-desc'))?.props['children']).toBe('d')
  })

  it('sends the switch value up and refuses to move where the rule cannot', () => {
    const seen: unknown[] = []
    const view = renderComponent(RuleItem, row({ onToggle: (target: RuleRow, enabled: boolean) => { seen.push([target.path, enabled]) } }))
    fireCheck(find(view.element, (element) => element.props['role'] === 'switch') as TreeNode, false)
    expect(seen).toEqual([['/p/codebuddy/a.mdc', false]])

    expect(find(renderComponent(RuleItem, row({ busy: true })).element, (element) => element.props['role'] === 'switch')?.props['disabled']).toBe(true)
    expect(find(renderComponent(RuleItem, row({ rule: rule({ disabledBy: 'source' }) })).element, (element) => element.props['role'] === 'switch')?.props['disabled']).toBe(true)
    expect(find(renderComponent(RuleItem, row({ rule: rule({ active: false, enabled: false, disabledBy: 'state' }) })).element, (element) => element.props['role'] === 'switch')?.props['disabled']).toBe(false)
  })
})

describe('the cost receipt', () => {
  type ReceiptProps = Parameters<typeof TokenBreakdown>[0]

  const receipt = (over: Partial<ReceiptProps> = {}): ReceiptProps => ({
    rules: [],
    diagnostics: [],
    t,
    onClose: NOOP,
    ...over,
  })

  it('lists the heaviest rule first and totals the columns', () => {
    const view = renderComponent(TokenBreakdown, receipt({
      rules: [rule({ name: 'light', bodyTokens: 10, bodyLength: 10 }), rule({ name: 'heavy', path: '/p/heavy.mdc', bodyTokens: 900, bodyLength: 900 })],
    }))
    const text = markup(view.element)
    expect(text.indexOf('heavy')).toBeLessThan(text.indexOf('light'))
    expect(text).toContain(t('costTotal').replace('{n}', '2'))
    expect(text).not.toContain(t('costCatalog'))
    expect(text).toContain(t('costHint'))
  })

  it('adds the requestable index when one of the rules is paid for on demand', () => {
    const text = markup(renderComponent(TokenBreakdown, receipt({ rules: [rule({ type: 'requested' })] })).element)
    expect(text).toContain(t('costCatalog'))
    expect(text).toContain(t('costCatalogNote'))
  })

  it('states a rule that is out by why it is out rather than by a type it is not paying for', () => {
    const view = renderComponent(TokenBreakdown, receipt({ rules: [rule({ active: false, enabled: false, disabledBy: 'state' })] }))
    const text = markup(view.element)
    expect(text).toContain(t('stat.disabled'))
    // The state cell must read "stopped", not the type the rule would have had.
    const state = findAll(view.element, byClass('dshrm-cost-td'))[1]
    expect(state?.props['children']).toBe(t('stat.disabled'))
  })

  it('notes the rules the budget truncated and the ones it left out', () => {
    const truncated = markup(renderComponent(TokenBreakdown, receipt({ rules: [rule({ bodyLength: 9_000 })] })).element)
    expect(truncated).toContain(t('costTruncated').replace('{n}', '1'))

    const omitted = markup(renderComponent(TokenBreakdown, receipt({
      rules: [rule({ name: 'one', path: '/p/one.mdc', bodyLength: 8_000 }), rule({ name: 'two', path: '/p/two.mdc', bodyLength: 8_000 })],
    })).element)
    expect(omitted).toContain(t('costOmitted').replace('{n}', '1'))
  })

  it('lists the scan diagnostics beside the totals', () => {
    const text = markup(renderComponent(TokenBreakdown, receipt({ diagnostics: [diag({ code: 'read.failed', detail: 'gone' })] })).element)
    expect(text).toContain(t('costScanNote').replace('{n}', '1'))
    expect(text).toContain('read.failed')
  })

  it('closes from the backdrop and the close button but not from the card itself', () => {
    let closed = 0
    const view = renderComponent(TokenBreakdown, receipt({ onClose: () => { closed += 1 } }))
    let stopped = 0
    fireClick(find(view.element, byClass('dshrm-modal-card')) as TreeNode, { stopPropagation: () => { stopped += 1 } })
    expect(stopped).toBe(1)
    expect(closed).toBe(0)

    fireClick(find(view.element, byClass('dshrm-modal')) as TreeNode)
    expect(closed).toBe(1)
    fireClick(find(view.element, (element) => byClass('dshrm-btn')(element)) as TreeNode)
    expect(closed).toBe(2)
  })

  it('focuses the card, closes on Escape and hands focus back to the panel', () => {
    const listeners: Array<(event: { key: string }) => void> = []
    const removed: Array<(event: { key: string }) => void> = []
    const focused: string[] = []
    const restored: string[] = []
    vi.stubGlobal('document', {
      activeElement: { focus: () => { restored.push('panel') } },
      addEventListener: (_type: string, handler: (event: { key: string }) => void) => { listeners.push(handler) },
      removeEventListener: (_type: string, handler: (event: { key: string }) => void) => { removed.push(handler) },
    })

    let closed = 0
    const view = renderComponent(TokenBreakdown, receipt({ onClose: () => { closed += 1 } }))
    const attached = attachRefs(view.element, { focus: () => { focused.push('card') } })
    const cleanups = runEffects(renderComponent(TokenBreakdown, receipt({ onClose: () => { closed += 1 } })).effects)
    expect(attached).toBeGreaterThan(0)
    expect(focused).toEqual(['card'])
    expect(listeners).toHaveLength(1)

    listeners[0]?.({ key: 'a' })
    expect(closed).toBe(0)
    listeners[0]?.({ key: 'Escape' })
    expect(closed).toBe(1)

    for (const cleanup of cleanups) cleanup()
    expect(removed).toHaveLength(1)
    expect(restored).toEqual(['panel'])
  })

  it('does not look for a focus target to restore when there is no document to read it from', () => {
    // Without a document there is nothing to focus and nothing to give focus
    // back to, so the effect must not dereference one. It still needs a real
    // document to attach the Escape listener to, which is where it stops.
    vi.stubGlobal('document', undefined)
    const view = renderComponent(TokenBreakdown, receipt({}))
    let failure: unknown = null
    try {
      runEffects(view.effects)
    } catch (cause) {
      failure = cause
    }
    expect(String(failure)).toContain('addEventListener')
  })
})

describe('opening the receipt from the panel', () => {
  it('opens the cost receipt from the cost line and closes it again', () => {
    const view = renderPanel({ rules: [rule({ type: 'requested' })] })
    expect(find(view.element, (element) => element.type === TokenBreakdown)).toBeUndefined()

    fireClick(find(view.element, byClass('dshrm-link')) as TreeNode)
    const open = again(view)
    const receipt = find(open, (element) => element.type === TokenBreakdown)
    expect(receipt).toBeDefined()
    expect(receipt?.props['rules']).toEqual(view.props.rules)
    expect(receipt?.props['diagnostics']).toEqual(view.props.scanDiagnostics)
    expect(markup(open)).toContain(t('costHint'))

    call(receipt?.props['onClose'], { preventDefault: NOOP })
    expect(find(again(view), (element) => element.type === TokenBreakdown)).toBeUndefined()
  })
})

describe('register: slots, icon and labels', () => {
  interface Registration {
    readonly name: string
    readonly definition: Record<string, unknown>
    readonly target: unknown
  }

  const fakeCtx = (): { ctx: Context; registered: Registration[]; injected: string[]; disposed: string[] } => {
    const registered: Registration[] = []
    const injected: string[] = []
    const disposed: string[] = []
    const ctx = {
      slots: {
        inject: (name: string, contribute: () => void): void => { injected.push(name); contribute() },
        register: (definition: Record<string, unknown>, target: unknown): (() => void) => {
          registered.push({ name: String(definition['name']), definition, target })
          return () => { disposed.push(String(definition['id'] ?? definition['key'])) }
        },
      },
    }
    return { ctx: ctx as unknown as Context, registered, injected, disposed }
  }

  it('contributes the settings section, its icon, the sidebar entry and the panel body', () => {
    const { ctx, registered, injected, disposed } = fakeCtx()
    const dispose = register(ctx, t)

    expect(injected).toEqual(['settings.section', 'settings.section.icon', 'sidebar.panellist', 'main'])
    const section = registered.find((entry) => entry.name === 'settings.section')
    const icon = registered.find((entry) => entry.name === 'settings.section.icon')
    const entry = registered.find((entry) => entry.name === 'sidebar.panellist')
    const body = registered.find((entry) => entry.name === 'main')
    expect(section?.definition['id']).toBe('dsh-rules-manager')
    expect(section?.definition['order']).toBe(30)
    expect(icon?.definition['id']).toBe(section?.definition['id'])
    expect(entry?.definition['id']).toBe('dsh-rules-manager')
    expect(entry?.definition['order']).toBe(3)
    // The sidebar id and the main key have to agree, or the entry opens nothing.
    expect(body?.definition['key']).toBe(entry?.definition['id'])

    const label = (registration: Registration | undefined): string => (registration?.definition['label'] as () => string)()
    expect(label(section)).toBe(t('title'))
    expect(label(entry)).toBe(t('panel'))

    dispose()
    expect(disposed).toEqual(['dsh-rules-manager', 'dsh-rules-manager', 'dsh-rules-manager', 'dsh-rules-manager'])
  })

  it('draws its icon at the default size and at the size the host asks for', () => {
    const { ctx, registered } = fakeCtx()
    register(ctx, t)
    const draw = registered.find((entry) => entry.name === 'settings.section.icon')?.target as (props: { size?: number }) => React.ReactElement
    const normal = draw({})
    expect(normal.props['width']).toBe(16)
    expect(normal.props['height']).toBe(16)
    expect(normal.props['viewBox']).toBe('0 0 24 24')
    const large = draw({ size: 24 })
    expect(large.props['width']).toBe(24)
    expect(large.props['height']).toBe(24)
  })

  it('renders the panel body from the hook state it reads', () => {
    const { ctx, registered } = fakeCtx()
    register(ctx, t)
    const render = registered.find((entry) => entry.name === 'main')?.target as () => React.ReactElement
    const view = renderComponent(render, {})
    expect(view.element.type).toBe(RulesPanel)
    const props = view.element.props as Record<string, unknown>
    expect(props['state']).toBe('loading')
    expect(props['rules']).toEqual([])
    expect(props['pending']).toEqual([])
    expect(props['error']).toBeNull()
    expect(props['truncated']).toBe(false)
    expect(props['scanDiagnostics']).toEqual([])
    expect(props['workspace']).toEqual({ path: null, source: 'none' })
    expect(props['onRetry']).toBeTypeOf('function')
    expect(props['onRefresh']).toBeTypeOf('function')
    expect(props['onToggleRule']).toBeTypeOf('function')
    expect(props['onToggleSource']).toBeTypeOf('function')
    expect(props['onSelectWorkspace']).toBeTypeOf('function')
  })
})

describe('useRules: reads, refresh and writes', () => {
  interface Harness {
    readonly hook: () => ReturnType<typeof useRules>
    readonly view: Rendered
    readonly render: () => Rendered
  }

  const harness = (): Harness => {
    const holder: { hook?: ReturnType<typeof useRules> } = {}
    const Probe = (): React.ReactElement => {
      holder.hook = useRules('/x')
      return <span />
    }
    const view = renderComponent(Probe, {})
    return { hook: () => holder.hook as ReturnType<typeof useRules>, view, render: () => renderComponent(Probe, {}) }
  }

  const respond = (body: unknown) => async (url: string): Promise<unknown> => {
    urls.push(String(url))
    return { ok: true, status: 200, json: async () => body }
  }
  let urls: string[] = []

  const boot = async (body: unknown): Promise<Harness & { cleanups: Array<() => void> }> => {
    urls = []
    vi.stubGlobal('fetch', respond(body))
    const state = harness()
    const cleanups = runEffects(state.view.effects)
    await settle()
    return { ...state, cleanups }
  }

  const catalog = (over: Partial<RulesPayload> = {}): RulesPayload => ({
    rules: [rule()],
    sources: [source()],
    scannedAt: 7,
    diagnostics: [],
    truncated: false,
    workspace: { path: '/p', source: 'last-scan' },
    ...over,
  })

  it('reads the catalog once and flips the panel to ready with the rows', async () => {
    const state = await boot(catalog())
    state.render()
    expect(state.hook().state).toBe('ready')
    expect(state.hook().rules).toHaveLength(1)
    expect(state.hook().scannedAt).toBe(7)
    expect(state.hook().refreshing).toBe(false)
    expect(urls[0]).toContain('/x')
    expect(urls[0]).not.toContain('refresh=1')
    for (const cleanup of state.cleanups) cleanup()
  })

  it('reports a read that failed instead of showing rows that were never read', async () => {
    vi.stubGlobal('fetch', async (): Promise<unknown> => ({ ok: false, status: 500, json: async () => ({}) }))
    const state = harness()
    const cleanups = runEffects(state.view.effects)
    await settle()
    state.render()
    expect(state.hook().state).toBe('failed')
    expect(state.hook().rules).toEqual([])
    for (const cleanup of cleanups) cleanup()
  })

  it('turns a refresh into a forced read that keeps the rows on screen while it runs', async () => {
    const state = await boot(catalog())
    state.render()
    expect(state.hook().state).toBe('ready')

    state.hook().refresh()
    const during = state.render()
    expect(state.hook().refreshing).toBe(false)
    runEffects(during.effects)
    state.render()
    expect(state.hook().refreshing).toBe(true)
    expect(state.hook().state).toBe('ready')
    expect(state.hook().rules).toHaveLength(1)

    await settle()
    state.render()
    expect(state.hook().refreshing).toBe(false)
    expect(urls.at(-1)).toContain('refresh=1')
  })

  it('re-reads from the retry path and remembers the folder the user picked', async () => {
    const state = await boot(catalog())
    state.render()
    state.hook().retry()
    state.hook().selectWorkspace('/q')
    const next = state.render()
    expect(state.hook().selectedWorkspace).toBe('/q')
    runEffects(next.effects)
    await settle()
    state.render()
    expect(urls.at(-1)).toContain('workspace=%2Fq')
  })

  it('flips a rule as soon as the switch moves, then keeps the host answer', async () => {
    let post: unknown = undefined
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }): Promise<unknown> => {
      urls.push(String(url))
      if (init?.method === 'POST') {
        post = JSON.parse(String(init.body))
        return { ok: true, status: 200, json: async () => catalog({ rules: [rule({ active: false, enabled: true, disabledBy: 'state' })] }) }
      }
      return { ok: true, status: 200, json: async () => catalog() }
    })
    urls = []
    const state = harness()
    const cleanups = runEffects(state.view.effects)
    await settle()
    state.render()
    state.hook().setPayload(catalog())
    state.render()

    state.hook().toggleRule(rule(), false)
    state.render()
    expect(state.hook().pending).toEqual(['/p/codebuddy/a.mdc'])
    expect(state.hook().rules[0]?.active).toBe(false)

    await settle()
    state.render()
    expect(post).toEqual({ action: 'setRule', key: 'codebuddy', path: '/p/codebuddy/a.mdc', enabled: false, scope: 'project' })
    expect(state.hook().pending).toEqual([])
    expect(state.hook().error).toBeNull()
    expect(state.hook().rules[0]?.disabledBy).toBe('state')
    for (const cleanup of cleanups) cleanup()
  })

  it('puts the row back and surfaces the reason when the host refuses the write', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }): Promise<unknown> => {
      urls.push(String(url))
      if (init?.method === 'POST') return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => catalog() }
    })
    urls = []
    const state = harness()
    const cleanups = runEffects(state.view.effects)
    await settle()
    state.render()
    state.hook().setPayload(catalog())
    state.render()

    state.hook().toggleSource({ key: 'project:codebuddy', scope: 'project' } as never, false)
    state.render()
    expect(state.hook().rules[0]?.active).toBe(false)

    await settle()
    state.render()
    expect(state.hook().rules[0]?.active).toBe(true)
    expect(state.hook().error).toContain('500')
    expect(state.hook().pending).toEqual([])
    for (const cleanup of cleanups) cleanup()
  })

  it('leaves the last frame untouched when a write lands after the panel is gone', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }): Promise<unknown> => {
      urls.push(String(url))
      if (init?.method === 'POST') return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => catalog() }
    })
    urls = []
    const state = harness()
    const cleanups = runEffects(state.view.effects)
    await settle()
    state.render()
    state.hook().setPayload(catalog())
    state.render()
    cleanups[1]?.()

    state.hook().toggleRule(rule(), false)
    state.render()
    await settle()
    state.render()
    expect(state.hook().error).toBeNull()
    expect(state.hook().rules[0]?.active).toBe(false)
    expect(state.hook().pending).toEqual(['/p/codebuddy/a.mdc'])
  })

  it('keeps the diagnostics list an array when a payload arrives without one', () => {
    const state = harness()
    state.hook().setPayload({ ...catalog(), diagnostics: undefined } as unknown as RulesPayload)
    state.render()
    expect(state.hook().scanDiagnostics).toEqual([])
  })

  it('drops the answer of a read that was cancelled before it landed', async () => {
    // A read that finishes after its effect was torn down must not write into
    // the panel: the payload belongs to a route or folder the user has already
    // navigated away from.
    vi.stubGlobal('fetch', async (): Promise<unknown> => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { ok: true, status: 200, json: async () => catalog() }
    })
    const state = harness()
    const cleanups = runEffects(state.view.effects)
    cleanups[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 40))
    state.render()
    expect(state.hook().state).toBe('loading')
    expect(state.hook().rules).toEqual([])
  })

  it('drops a write that succeeded after the panel was gone', async () => {
    // The optimistic frame is the last thing the user saw; a host answer that
    // arrives after unmount must not be written into a panel that is gone.
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }): Promise<unknown> => {
      urls.push(String(url))
      if (init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => catalog({ rules: [rule({ active: false, enabled: true, disabledBy: 'state' })] }) }
      }
      return { ok: true, status: 200, json: async () => catalog() }
    })
    urls = []
    const state = harness()
    const cleanups = runEffects(state.view.effects)
    await settle()
    state.render()
    state.hook().setPayload(catalog())
    state.render()
    cleanups[1]?.()

    state.hook().toggleRule(rule(), false)
    state.render()
    expect(state.hook().rules[0]?.active).toBe(false)
    await settle()
    state.render()
    expect(state.hook().error).toBeNull()
    expect(state.hook().rules[0]?.active).toBe(false)
    expect(state.hook().pending).toEqual(['/p/codebuddy/a.mdc'])
  })

  it('surfaces a write that failed without an Error object', async () => {
    // The host may reject with a plain string; the panel still has to say what
    // went wrong instead of printing an empty failure line.
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }): Promise<unknown> => {
      urls.push(String(url))
      if (init?.method === 'POST') throw 'the host hung up'
      return { ok: true, status: 200, json: async () => catalog() }
    })
    urls = []
    const state = harness()
    const cleanups = runEffects(state.view.effects)
    await settle()
    state.render()
    state.hook().setPayload(catalog())
    state.render()

    state.hook().toggleRule(rule(), false)
    state.render()
    expect(state.hook().rules[0]?.active).toBe(false)

    await settle()
    state.render()
    expect(state.hook().error).toBe('the host hung up')
    expect(state.hook().rules[0]?.active).toBe(true)
    expect(state.hook().pending).toEqual([])
    for (const cleanup of cleanups) cleanup()
  })
})

describe('defensive reads and pure helpers', () => {
  it('fills in the fields a partial host answer leaves out', async () => {
    const { fetchRules, postAction } = await import('../src/client/index.tsx')
    const partial = async (): Promise<unknown> => ({ ok: true, status: 200, json: async () => ({ rules: [] }) })
    const read = await fetchRules('/x', partial as never)
    expect(read.workspace).toEqual({ path: null, source: 'none' })
    expect(read.truncated).toBe(false)
    expect(read.scannedAt).toBe(0)
    expect(read.diagnostics).toEqual([])

    const written = await postAction({ action: 'setSource', key: 'codebuddy', enabled: true }, '/x', partial as never)
    expect(written.workspace).toEqual({ path: null, source: 'none' })
    expect(written.truncated).toBe(false)
    expect(written.sources).toEqual([])
  })

  it('refuses an answer that is not a list of rules', async () => {
    const { postAction } = await import('../src/client/index.tsx')
    const empty = async (): Promise<unknown> => ({ ok: true, status: 200, json: async () => ({}) })
    await expect(postAction({ action: 'setSource', key: 'codebuddy', enabled: true }, '/x', empty as never)).rejects.toThrow('not a list')
  })

  it('still lists rules when a host body only answers the shape check once', async () => {
    // The shape check reads the field and the mapping reads it again. A body
    // whose accessor does not repeat itself used to produce a payload with no
    // rule list at all, which the panel renders as an empty catalog.
    const { fetchRules, postAction } = await import('../src/client/index.tsx')
    const single = (): { ok: boolean; status: number; json: () => Promise<unknown> } => ({
      ok: true,
      status: 200,
      json: async () => {
        let reads = 0
        return {
          get rules(): unknown {
            reads += 1
            return reads === 1 ? [] : undefined
          },
        }
      },
    })
    const read = await fetchRules('/x', (async () => single()) as never)
    expect(read.rules).toEqual([])
    const written = await postAction({ action: 'setSource', key: 'codebuddy', enabled: true }, '/x', (async () => single()) as never)
    expect(written.rules).toEqual([])
  })

  it('refuses to write when this runtime reaches the host with no fetch at all', async () => {
    const { postAction } = await import('../src/client/index.tsx')
    vi.stubGlobal('fetch', undefined)
    await expect(postAction({ action: 'setSource', key: 'codebuddy', enabled: true }, '/x')).rejects.toThrow('no fetch in this environment')
  })

  it('falls back to the bundled table when the locale service cannot bind a key', () => {
    const ctx = {
      get: () => ({
        bind: () => () => { throw new Error('broken service') },
        getSnapshot: () => ({ active: 'zh-CN' }),
      }),
    }
    expect(resolveText(ctx as unknown as Context, 'title')).toBe(TEXT.zh['title'])
  })

  it('appends the stylesheet to the document element when the head is missing', () => {
    const appended: string[] = []
    vi.stubGlobal('document', {
      head: null,
      documentElement: { appendChild: (node: { id: string }) => { appended.push(node.id) } },
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
    })
    installPanelStyles()
    expect(appended).toEqual(['dsh-rules-manager-style'])
  })

  it('re-enables a rule when its source comes back without losing a harder block', () => {
    const payload: RulesPayload = {
      rules: [
        rule({ path: '/p/state.mdc', active: false, enabled: true, disabledBy: 'state' }),
        rule({ path: '/p/fm.mdc', active: false, enabled: false, disabledBy: 'frontmatter' }),
        rule({ path: '/p/off.mdc', active: false, enabled: false, disabledBy: null }),
        rule({ path: '/p/other.mdc', sourceKey: 'other' }),
      ],
      sources: [source({ enabled: false })],
      scannedAt: 0,
      diagnostics: [],
      truncated: false,
      workspace: { path: '/p', source: 'last-scan' },
    }
    const next = optimistic(payload, { action: 'setSource', key: 'codebuddy', enabled: true })
    expect(next.sources[0]?.enabled).toBe(true)
    expect(next.rules[0]).toMatchObject({ active: false, disabledBy: 'state' })
    expect(next.rules[1]).toMatchObject({ active: false, disabledBy: 'frontmatter' })
    expect(next.rules[2]).toMatchObject({ active: false, disabledBy: 'frontmatter' })
    expect(next.rules[3]?.active).toBe(true)

    const off = optimistic(payload, { action: 'setSource', key: 'codebuddy', enabled: false })
    expect(off.rules[0]).toMatchObject({ active: false, disabledBy: 'source' })
  })

  it('re-enables a rule when at least one harder block clears and keeps the remaining one', () => {
    const payload: RulesPayload = {
      rules: [
        rule({ path: '/p/source.mdc', sourceKey: 'codebuddy', active: false, enabled: true, disabledBy: 'source' }),
        rule({ path: '/p/fm.mdc', active: false, enabled: true, disabledBy: 'frontmatter' }),
        rule({ path: '/p/free.mdc', active: false, enabled: false, disabledBy: null }),
        rule({ path: '/p/user.mdc', scope: 'user' }),
      ],
      sources: [source()],
      scannedAt: 0,
      diagnostics: [],
      truncated: false,
      workspace: { path: '/p', source: 'last-scan' },
    }
    const next = optimistic(payload, { action: 'setRule', key: 'codebuddy', path: '/p/free.mdc', enabled: true, scope: 'project' })
    expect(next.rules[0]?.active).toBe(false)
    expect(next.rules[1]?.active).toBe(false)
    expect(next.rules[2]?.active).toBe(false)
    expect(next.rules[3]?.active).toBe(true)

    const blocked = optimistic(payload, { action: 'setRule', key: 'codebuddy', path: '/p/source.mdc', enabled: true, scope: 'project' })
    expect(blocked.rules[0]).toMatchObject({ active: false, disabledBy: 'source' })
    const front = optimistic(payload, { action: 'setRule', key: 'codebuddy', path: '/p/fm.mdc', enabled: true, scope: 'project' })
    expect(front.rules[1]).toMatchObject({ active: false, disabledBy: 'frontmatter' })

    // A project-scoped write must not reach the same-named rule in the user tier.
    const scoped = optimistic(payload, { action: 'setRule', key: 'codebuddy', path: '/p/user.mdc', enabled: false, scope: 'project' })
    expect(scoped.rules[3]).toMatchObject({ active: true, disabledBy: null })
    const owned = optimistic(payload, { action: 'setRule', key: 'codebuddy', path: '/p/user.mdc', enabled: false, scope: 'user' })
    expect(owned.rules[3]).toMatchObject({ active: false, disabledBy: 'state' })
  })

  it('keeps one group per source when the host lists the same source twice', () => {
    const groups = groupBySource([rule()], [source(), source()])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.rules).toHaveLength(1)
  })
})
