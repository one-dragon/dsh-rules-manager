import { describe, expect, it, vi } from 'vitest'
import { apply, fetchRules, filterRules, inject, isForcedRead, postAction, register, residentTokens, resolveText, withRefresh, withWorkspace, TEXT } from '../src/client/index.tsx'
import { RULES_ROUTE, resolveUrl, type RuleRow } from '../src/panel.ts'

/**
 * The browser half's contract and registration.
 *
 * These run under Node with a fake cordis context: the point is what the client
 * half registers and what it does with a host response, not real rendering.
 */

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  path: '/p/a.md', name: 'a', type: 'always', description: 'd',
  descriptionTokens: 1, bodyTokens: 2, bodyLength: 2, enabled: true, active: true, disabledBy: null,
  sourceKey: 'codebuddy', sourceLabel: 'CodeBuddy', scope: 'project',
  family: 'codebuddy', patterns: [], attached: false, diagnostics: [], ...over,
})

/**
 * A locale service shaped like the real one.
 *
 * The members are copied from `dsh-client-locale/src/client/index.ts`:
 * `getSnapshot()` returning `{ active, locales, revision }`, plus `register`
 * and `bind`. There is deliberately **no** `current` field — an earlier version
 * of this fixture invented one, which is exactly why the defect it hid survived
 * a green test run (HANDOFF §3.1's lesson: never mock a shape the host does not
 * have).
 */
function realLocale(active: string) {
  const dicts = new Map<string, Map<string, Record<string, string>>>()
  return {
    getSnapshot: () => ({ active, locales: [{ id: active, label: active }], revision: 1 }),
    register: (ns: string, given: Record<string, Record<string, string>>) => {
      const byLocale = new Map<string, Record<string, string>>()
      for (const [id, dict] of Object.entries(given)) byLocale.set(id, dict)
      dicts.set(ns, byLocale)
      return () => dicts.delete(ns)
    },
    // Mirrors LocaleRuntime.translate: active locale first, then the key itself.
    bind: (ns: string) => (key: string) => dicts.get(ns)?.get(active)?.[key] ?? dicts.get(ns)?.get('en')?.[key] ?? key,
  }
}

/** Minimal cordis stand-in capturing every slot registration. */
function fakeCtx(locale?: unknown) {
  const registered: Array<Record<string, unknown>> = []
  const injected: string[] = []
  const disposed: number[] = []
  const effects: number[] = []
  const callbacks: Array<() => void> = []
  const ctx = {
    slots: {
      register: (definition: Record<string, unknown>) => {
        registered.push(definition)
        return () => { disposed.push(registered.length) }
      },
      inject: (name: string, callback: () => void) => { injected.push(name); callbacks.push(callback); callback() },
    },
    get: () => locale,
    effect: (callback: () => unknown) => { effects.push(1); callback() },
  }
  // A real cordis slot re-runs an inject callback whenever its service changes.
  const rerun = (): void => { for (const callback of callbacks) callback() }
  return { ctx, registered, injected, disposed, effects, rerun }
}

describe('the loader contract', () => {
  it('exports an apply function', () => {
    // dsh-cordis-client-runner's isDynamicCordisPlugin rejects a bundle with no
    // apply, and the whole client half then never mounts.
    expect(typeof apply).toBe('function')
  })

  it('injects only slots, so a missing optional service cannot unmount it', () => {
    expect(inject).toEqual(['slots'])
    expect(inject).not.toContain('locale')
    expect(inject).not.toContain('webServer')
  })

  it('returns a disposer from apply', () => {
    const { ctx } = fakeCtx()
    const dispose = apply(ctx as never)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})

describe('registration', () => {
  it('registers the settings section and its icon under one id', () => {
    const { ctx, registered } = fakeCtx()
    register(ctx as never, (k) => k)
    const section = registered.find((r) => r['name'] === 'settings.section')
    const icon = registered.find((r) => r['name'] === 'settings.section.icon')
    expect(section?.['id']).toBe('dsh-rules-manager')
    // A mismatched icon id means no icon ever renders.
    expect(icon?.['id']).toBe(section?.['id'])
  })

  it('registers the sidebar entry and the main panel under one id', () => {
    const { ctx, registered } = fakeCtx()
    register(ctx as never, (k) => k)
    const side = registered.find((r) => r['name'] === 'sidebar.panellist')
    const main = registered.find((r) => r['name'] === 'main')
    expect(side).toBeDefined()
    // Clicking the sidebar entry renders the panel whose key matches its id.
    expect(main?.['key']).toBe(side?.['id'])
    expect(main?.['key']).toBe('dsh-rules-manager')
  })

  it('guards each registration with its slot inject', () => {
    const { ctx, injected } = fakeCtx()
    register(ctx as never, (k) => k)
    expect(injected).toEqual(['settings.section', 'settings.section.icon', 'sidebar.panellist', 'main'])
  })

  it('disposes every registration', () => {
    const { ctx, registered, disposed } = fakeCtx()
    const dispose = register(ctx as never, (k) => k)
    dispose()
    expect(disposed.length).toBe(registered.length)
  })

  it('keeps one disposer per slot when an inject callback runs again', () => {
    // Without the guard the same slot would be disposed twice, and the second
    // disposal of a live registration is how a panel goes blank.
    const { ctx, registered, disposed, rerun } = fakeCtx()
    const dispose = register(ctx as never, (k) => k)
    rerun()
    expect(registered).toHaveLength(8)
    dispose()
    // Eight registrations, four slots: every slot is disposed exactly once.
    expect(disposed).toHaveLength(4)
  })
})

describe('the host data path', () => {
  it('reads the whole document from the host route', async () => {
    const rows = [rule()]
    const sources = [{ key: 'codebuddy', label: 'CodeBuddy', scope: 'project', path: '/repo/.codebuddy/rules', enabled: true, ruleCount: 1 }]
    const doFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rules: rows, sources, scannedAt: 42 }) }))
    // The full contract, not just the list: a panel that groups by source needs
    // `sources`, and a row that must not look active needs its own fields.
    // The scan's own diagnostics and its truncation flag travel beside the
    // rules: they are about the walk, so no single row can carry them.
    expect(await fetchRules('/rules-manager/rules.json', doFetch as never))
      .toEqual({ rules: rows, sources, scannedAt: 42, diagnostics: [], truncated: false, workspace: { path: null, source: 'none' } })
  })

  it('tolerates a host that predates sources/scannedAt', async () => {
    // Backward compatibility: an older host sent {rules} only, and the panel
    // must still render its list rather than fail outright.
    const rows = [rule()]
    const doFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rules: rows }) }))
    expect(await fetchRules('/x.json', doFetch as never))
      .toEqual({ rules: rows, sources: [], scannedAt: 0, diagnostics: [], truncated: false, workspace: { path: null, source: 'none' } })
  })

  it('posts an action and returns the refreshed document', async () => {
    const rows = [rule({ enabled: false })]
    const doFetch = vi.fn(async (_url: string, init: { method?: string; body?: string }) => ({
      ok: true, status: 200,
      json: async () => ({ rules: rows, sources: [], scannedAt: 7 }),
    }))
    const out = await postAction({ action: 'setRule', key: 'codebuddy', path: '/p/a.md', enabled: false }, '/x.json', doFetch as never)
    expect(out.rules[0]?.enabled).toBe(false)
    const init = doFetch.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'setRule', key: 'codebuddy', path: '/p/a.md', enabled: false })
  })

  it('carries the tier on the wire when the action names one', async () => {
    // The same source key exists in both tiers, so the write must say which
    // one it means. The assertion above stays: an action built without a scope
    // has no own `scope` property, and JSON.stringify drops nothing extra, so
    // an old client's body is byte-identical to what it always sent.
    const doFetch = vi.fn(async (_url: string, init: { body?: string }) => ({
      ok: true, status: 200,
      json: async () => ({ rules: [], sources: [], scannedAt: 7 }),
    }))
    await postAction({ action: 'setSource', key: 'agents', enabled: false, scope: 'user' }, '/x.json', doFetch as never)
    await postAction({ action: 'setRule', key: 'agents', path: '/p/a.md', enabled: true, scope: 'project' }, '/x.json', doFetch as never)
    expect(JSON.parse(String(doFetch.mock.calls[0]?.[1]?.body)))
      .toEqual({ action: 'setSource', key: 'agents', enabled: false, scope: 'user' })
    expect(JSON.parse(String(doFetch.mock.calls[1]?.[1]?.body)))
      .toEqual({ action: 'setRule', key: 'agents', path: '/p/a.md', enabled: true, scope: 'project' })
  })

  it('rejects a failed write instead of reporting success', async () => {
    const doFetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }))
    await expect(postAction({ action: 'setSource', key: 'codebuddy', enabled: false }, '/x.json', doFetch as never))
      .rejects.toThrow('400')
  })

  it('rejects a failed response instead of rendering it', async () => {
    const doFetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    await expect(fetchRules('/x.json', doFetch as never)).rejects.toThrow('500')
  })

  it('rejects a payload that is not a rules list', async () => {
    // The host is a process boundary, so the shape is checked, not trusted.
    const doFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }))
    await expect(fetchRules('/x.json', doFetch as never)).rejects.toThrow('not a list')
  })

  it('reports a missing fetch rather than throwing synchronously', async () => {
    // The default parameter reads the global, so removing it is what exercises
    // the guard (passing `undefined` explicitly would just re-read the global).
    vi.stubGlobal('fetch', undefined)
    try {
      await expect(fetchRules('/x.json')).rejects.toThrow('no fetch')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('route resolution', () => {
  it('is the /api-prefixed path the host registers', () => {
    // connection.fetch validates the path with endpointFromPath(API_PATH, path),
    // which rejects anything not starting with '/api/'.
    expect(RULES_ROUTE.startsWith('/api/')).toBe(true)
  })

  it('resolves against the document base, keeping the mount directory', () => {
    expect(resolveUrl('/api/rules-manager/rules.json', 'http://127.0.0.1:60655/?token=abc'))
      .toBe('http://127.0.0.1:60655/api/rules-manager/rules.json')
  })

  it('keeps a sub-path mount point', () => {
    // A bare fetch('/api/..') would drop '/gui/' and miss the route entirely.
    expect(resolveUrl('/api/rules-manager/rules.json', 'http://127.0.0.1:60655/gui/index.html'))
      .toBe('http://127.0.0.1:60655/gui/api/rules-manager/rules.json')
  })

  it('works from a file:// document (Electron)', () => {
    expect(resolveUrl('/api/rules-manager/rules.json', 'file:///C:/app/index.html'))
      .toBe('file:///C:/app/api/rules-manager/rules.json')
  })

  it('passes a path through unchanged when no base is available', () => {
    expect(resolveUrl('/api/x.json', '')).toBe('/api/x.json')
    expect(resolveUrl('/api/x.json', 'not a url')).toBe('/api/x.json')
  })

  it('does not rewrite protocol-relative or relative paths', () => {
    expect(resolveUrl('//host/x', 'http://a/b/')).toBe('//host/x')
    expect(resolveUrl('x/y', 'http://a/b/')).toBe('x/y')
  })

  it('fetches the resolved absolute URL', async () => {
    const doFetch = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ rules: [] }) }))
    await fetchRules(RULES_ROUTE, doFetch as never)
    // Under Node there is no document, so the path stays as-is; the point is
    // that fetchRules goes through resolveUrl rather than hitting the raw string.
    expect(doFetch.mock.calls[0]?.[0]).toBe(RULES_ROUTE)
  })
})

describe('workspace selection', () => {
  it('carries the chosen directory on the route', () => {
    // The host reads this parameter; without it a switch would be a no-op.
    expect(withWorkspace('/api/rules-manager/rules.json', 'D:/repo b')).toBe('/api/rules-manager/rules.json?workspace=D%3A%2Frepo%20b')
    expect(withWorkspace('/api/x.json?a=1', 'D:/repo')).toBe('/api/x.json?a=1&workspace=D%3A%2Frepo')
  })

  it('asks the host to skip its caches only when a refresh is asked for', async () => {
    // The host answers a repeated read from a 30-second slot, which is what made
    // the Refresh button look dead: same bytes, same timestamp.
    expect(withRefresh('/api/rules-manager/rules.json')).toBe('/api/rules-manager/rules.json?refresh=1')
    expect(withRefresh('/x.json?a=1')).toBe('/x.json?a=1&refresh=1')

    const doFetch = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ rules: [] }) }))
    await fetchRules('/x.json', doFetch as never, 'D:/repo', true)
    expect(doFetch.mock.calls[0]?.[0]).toBe('/x.json?workspace=D%3A%2Frepo&refresh=1')
    await fetchRules('/x.json', doFetch as never)
    // An ordinary read is unchanged, so the cache still does its job.
    expect(doFetch.mock.calls[1]?.[0]).toBe('/x.json')
  })

  it('only calls a read forced when the click has not been served yet', () => {
    // The defect: the tick was bumped before the state changed, so this
    // comparison was always false. A refresh then never sent ?refresh=1, and
    // every click blanked the panel into the loading state instead.
    expect(isForcedRead(1, 0)).toBe(true)
    expect(isForcedRead(1, 1)).toBe(false)
    // Two clicks in a row stay two forced reads.
    expect(isForcedRead(2, 1)).toBe(true)
    expect(isForcedRead(0, 0)).toBe(false)
  })

  it('leaves the route alone when no workspace was chosen', () => {
    // The host's own choice stays the default, so nothing changes for a panel
    // that never showed a switch.
    expect(withWorkspace('/api/x.json', null)).toBe('/api/x.json')
    expect(withWorkspace('/api/x.json', '')).toBe('/api/x.json')
  })

  it('sends the chosen workspace with a read and a write', async () => {
    const doFetch = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ rules: [] }) }))
    await fetchRules('/x.json', doFetch as never, 'D:/repo')
    expect(doFetch.mock.calls[0]?.[0]).toBe('/x.json?workspace=D%3A%2Frepo')
    await postAction({ action: 'setSource', key: 'cursor', enabled: false }, '/x.json', doFetch as never, 'D:/repo')
    expect(doFetch.mock.calls[1]?.[0]).toBe('/x.json?workspace=D%3A%2Frepo')
  })
})

describe('panel helpers', () => {
  it('filters by name and description, case-insensitively', () => {
    const rows = [rule({ name: 'TsStandard', path: '/a' }), rule({ name: 'b', description: 'when editing CSS', path: '/b' })]
    expect(filterRules(rows, '').length).toBe(2)
    expect(filterRules(rows, 'tsstan').map((r) => r.name)).toEqual(['TsStandard'])
    expect(filterRules(rows, 'css').map((r) => r.name)).toEqual(['b'])
  })

  it('counts only enabled always-on rules as resident', () => {
    const rows = [
      rule({ type: 'always', descriptionTokens: 10, enabled: true }),
      rule({ type: 'always', descriptionTokens: 10, enabled: false, path: '/c' }),
      rule({ type: 'requested', descriptionTokens: 10, path: '/d' }),
    ]
    expect(residentTokens(rows)).toBe(10)
  })
})

describe('locale resolution', () => {
  it('uses the bundled table when no locale service exists', () => {
    const { ctx } = fakeCtx(undefined)
    expect(resolveText(ctx as never, 'title')).toBe(TEXT.en['title'])
  })

  it('never throws when the service is missing entirely', () => {
    // ctx.get is optional-called, so a context without it must still answer.
    const bare = { slots: { register: () => () => {}, inject: (_n: string, cb: () => void) => cb() } }
    expect(typeof resolveText(bare as never, 'title')).toBe('string')
  })

  it('falls back to the key for an unknown string', () => {
    const { ctx } = fakeCtx(undefined)
    expect(resolveText(ctx as never, 'nope')).toBe('nope')
  })

  it('carries every key in both languages', () => {
    expect(Object.keys(TEXT.zh).sort()).toEqual(Object.keys(TEXT.en).sort())
  })

  it('keeps every locale value complete and aligned', () => {
    // The key-set check above is blind to the value layer: a translation that is
    // empty, that silently drops a {token}, or that degenerates into its
    // own key name still renders and still passes. Assert the values themselves.
    const placeholders = (value: string) => [...new Set(value.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])].sort()
    const keys = Object.keys(TEXT.en)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      const en = TEXT.en[key]!
      const zh = TEXT.zh[key]!
      expect(typeof en === 'string' && en.length > 0, `en value for "${key}"`).toBe(true)
      expect(typeof zh === 'string' && zh.length > 0, `zh value for "${key}"`).toBe(true)
      expect(placeholders(zh), `placeholders for "${key}"`).toEqual(placeholders(en))
      expect(en, `en value for "${key}" repeats its key`).not.toBe(key)
      expect(zh, `zh value for "${key}" repeats its key`).not.toBe(key)
    }
  })

  it('distinguishes Chinese from English through the real service shape', () => {
    // The discriminating assertion: the two locales must produce *different*
    // text, which the old fixture ({current:'zh'}) could never have caught
    // because the implementation read a field the host does not have.
    const zh = fakeCtx(realLocale('zh'))
    const en = fakeCtx(realLocale('en'))
    expect(resolveText(zh.ctx as never, 'title')).toBe(TEXT.zh['title'])
    expect(resolveText(en.ctx as never, 'title')).toBe(TEXT.en['title'])
    expect(TEXT.zh['title']).not.toBe(TEXT.en['title'])
  })

  it('reads the active locale from getSnapshot when bind is unavailable', () => {
    // Fallback path: an older or partial service still resolves the language.
    const snapshotOnly = { getSnapshot: () => ({ active: 'zh', locales: [], revision: 1 }) }
    expect(resolveText(fakeCtx(snapshotOnly).ctx as never, 'title')).toBe(TEXT.zh['title'])
  })

  it('registers its dictionaries through the locale service', () => {
    // The official pattern (ui-sidebar does the same): publish the namespace
    // once, inside ctx.effect, so unload removes it.
    const { ctx, effects } = fakeCtx(realLocale('en'))
    apply(ctx as never)()
    expect(effects.length).toBe(1)
  })

  it('prefers the host translator over the bundled table', () => {
    // A dictionary the host owns the lookup for: bind answers, and the answer
    // must win over our own table.
    const { ctx } = fakeCtx(realLocale('zh'))
    apply(ctx as never)()
    expect(resolveText(ctx as never, 'title')).toBe(TEXT.zh['title'])
  })
})
