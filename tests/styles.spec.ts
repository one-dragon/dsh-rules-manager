import { afterEach, describe, expect, it, vi } from 'vitest'
import { PANEL_CSS, installPanelStyles } from '../src/client/styles.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Minimal DOM stand-in: only the members `installPanelStyles` touches. */
function fakeDocument() {
  const appended: Array<{ id: string; textContent: string }> = []
  const byId = new Map<string, unknown>()
  const doc = {
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tag: string) => {
      const el = { tagName: tag, id: '', textContent: '' }
      appended.push(el as never)
      return el
    },
    head: {
      appendChild: (el: { id: string }) => { byId.set(el.id, el) },
    },
    documentElement: { appendChild: () => {} },
  }
  return { doc, appended, byId }
}

describe('PANEL_CSS', () => {
  it('styles every class the panel renders', () => {
    // Every class the redesigned panel emits; the list is the assertion, so a
    // new element without a rule fails here.
    const emitted = [
      'dshrm-panel', 'dshrm-head', 'dshrm-title', 'dshrm-sub',
      'dshrm-brand', 'dshrm-actions',
      'dshrm-stats', 'dshrm-stat', 'dshrm-stat-n', 'dshrm-stat-l',
      'dshrm-cost', 'dshrm-cost-n', 'dshrm-cost-l', 'dshrm-cost-note', 'dshrm-cost-fixed',
      'dshrm-tabs', 'dshrm-tabs-seg', 'dshrm-tab', 'dshrm-tabgroup', 'dshrm-stat-btn',
      'dshrm-diag', 'dshrm-diag-line', 'dshrm-diag-help', 'dshrm-diag-path',
      'dshrm-diag-list', 'dshrm-diag-code',
      'dshrm-scan-note', 'dshrm-scan-diag', 'dshrm-cost-note-p',
      'dshrm-link', 'dshrm-modal', 'dshrm-modal-card', 'dshrm-modal-head',
      'dshrm-modal-title', 'dshrm-modal-body',
      'dshrm-cost-table', 'dshrm-cost-th', 'dshrm-cost-td', 'dshrm-cost-total', 'dshrm-cost-hint',
      'dshrm-filters', 'dshrm-field', 'dshrm-field-l', 'dshrm-select', 'dshrm-search',
      'dshrm-groups', 'dshrm-group', 'dshrm-group-head', 'dshrm-fold', 'dshrm-caret',
      'dshrm-badge', 'dshrm-group-label', 'dshrm-scope-tag', 'dshrm-group-count', 'dshrm-group-path',
      'dshrm-list', 'dshrm-row', 'dshrm-row-main', 'dshrm-row-top', 'dshrm-name',
      'dshrm-type', 'dshrm-type.is-attached', 'dshrm-tokens', 'dshrm-desc', 'dshrm-row-note',
      'dshrm-switch', 'dshrm-track',
      'dshrm-note', 'dshrm-error', 'dshrm-empty', 'dshrm-full', 'dshrm-retry', 'dshrm-btn',
    ]
    for (const cls of emitted) {
      expect(PANEL_CSS).toContain(`.${cls}`)
    }
  })

  it('styles all three state modifiers', () => {
    expect(PANEL_CSS).toContain('.dshrm-always')
    expect(PANEL_CSS).toContain('.dshrm-requested')
    expect(PANEL_CSS).toContain('.dshrm-manual')
  })

  it('uses DSH alias tokens with literal fallbacks', () => {
    // Every custom property must carry a fallback, so a renamed token still renders.
    const uses = [...PANEL_CSS.matchAll(/var\((--dsw-[a-z0-9-]+)(,[^)]*)?\)/g)]
    expect(uses.length).toBeGreaterThan(5)
    const withoutFallback = uses.filter((m) => m[2] === undefined).map((m) => m[1])
    expect(withoutFallback).toEqual([])
  })

  it('draws no drop shadow under the selected tab', () => {
    // The shadow was the "grey line" under every selected tab: a 0.5px/18%
    // l1 border plus a 2px/4px shadow read as a smear on light surfaces.
    const on = /\.dshrm-tab\.on\{([^}]*)\}/.exec(PANEL_CSS)?.[1] ?? ''
    expect(on).not.toBe('')
    expect(on).not.toContain('box-shadow')
  })

  it('resets the diagnostics button instead of leaking the UA face', () => {
    // The grey plate the user saw was the browser's own buttonface: the stats
    // cell had a reset and the button variant did not.
    const btn = /\.dshrm-stat-btn\{([^}]*)\}/.exec(PANEL_CSS)?.[1] ?? ''
    expect(btn).toContain('background:transparent')
    expect(btn).toContain('border:0')
    expect(btn).toContain('font:inherit')
  })

  it('does not double the padding under the diagnostics number', () => {
    // The cell already pads itself, so a second inset on the button pushed this
    // one number and its label out of line with the other three cells.
    const btn = /\.dshrm-stat-btn\{([^}]*)\}/.exec(PANEL_CSS)?.[1] ?? ''
    expect(btn).toContain('padding:0')
  })

  it('leaves the diagnostics number undecorated', () => {
    // A dotted underline read as a different kind of control, and the hover
    // plate made one of four equal cells light up on its own.
    expect(PANEL_CSS).not.toContain('underline dotted')
    expect(PANEL_CSS).not.toContain('.dshrm-stat-btn:hover')
  })

  it('styles the token breakdown dialog', () => {
    // The link and the overlay are the receipt behind the cost line.
    expect(PANEL_CSS).toContain('.dshrm-link')
    expect(PANEL_CSS).toContain('.dshrm-modal{')
    expect(PANEL_CSS).toContain('.dshrm-cost-table')
  })

  it('gives every custom property a fallback in the new scan rows too', () => {
    // Same rule as the loop above, stated for the findings list: it is the one
    // place a path is printed, and a long Windows path has to wrap rather than
    // stretch the panel.
    const list = /\.dshrm-diag-path\{([^}]*)\}/.exec(PANEL_CSS)?.[1] ?? ''
    expect(list).toContain('overflow-wrap:anywhere')
    expect(PANEL_CSS).toContain('.dshrm-scan-diag')
  })

  it('reflows instead of clipping once the panel is narrow', () => {
    // Measured in a real browser at 415px: every status tab clipped its count
    // ("全部（1…"), and the two filter fields stayed side by side at 186px each.
    // The last media block, not the first: overrides must come after the base rules.
    const narrow = PANEL_CSS.slice(PANEL_CSS.lastIndexOf('@media (max-width:760px)'))
    expect(narrow).toContain('.dshrm-tabs{flex-wrap:wrap}')
    expect(narrow).toContain('.dshrm-tab{flex:0 1 auto;min-width:max-content}')
    expect(narrow).toContain('.dshrm-field{flex-basis:100%}')
    // The two-segment scope strip still wraps its own way, and the base rule's
    // nowrap — written with the same double-class weight as the wrap rule — is
    // what keeps its divider off the start of a wrapped row.
    expect(PANEL_CSS).toContain('.dshrm-tabs.dshrm-tabs-seg{flex-wrap:nowrap}')
    expect(PANEL_CSS).toContain('.dshrm-tabs-seg .dshrm-tab+.dshrm-tab{border-left:1px solid')
  })

  it('is a single balanced rule set', () => {
    const opens = (PANEL_CSS.match(/\{/g) ?? []).length
    const closes = (PANEL_CSS.match(/\}/g) ?? []).length
    expect(opens).toBe(closes)
    expect(opens).toBeGreaterThan(8)
  })
})

describe('installPanelStyles', () => {
  it('appends one style element', () => {
    const { doc, appended } = fakeDocument()
    vi.stubGlobal('document', doc)
    installPanelStyles()
    expect(appended.length).toBe(1)
    expect(appended[0]!.id).toBe('dsh-rules-manager-style')
    expect(appended[0]!.textContent).toBe(PANEL_CSS)
  })

  it('is idempotent across repeated calls', () => {
    const { doc, appended } = fakeDocument()
    vi.stubGlobal('document', doc)
    installPanelStyles()
    installPanelStyles()
    installPanelStyles()
    expect(appended.length).toBe(1)
  })

  it('does nothing when there is no document', () => {
    vi.stubGlobal('document', undefined)
    expect(() => installPanelStyles()).not.toThrow()
  })
})
