import { afterEach, describe, expect, it, vi } from 'vitest'
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
  // Named, not counted: the location decides *which* pair of slots goes, and a
  // bare count cannot tell a correct trim from a swapped one.
  const disposed: string[] = []
  const effects: number[] = []
  const callbacks: Array<() => void> = []
  const ctx = {
    slots: {
      register: (definition: Record<string, unknown>) => {
        registered.push(definition)
        return () => { disposed.push(String(definition['name'])) }
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

describe('the entry location decides which slots survive', () => {
  // Every panel is registered into all four slots before the host is asked
  // where the entry belongs, so the first paint can never be a panel with no
  // way to reach it. The answer then retires the slots the location excludes,
  // and nothing else: an unanswered, refused or unreadable route leaves the
  // default layout in place.
  const drain = async (): Promise<void> => {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const boot = async (answer: () => Promise<unknown>): Promise<{ disposed: string[]; rerun: () => void }> => {
    vi.stubGlobal('fetch', answer)
    try {
      const fake = fakeCtx()
      register(fake.ctx as never, (k) => k)
      await drain()
      return { disposed: fake.disposed, rerun: fake.rerun }
    } finally {
      vi.unstubAllGlobals()
    }
  }

  const answerWith = (body: unknown) => async (): Promise<unknown> => ({ ok: true, status: 200, json: async () => body })

  it('retires the two slots a settings-only location excludes', async () => {
    const { disposed } = await boot(answerWith({ entryLocation: 'settings' }))
    // settings.section and its icon stay; the sidebar entry and its main panel
    // are the two that must go, so exactly those two disposers run.
    expect([...disposed].sort()).toEqual(['main', 'sidebar.panellist'])
  })

  it('retires the settings slots when the entry belongs in the sidebar', async () => {
    const { disposed } = await boot(answerWith({ entryLocation: 'sidebar' }))
    expect([...disposed].sort()).toEqual(['settings.section', 'settings.section.icon'])
  })

  it('keeps every slot when the answer is missing, refused or unreadable', async () => {
    // Each of these leaves the panel reachable from both places, which is the
    // state a host that never heard of the route would render anyway.
    const cases: Array<() => Promise<unknown>> = [
      answerWith({ rules: [] }),
      answerWith({ entryLocation: 'everywhere' }),
      answerWith({ entryLocation: 'both' }),
      // A body that is not even an object: read as "no answer", not as a
      // reason to hide an entry.
      answerWith('nope'),
      answerWith(null),
      async () => ({ ok: false, status: 404, json: async () => ({}) }),
      async () => { throw new Error('the host hung up') },
    ]
    for (const answer of cases) {
      const { disposed } = await boot(answer)
      expect(disposed).toHaveLength(0)
    }
  })

  it('does not resurrect a retired slot when the inject callbacks run again', async () => {
    // The host re-runs an inject callback whenever its service changes. A slot
    // that was retired because the location excludes it must not come back on
    // the next run, or the panel would drift back to both entries.
    const { disposed, rerun } = await boot(answerWith({ entryLocation: 'settings' }))
    expect(disposed).toHaveLength(2)
    rerun()
    await drain()
    expect(disposed).toHaveLength(4)
  })

  it('survives a registration that hands back no disposer at all', async () => {
    // Cordis's register always answers with a disposer, but the panel does not
    // rely on that: a slot whose registration answered with something else must
    // still be remembered as hidden, or the next inject run would put the entry
    // back exactly where the user asked it not to be.
    const names: string[] = []
    const ctx = {
      slots: {
        register: (definition: Record<string, unknown>): undefined => { names.push(String(definition['name'])); return undefined },
        inject: (_name: string, callback: () => void): void => { callback() },
      },
      get: () => undefined,
      effect: (callback: () => unknown): void => { callback() },
    }
    vi.stubGlobal('fetch', answerWith({ entryLocation: 'settings' }))
    try {
      expect(() => register(ctx as never, (key) => key)).not.toThrow()
      await drain()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(names).toEqual(['settings.section', 'settings.section.icon', 'sidebar.panellist', 'main'])
  })

  it('reads the location inline where the host has no timer to defer it with', async () => {
    // The deferred read exists so register() has returned before its own
    // disposer can mean anything. A host without setTimeout still has to learn
    // the location - the read just happens in the same turn.
    const original = globalThis.setTimeout
    const fake = fakeCtx()
    vi.stubGlobal('fetch', answerWith({ entryLocation: 'settings' }))
    try {
      vi.stubGlobal('setTimeout', undefined)
      register(fake.ctx as never, (key) => key)
    } finally {
      vi.stubGlobal('setTimeout', original)
      vi.unstubAllGlobals()
    }
    await drain()
    expect(fake.disposed).toHaveLength(2)
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
      .toEqual({ rules: rows, sources, scannedAt: 42, diagnostics: [], truncated: false, workspace: { path: null, source: 'none' }, entryLocation: 'both' })
  })

  it('tolerates a host that predates sources/scannedAt', async () => {
    // Backward compatibility: an older host sent {rules} only, and the panel
    // must still render its list rather than fail outright.
    const rows = [rule()]
    const doFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rules: rows }) }))
    expect(await fetchRules('/x.json', doFetch as never))
      .toEqual({ rules: rows, sources: [], scannedAt: 0, diagnostics: [], truncated: false, workspace: { path: null, source: 'none' }, entryLocation: 'both' })
  })

  it('falls back to both when the host sends a location this build does not know', async () => {
    // A host from a future version may name a location this build has never
    // heard of. Rendering it verbatim would put the control in a state no
    // button matches, so the read is narrowed once, at the boundary.
    const rows = [rule()]
    const strange = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rules: rows, entryLocation: 'everywhere' }) }))
    const numeric = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rules: rows, entryLocation: 7 }) }))
    expect((await fetchRules('/x.json', strange as never)).entryLocation).toBe('both')
    expect((await fetchRules('/x.json', numeric as never)).entryLocation).toBe('both')
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

  it('posts an entry location change as its own action', async () => {
    // The location is neither a rule nor a source, so it travels under its own
    // action name: a host that predates it answers 400 instead of silently
    // writing a switch it does not understand.
    const doFetch = vi.fn(async (_url: string, init: { body?: string }) => ({
      ok: true, status: 200,
      json: async () => ({ rules: [], sources: [], scannedAt: 7, entryLocation: 'sidebar' }),
    }))
    const out = await postAction({ action: 'setEntry', location: 'sidebar' }, '/x.json', doFetch as never)
    expect(out.entryLocation).toBe('sidebar')
    expect(JSON.parse(String(doFetch.mock.calls[0]?.[1]?.body))).toEqual({ action: 'setEntry', location: 'sidebar' })
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

describe('route resolution against the document it runs in', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves an absolute route against document.baseURI when no base is given', () => {
    // The parameter exists so the rule can be tested without a DOM; this case
    // is the other half: the panel calls `resolveUrl(path)` with no base at
    // all, so the answer has to come from the document it runs in. The
    // stand-in document is the same shape tests/styles.spec.ts uses.
    vi.stubGlobal('document', { baseURI: 'http://127.0.0.1:60655/gui/' })
    expect(resolveUrl(RULES_ROUTE)).toBe('http://127.0.0.1:60655/gui' + RULES_ROUTE)
  })

  it('keeps a mount point whose last segment is not a file name', () => {
    // A GUI served under `/gui` has no dot in its last segment, and the route
    // must land under `/gui/` rather than replacing that segment.
    expect(resolveUrl('/api/rules-manager/rules.json', 'http://127.0.0.1:60655/gui'))
      .toBe('http://127.0.0.1:60655/gui/api/rules-manager/rules.json')
    expect(resolveUrl('/api/x', 'file:///C:/app/gui')).toBe('file:///C:/app/gui/api/x')
  })
})

