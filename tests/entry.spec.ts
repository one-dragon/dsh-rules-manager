import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { Config, type Config as RulesManagerConfig } from '../src/config.ts'
import { RULES_ROUTE } from '../src/panel.ts'
import { defaultState, setStateDir, statePath, writeState } from '../src/state.ts'

/**
 * Entry-point tests: `apply` is the only code the host calls directly, so its
 * registration and injection behavior is tested against a fake cordis context
 * rather than left to the real-machine run.
 */

/**
 * Minimal stand-in for the cordis Context the entry point uses.
 *
 * `sessionDir` is what the fake `workingDirectory` service reports. It is a
 * parameter rather than a `process.cwd` spy on purpose: the entry point must
 * resolve the scan root from the session directory, and a test that stubbed
 * `process.cwd` would pass even if the code read the wrong one.
 */
function fakeContext(sessionDir: string = project) {
  const registered: unknown[] = []
  const listeners: Array<(payload: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
  /**
   * Handlers registered for `tools/result`, the touch observer.
   *
   * Kept apart from `listeners` because the two are dispatched differently: the
   * pre-step hook answers with a decision, while `tools/result` is a contained
   * notification whose return value nobody reads. A fake that filed both under
   * one name would hide the difference the entry point depends on.
   */
  const results: Array<(exec: unknown, result: unknown) => unknown> = []
  const ensure = vi.fn(() => Promise.resolve(sessionDir))
  const ctx = {
    tools: { register: vi.fn((tool: unknown) => { registered.push(tool) }) },
    on: vi.fn((event: string, handler: never) => {
      if (event === 'agent/pre-step') listeners.push(handler)
      if (event === 'tools/result') results.push(handler)
    }),
    workingDirectory: { ensure },
  }
  return { ctx, registered, listeners, results, ensure }
}

/**
 * Resolve the config the way the host does, but **point state at the fixture
 * home**.
 *
 * The schemastery default for `stateDir` is the real `~/.dsh/rules-manager`,
 * which is non-empty, so `apply` always calls `setStateDir` with it and the
 * `DSH_RULES_MANAGER_HOME` variable is overridden. Without this override a test
 * that writes state would write into the developer's own settings — which is
 * exactly what happened before this was pinned down.
 */
function resolveConfig(value: Record<string, unknown> = {}): RulesManagerConfig {
  return (Config as unknown as (v: unknown) => RulesManagerConfig)({ stateDir: home, ...value })
}

let home: string
let project: string
const prev = process.env['DSH_RULES_MANAGER_HOME']

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dshrm-entry-home-'))
  project = await mkdtemp(join(tmpdir(), 'dshrm-entry-proj-'))
  process.env['DSH_RULES_MANAGER_HOME'] = home
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
  await writeFile(join(project, '.codebuddy', 'rules', 'always.mdc'),
    '---\ndescription: discipline\nalwaysApply: true\n---\nALWAYS BODY\n', 'utf8')
  await writeFile(join(project, '.codebuddy', 'rules', 'ondemand.mdc'),
    '---\ndescription: for TS edits\nalwaysApply: false\n---\nONDEMAND BODY\n', 'utf8')
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (prev === undefined) delete process.env['DSH_RULES_MANAGER_HOME']
  else process.env['DSH_RULES_MANAGER_HOME'] = prev
  await rm(home, { recursive: true, force: true })
  await rm(project, { recursive: true, force: true })
})

describe('apply — the host route that feeds the browser panel', () => {
/**
   * A fake ctx that can serve `ctx.get`, `ctx.inject` and `ctx.effect`.
   *
   * `inject` runs its callback when every named service is present, and again
   * whenever they change — the documented late-binding contract. `lateServices`
   * models the case that matters here: Connection mounts *after* apply runs.
   */
  function webContext(
    services: Record<string, unknown>,
    sessionDir: string = project,
    lateServices: Record<string, unknown> = {},
  ) {
    const effects: Array<() => void> = []
    const available: Record<string, unknown> = { ...services }
    const ctx = {
      tools: { register: () => {} },
      on: () => {},
      workingDirectory: { ensure: () => Promise.resolve(sessionDir) },
      get: (name: string) => available[name],
      effect: (callback: () => unknown) => {
        const result = callback()
        if (typeof result === 'function') effects.push(result as () => void)
      },
      /**
       * Mirrors cordis: the callback receives a *scoped* context whose service
       * names are properties (official usage is ctx.inject(['webServer'], (w) =>
       * w.webServer.register(...))), and it runs now if satisfied, otherwise
       * when the named service arrives.
       */
      inject: (names: string[], callback: (scoped: unknown) => void) => {
        const scoped = () => Object.assign(Object.create(null), ctx, available)
        const run = () => {
          if (names.every((n) => available[n] !== undefined)) callback(scoped())
        }
        run()
        if (names.some((n) => available[n] === undefined)) {
          for (const [name, value] of Object.entries(lateServices)) {
            available[name] = value
            if (name === names[0]) run()
          }
        }
      },
    }
    return { ctx, effects }
  }

  /** Same fake, but exposing the pre-step listener so a scan can run. */
  function webContextListeners(services: Record<string, unknown>, sessionDir: string = project) {
    const listeners: Array<(payload: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
    const results: Array<(exec: unknown, result: unknown) => unknown> = []
    const effects: Array<() => void> = []
    let scanCtx: Record<string, unknown> = {}
    const ctx: Record<string, unknown> = {
      tools: { register: () => {} },
      on: (event: string, handler: never) => {
        if (event === 'agent/pre-step') listeners.push(handler)
        if (event === 'tools/result') results.push(handler)
      },
      workingDirectory: { ensure: () => Promise.resolve(sessionDir) },
      get: (name: string) => services[name],
      effect: (callback: () => unknown) => { const r = callback(); if (typeof r === 'function') effects.push(r as () => void) },
      inject: (names: string[], callback: (scoped: unknown) => void) => {
        const scoped = () => Object.assign(Object.create(null), ctx, services)
        if (names.every((n) => services[n] !== undefined)) callback(scoped())
      },
    }
    void scanCtx
    return { ctx, results, listeners, effects }
  }

  function connectionStub() {
    const routes: Array<Record<string, unknown>> = []
    return {
      routes,
      service: {
        fetch: {
          register: (route: Record<string, unknown>) => {
            routes.push(route)
            return () => {}
          },
        },
      },
    }
  }

  it('registers exactly one exact Fetch route on connection', () => {
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    expect(conn.routes.length).toBe(1)
  })

  it('declares the route the client actually fetches, under /api', () => {
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const route = conn.routes[0]!
    // connection.fetch validates with endpointFromPath(API_PATH, path); anything
    // without the prefix throws. This is also what the panel requests.
    expect(route['path']).toBe(RULES_ROUTE)
    expect(String(route['path']).startsWith('/api/')).toBe(true)
  })

  it('declares GET, buffered, and a Fetch-shaped handler', () => {
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const route = conn.routes[0]!
    expect(route['methods']).toEqual(['GET', 'POST'])
    expect(route['requestBody']).toBe('buffered')
    // A node:http (req,res) handler here would never be called by the registry.
    expect(typeof route['fetch']).toBe('function')
    expect((route['fetch'] as unknown[]).length).toBeLessThanOrEqual(1)
  })

  it('answers a real Response with the documented JSON envelope', async () => {
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const fetch = conn.routes[0]!['fetch'] as () => Promise<Response>
    const response = await fetch()
    const body = await response.json() as { rules: unknown[] }
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(Array.isArray(body.rules)).toBe(true)
  })

  it('serves rows whose fields match the client RuleRow exactly', async () => {
    // Drive a real scan through the pre-step listener, then read the route: the
    // envelope must be populated, and every row must carry exactly the fields
    // the browser panel reads — no missing, no extra.
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'route-row.mdc'),
      '---\ndescription: for the panel\nalwaysApply: true\n---\nROW BODY\n', 'utf8')

    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({ connection: conn.service })
    apply(ctx as never, resolveConfig())

    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )

    const route = conn.routes[0]!
    const response = await (route['fetch'] as () => Promise<Response>)()
    const body = await response.json() as { rules: Array<Record<string, unknown>> }
    expect(body.rules.length).toBeGreaterThan(0)

    // The exact field set the panel's RuleRow declares.
    const expected = [
      'active', 'attached', 'bodyLength', 'bodyTokens', 'description', 'descriptionTokens',
      'diagnostics', 'disabledBy', 'enabled', 'family', 'name', 'path', 'patterns', 'scope',
      'sourceKey', 'sourceLabel', 'type',
    ]
    for (const row of body.rules) {
      expect(Object.keys(row).sort()).toEqual(expected)
      expect(typeof row['path']).toBe('string')
      expect(typeof row['enabled']).toBe('boolean')
      expect(['always', 'requested', 'manual']).toContain(row['type'])
      expect(['user', 'project']).toContain(row['scope'])
      expect(Array.isArray(row['patterns'])).toBe(true)
      expect(Array.isArray(row['diagnostics'])).toBe(true)
      // A session view, not a file property: the panel reads it as a boolean on
      // every row, so a missing field would render as "not attached" silently.
      expect(typeof row['attached']).toBe('boolean')
    }
  })

  it('serves the sources segment with each root\'s real absolute path', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'src-row.mdc'),
      '---\ndescription: d\nalwaysApply: true\n---\nB\n', 'utf8')

    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )

    const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
      rules: Array<Record<string, unknown>>
      sources: Array<Record<string, unknown>>
      scannedAt: number
    }
    // The project root is where the fixture rule lives, and its path is real.
    const projectSource = body.sources.find((s) => s['scope'] === 'project' && s['key'] === 'codebuddy')
    expect(projectSource?.['path']).toBe(join(project, '.codebuddy', 'rules'))
    expect(projectSource?.['label']).toBe('CodeBuddy')
    expect(projectSource?.['ruleCount']).toBeGreaterThan(0)
    expect(typeof body.scannedAt).toBe('number')
    expect(body.scannedAt).toBeGreaterThan(0)
  })

  it('marks a project rule as project scope and a user rule as user scope', async () => {
    // The scope is carried from the scan root, so both tiers are exercised.
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'scoped.mdc'),
      '---\ndescription: d\nalwaysApply: true\n---\nB\n', 'utf8')
    const userHome = await mkdtemp(join(tmpdir(), 'dshrm-user-root-'))
    try {
      await mkdir(join(userHome, 'rules'), { recursive: true })
      // .agents is strict: a .md without a trigger is discarded by design.
      await writeFile(join(userHome, 'rules', 'u.md'),
        '---\ntrigger: always_on\ndescription: u\n---\nU\n', 'utf8')
      const prev = process.env['DSH_AGENTS_HOME']
      process.env['DSH_AGENTS_HOME'] = userHome
      try {
        const conn = connectionStub()
        const { ctx, listeners } = webContextListeners({ connection: conn.service })
        apply(ctx as never, resolveConfig())
        const claimed = { content: [{ type: 'text', text: 'hi' }] }
        await listeners[0]!(
          { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
          () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
        )
        const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
          rules: Array<Record<string, unknown>>
        }
        const projectRule = body.rules.find((r) => r['name'] === 'scoped')
        const userRule = body.rules.find((r) => r['name'] === 'u')
        expect(projectRule?.['scope']).toBe('project')
        expect(userRule?.['scope']).toBe('user')
        // The fields the panel groups by must be present on every row.
        expect(projectRule?.['sourceKey']).toBe('codebuddy')
        expect(projectRule?.['sourceLabel']).toBe('CodeBuddy')
        expect(userRule?.['sourceKey']).toBe('agents')
      } finally {
        if (prev === undefined) delete process.env['DSH_AGENTS_HOME']
        else process.env['DSH_AGENTS_HOME'] = prev
      }
    } finally {
      await rm(userHome, { recursive: true, force: true })
    }
  })

  /** POST one action at the route and return the parsed response. */
  async function post(route: Record<string, unknown>, action: unknown) {
    const fetch = route['fetch'] as (req: Request) => Promise<Response>
    return fetch(new Request('http://localhost/api/rules-manager/rules.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action),
    }))
  }

  /**
   * Seed the `agents` source in BOTH tiers.
   *
   * It is the only source whose user root a test can redirect: its path is
   * resolved from DSH_AGENTS_HOME at scan time, while codebuddy/cursor/claude
   * freeze `join(homedir(), ...)` at import. Both tiers use the key `agents`,
   * which is exactly the collision scoping has to survive.
   */
  async function withTwoTierAgents(
    run: (fixture: { userRule: string; projectRule: string }) => Promise<void>,
  ): Promise<void> {
    const prevAgents = process.env['DSH_AGENTS_HOME']
    const userHome = await mkdtemp(join(tmpdir(), 'dshrm-agents-root-'))
    try {
      await mkdir(join(userHome, 'rules'), { recursive: true })
      const userRule = join(userHome, 'rules', 'tier-user.md')
      // .agents is strict: a .md with no trigger is discarded by design.
      await writeFile(userRule, '---\ntrigger: always_on\ndescription: u\n---\nU BODY\n', 'utf8')
      await mkdir(join(project, '.agents', 'rules'), { recursive: true })
      const projectRule = join(project, '.agents', 'rules', 'tier-project.md')
      await writeFile(projectRule, '---\ntrigger: always_on\ndescription: p\n---\nP BODY\n', 'utf8')
      process.env['DSH_AGENTS_HOME'] = userHome
      await run({ userRule, projectRule })
    } finally {
      if (prevAgents === undefined) delete process.env['DSH_AGENTS_HOME']
      else process.env['DSH_AGENTS_HOME'] = prevAgents
      await rm(userHome, { recursive: true, force: true })
    }
  }

  /** Force the host's first scan so the route has a workspace to report. */
  async function firstScan(
    listeners: Array<(payload: unknown, next: () => Promise<unknown>) => Promise<unknown>>,
  ): Promise<void> {
    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )
  }

  it('declares GET and POST on the route', () => {
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    expect(conn.routes[0]!['methods']).toEqual(['GET', 'POST'])
  })

  it('setSource writes state.json and does not touch external rule files', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    const ruleFile = join(project, '.codebuddy', 'rules', 'w.mdc')
    await writeFile(ruleFile, '---\ndescription: d\nalwaysApply: true\n---\nB\n', 'utf8')
    const before = (await stat(ruleFile)).mtimeMs

    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const response = await post(conn.routes[0]!, { action: 'setSource', key: 'codebuddy', enabled: false })
    expect(response.status).toBe(200)

    // The state file must be the fixture's, never the developer's.
    expect(statePath()).toContain(home)
    const saved = JSON.parse(await readFile(statePath(), 'utf8')) as { sources: Record<string, boolean> }
    expect(saved.sources['codebuddy']).toBe(false)
    // The read-only promise: the rule file itself is untouched.
    expect((await stat(ruleFile)).mtimeMs).toBe(before)
  })

  it('setRule toggles one rule and round-trips through state.json', async () => {
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const target = join(project, '.codebuddy', 'rules', 'w2.mdc')

    await post(conn.routes[0]!, { action: 'setRule', key: 'codebuddy', path: target, enabled: false })
    let saved = JSON.parse(await readFile(statePath(), 'utf8')) as { disabled: Record<string, string[]> }
    expect(saved.disabled['codebuddy']).toContain(target)

    // Re-enabling removes it rather than accumulating duplicates.
    await post(conn.routes[0]!, { action: 'setRule', key: 'codebuddy', path: target, enabled: true })
    saved = JSON.parse(await readFile(statePath(), 'utf8')) as { disabled: Record<string, string[]> }
    expect(saved.disabled['codebuddy'] ?? []).not.toContain(target)
  })

  it('serializes two concurrent writes so neither loses the other', async () => {
    // Both POSTs used to read the same state.json, and the later rename dropped
    // the earlier toggle: the write is a read-modify-write and had to be queued.
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())

    const [first, second] = await Promise.all([
      post(conn.routes[0]!, { action: 'setSource', key: 'codebuddy', enabled: false }),
      post(conn.routes[0]!, { action: 'setSource', key: 'cursor', enabled: false }),
    ])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const saved = JSON.parse(await readFile(statePath(), 'utf8')) as { sources: Record<string, boolean> }
    expect(saved.sources['codebuddy']).toBe(false)
    expect(saved.sources['cursor']).toBe(false)
  })

  it('keeps one source key\'s two tiers independent on a scoped switch', async () => {
    // The defect: state.json keyed switches by the bare source key, so toggling
    // ~/.agents/rules also flipped <project>/.agents/rules.
    await withTwoTierAgents(async ({ userRule, projectRule }) => {
      const conn = connectionStub()
      const { ctx, listeners } = webContextListeners({ connection: conn.service })
      apply(ctx as never, resolveConfig())
      await firstScan(listeners)

      await post(conn.routes[0]!, { action: 'setSource', key: 'agents', enabled: false, scope: 'user' })

      const saved = JSON.parse(await readFile(statePath(), 'utf8')) as { sources: Record<string, boolean> }
      // The scoped key is the one written; the legacy bare key is never created.
      expect(saved.sources['user:agents']).toBe(false)
      expect(saved.sources['project:agents']).toBeUndefined()
      expect(saved.sources['agents']).toBeUndefined()

      const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
        rules: Array<Record<string, unknown>>
        sources: Array<Record<string, unknown>>
      }
      const userSource = body.sources.find((s) => s['key'] === 'agents' && s['scope'] === 'user')
      const projectSource = body.sources.find((s) => s['key'] === 'agents' && s['scope'] === 'project')
      expect(userSource?.['enabled']).toBe(false)
      expect(projectSource?.['enabled']).toBe(true)
      // Same file name in neither tier: the rows are told apart by tier alone.
      expect(body.rules.find((r) => r['path'] === userRule)?.['active']).toBe(false)
      expect(body.rules.find((r) => r['path'] === projectRule)?.['active']).toBe(true)
    })
  })

  it("a scoped rule write materialises only that tier's list", async () => {
    // A scoped write replaces the whole list under its key, so it must start
    // from that tier's effective list - an empty start would silently re-enable
    // every other rule the tier had switched off.
    await withTwoTierAgents(async ({ userRule, projectRule }) => {
      const conn = connectionStub()
      const { ctx, listeners } = webContextListeners({ connection: conn.service })
      apply(ctx as never, resolveConfig())
      await firstScan(listeners)

      await post(conn.routes[0]!, { action: 'setRule', key: 'agents', path: projectRule, enabled: false, scope: 'project' })
      await post(conn.routes[0]!, { action: 'setRule', key: 'agents', path: userRule, enabled: false, scope: 'user' })

      const saved = JSON.parse(await readFile(statePath(), 'utf8')) as { disabled: Record<string, string[]> }
      expect(saved.disabled['project:agents']).toEqual([projectRule])
      expect(saved.disabled['user:agents']).toEqual([userRule])

      const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
        rules: Array<Record<string, unknown>>
      }
      expect(body.rules.find((r) => r['path'] === userRule)?.['disabledBy']).toBe('state')
      expect(body.rules.find((r) => r['path'] === projectRule)?.['disabledBy']).toBe('state')
    })
  })

  it('still honours a legacy bare entry when no scoped one exists', async () => {
    // A state.json written before scoping must keep working untouched.
    await withTwoTierAgents(async ({ userRule, projectRule }) => {
      // Point state at this fixture before seeding: a previous case in this
      // file already pinned the module-level dir to its own (now deleted) home.
      setStateDir(home)
      await writeState({ ...defaultState(), disabled: { agents: [userRule] } })

      const conn = connectionStub()
      const { ctx, listeners } = webContextListeners({ connection: conn.service })
      apply(ctx as never, resolveConfig())
      await firstScan(listeners)

      const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
        rules: Array<Record<string, unknown>>
        sources: Array<Record<string, unknown>>
      }
      // No scoped entry exists, so both tiers fall back to the bare list.
      expect(body.rules.find((r) => r['path'] === userRule)?.['disabledBy']).toBe('state')
      expect(body.rules.find((r) => r['path'] === projectRule)?.['active']).toBe(true)
      expect(body.sources.find((s) => s['key'] === 'agents')?.['enabled']).toBe(true)
    })
  })

  it('rejects a malformed or unknown action without writing state', async () => {
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    for (const bad of [{ action: 'nope', key: 'codebuddy', enabled: false }, { action: 'setSource' }, 'not-an-object']) {
      const response = await post(conn.routes[0]!, bad)
      expect(response.status).toBe(400)
      expect((await response.json() as { ok: boolean }).ok).toBe(false)
    }
  })

  it('reflects a write on the next GET, despite the rescan interval', async () => {
    // The measured trap: loadFor caches for RESCAN_INTERVAL_MS, so a toggle
    // would appear to do nothing for five seconds unless the cache is dropped.
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'cached.mdc'),
      '---\ndescription: cached\nalwaysApply: true\n---\nB\n', 'utf8')

    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )

    const before = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as { rules: Array<Record<string, unknown>> }
    expect(before.rules.some((r) => r['name'] === 'cached')).toBe(true)

    await post(conn.routes[0]!, { action: 'setRule', key: 'codebuddy', path: join(project, '.codebuddy', 'rules', 'cached.mdc'), enabled: false })

    // Immediately after, with no sleep: the write response itself is fresh.
    // The row stays listed (so it can be re-enabled) but must read as inactive.
    const after = await (await post(conn.routes[0]!, { action: 'setSource', key: 'codebuddy', enabled: true })).json() as { rules: Array<Record<string, unknown>> }
    const row = after.rules.find((r) => r['name'] === 'cached')
    expect(row?.['active']).toBe(false)
    expect(row?.['disabledBy']).toBe('state')
  })

  it('keeps a panel-disabled rule visible, marked as state-disabled', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    const target = join(project, '.codebuddy', 'rules', 'toggled.mdc')
    await writeFile(target, '---\ndescription: toggled\nalwaysApply: true\n---\nB\n', 'utf8')

    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )

    const after = await (await post(conn.routes[0]!, { action: 'setRule', key: 'codebuddy', path: target, enabled: false }))
      .json() as { rules: Array<Record<string, unknown>> }
    const row = after.rules.find((r) => r['name'] === 'toggled')
    // The measured defect: the rule used to vanish, so a "disabled" tab would
    // always be empty and the rule could never be re-enabled.
    expect(row).toBeDefined()
    expect(row?.['active']).toBe(false)
    expect(row?.['disabledBy']).toBe('state')
    // The file itself is still enabled; only the panel switched it off.
    expect(row?.['enabled']).toBe(true)
  })

  it('distinguishes a frontmatter-disabled rule from a state-disabled one', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'fmoff.mdc'),
      '---\ndescription: fm\nalwaysApply: true\nenabled: false\n---\nB\n', 'utf8')

    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )
    const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as { rules: Array<Record<string, unknown>> }
    const row = body.rules.find((r) => r['name'] === 'fmoff')
    expect(row?.['enabled']).toBe(false)
    expect(row?.['active']).toBe(false)
    expect(row?.['disabledBy']).toBe('frontmatter')
  })

  it('reports both total and active counts per source', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    const target = join(project, '.codebuddy', 'rules', 'counted.mdc')
    await writeFile(target, '---\ndescription: c\nalwaysApply: true\n---\nB\n', 'utf8')

    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )
    const body = await (await post(conn.routes[0]!, { action: 'setRule', key: 'codebuddy', path: target, enabled: false }))
      .json() as { rules: Array<Record<string, unknown>>; sources: Array<Record<string, unknown>> }
    const src = body.sources.find((s) => s['key'] === 'codebuddy' && s['scope'] === 'project')
    // ruleCount keeps counting what is on disk; activeRuleCount says what works.
    // Compared relatively: the fixture project accumulates files across cases in
    // this file, so an absolute number would be brittle.
    expect(src?.['ruleCount']).toBeGreaterThan(0)
    expect(src?.['activeRuleCount']).toBe(Number(src?.['ruleCount']) - 1)
  })

  it('never injects a state-disabled rule, even though the panel still lists it', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    const target = join(project, '.codebuddy', 'rules', 'always.mdc')
    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({ connection: conn.service })
    apply(ctx as never, resolveConfig())

    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    const first = await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    ) as { messages: Array<{ content: Array<{ text: string }> }> }
    expect(first.messages[1]!.content[0]!.text).toContain('ALWAYS BODY')

    await post(conn.routes[0]!, { action: 'setRule', key: 'codebuddy', path: target, enabled: false })

    // A fresh agent forces a rescan; the disabled rule must stay out of the prompt.
    const second = await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    ) as { messages: Array<{ content: Array<{ text: string }> }> }
    const injected = second.messages[1]?.content[0]?.text ?? ''
    expect(injected).not.toContain('ALWAYS BODY')
  })

  it('serves rules with NO agent and NO pre-step — the boot regression', async () => {
    // The reported bug: the panel read a module-level lastScan that only
    // agent/pre-step ever wrote, so a freshly booted host showed zero rules
    // until the user happened to send a message. This drives the route without
    // ever touching the listener.
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'boot.mdc'),
      '---\ndescription: boot\nalwaysApply: true\n---\nBOOT BODY\n', 'utf8')

    const conn = connectionStub()
    // The workspace service is the only thing telling the host where to look.
    const { ctx } = webContext({ connection: conn.service, workspaceRegistry: { list: () => [{ path: project }] } })
    apply(ctx as never, resolveConfig())

    const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
      rules: Array<Record<string, unknown>>
      sources: Array<Record<string, unknown>>
      scannedAt: number
      workspace: { path: string | null; source: string }
    }
    expect(body.rules.some((r) => r['name'] === 'boot')).toBe(true)
    expect(body.scannedAt).toBeGreaterThan(0)
    expect(body.workspace.source).toBe('workspace-registry')
    expect(body.sources.some((s) => s['scope'] === 'project')).toBe(true)
  })

  it('stops trusting a session scan once it is older than its TTL', async () => {
    // One process-wide reader serves every window, so an unbounded `lastScan`
    // let a write made elsewhere go unseen for the life of the process.
    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({
      connection: conn.service,
      workspaceRegistry: { list: () => [{ path: project }] },
    })
    apply(ctx as never, resolveConfig())

    const start = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )

    const fetch = conn.routes[0]!['fetch'] as () => Promise<Response>
    const first = await (await fetch()).json() as { workspace: { source: string } }
    expect(first.workspace.source).toBe('last-scan')

    await writeFile(join(project, '.codebuddy', 'rules', 'fresh.mdc'), '---\ndescription: fresh\n---\nB\n', 'utf8')
    const cached = await (await fetch()).json() as { rules: Array<Record<string, unknown>> }
    expect(cached.rules.map((r) => r['name'])).not.toContain('fresh')

    clock.mockReturnValue(start + 31_000)
    const later = await (await fetch()).json() as { rules: Array<Record<string, unknown>> }
    expect(later.rules.map((r) => r['name'])).toContain('fresh')
    clock.mockRestore()
  })

  it('reflects a write immediately even when a session scan is fresh', async () => {
    // The toggle is optimistic-then-reconcile: a response still carrying the
    // pre-write rule made the switch visibly bounce back.
    const conn = connectionStub()
    const { ctx, listeners } = webContextListeners({
      connection: conn.service,
      workspaceRegistry: { list: () => [{ path: project }] },
    })
    apply(ctx as never, resolveConfig())

    const claimed = { content: [{ type: 'text', text: 'hi' }] }
    await listeners[0]!(
      { agent: {}, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )

    const fetch = conn.routes[0]!['fetch'] as (req?: Request) => Promise<Response>
    const posted = await fetch(new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'setRule', key: 'codebuddy', path: join(project, '.codebuddy', 'rules', 'always.mdc'), enabled: false,
      }),
    }))
    const body = await posted.json() as { workspace: { source: string }; rules: Array<Record<string, unknown>> }
    // `name` is the file's basename; `discipline` is only its description.
    const row = body.rules.find((r) => r['path'] === join(project, '.codebuddy', 'rules', 'always.mdc'))
    expect(row?.['name']).toBe('always')
    expect(row?.['active']).toBe(false)
    expect(body.workspace.source).toBe('last-scan')
  })

  it('scans the single workspace the registry reports', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'one.mdc'), '---\ndescription: one\n---\nB\n', 'utf8')
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service, workspaceRegistry: { list: () => [{ path: project }] } })
    apply(ctx as never, resolveConfig())
    const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as { rules: Array<Record<string, unknown>> }
    expect(body.rules.map((r) => r['name'])).toContain('one')
  })

  it('takes the first of several workspaces instead of showing nothing', async () => {
    const second = await mkdtemp(join(tmpdir(), 'dshrm-other-'))
    try {
      await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
      await writeFile(join(project, '.codebuddy', 'rules', 'first.mdc'), '---\ndescription: first\n---\nB\n', 'utf8')
      await mkdir(join(second, '.git'), { recursive: true })
      await mkdir(join(second, '.codebuddy', 'rules'), { recursive: true })
      await writeFile(join(second, '.codebuddy', 'rules', 'second.mdc'), '---\ndescription: second\n---\nB\n', 'utf8')

      const conn = connectionStub()
      const { ctx } = webContext({
        connection: conn.service,
        workspaceRegistry: { list: () => [{ path: project }, { path: second }] },
      })
      apply(ctx as never, resolveConfig())
      const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as { rules: Array<Record<string, unknown>> }
      expect(body.rules.map((r) => r['name'])).toContain('first')
      expect(body.rules.map((r) => r['name'])).not.toContain('second')
    } finally {
      await rm(second, { recursive: true, force: true })
    }
  })

  it('serves an empty document, without throwing, when no service can name a workspace', async () => {
    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    const response = await (conn.routes[0]!['fetch'] as () => Promise<Response>)()
    expect(response.status).toBe(200)
    const body = await response.json() as { rules: unknown[]; workspace: { path: null; source: string } }
    expect(body.rules).toEqual([])
    // The source is reported so the panel can say *why* it is empty.
    expect(body.workspace.source).toBe('none')
    expect(body.workspace.path).toBe(null)
  })

  it('falls back to a session cwd when there is no registry', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'via-session.mdc'), '---\ndescription: s\n---\nB\n', 'utf8')
    const conn = connectionStub()
    const { ctx } = webContext({
      connection: conn.service,
      sessions: { list: () => [{ header: { cwd: project } }] },
    })
    apply(ctx as never, resolveConfig())
    const body = await (await (conn.routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
      rules: Array<Record<string, unknown>>
      workspace: { source: string }
    }
    expect(body.rules.map((r) => r['name'])).toContain('via-session')
    expect(body.workspace.source).toBe('sessions')
  })

  it('invalidates the on-demand scan after a write', async () => {
    // Without invalidation the panel would keep serving the pre-write scan for
    // up to the TTL, so a toggle would appear to do nothing.
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    const target = join(project, '.codebuddy', 'rules', 'cached.mdc')
    await writeFile(target, '---\ndescription: cached\nalwaysApply: true\n---\nB\n', 'utf8')

    const conn = connectionStub()
    const { ctx } = webContext({ connection: conn.service, workspaceRegistry: { list: () => [{ path: project }] } })
    apply(ctx as never, resolveConfig())

    const fetch = conn.routes[0]!['fetch'] as (req?: Request) => Promise<Response>
    const before = await (await fetch()).json() as { rules: Array<Record<string, unknown>> }
    expect(before.rules.find((r) => r['name'] === 'cached')?.['active']).toBe(true)

    const posted = await fetch(new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'setRule', key: 'codebuddy', path: target, enabled: false }),
    }))
    const after = await posted.json() as { rules: Array<Record<string, unknown>> }
    // Same request, no sleep: the write must be visible immediately.
    expect(after.rules.find((r) => r['name'] === 'cached')?.['active']).toBe(false)
  })

  it('reuses the on-demand scan across reads, so opening the panel is not a rescan', async () => {
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'reuse.mdc'), '---\ndescription: r\n---\nB\n', 'utf8')
    let calls = 0
    const conn = connectionStub()
    const { ctx } = webContext({
      connection: conn.service,
      workspaceRegistry: { list: () => { calls += 1; return [{ path: project }] } },
    })
    apply(ctx as never, resolveConfig())
    const fetch = conn.routes[0]!['fetch'] as (req?: Request) => Promise<Response>
    const first = await (await fetch()).json() as { scannedAt: number }
    const second = await (await fetch()).json() as { scannedAt: number }
    expect(second.scannedAt).toBe(first.scannedAt)
    expect(calls).toBe(1)
  })

  it('rescans on demand when the panel asks for one', async () => {
    // The panel's Refresh button used to return the cached bytes, so its
    // timestamp never moved and it looked broken. ?refresh=1 is the escape.
    await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
    await writeFile(join(project, '.codebuddy', 'rules', 'again.mdc'), '---\ndescription: a\n---\nB\n', 'utf8')
    let calls = 0
    const conn = connectionStub()
    const { ctx } = webContext({
      connection: conn.service,
      workspaceRegistry: { list: () => { calls += 1; return [{ path: project }] } },
    })
    apply(ctx as never, resolveConfig())
    const fetch = conn.routes[0]!['fetch'] as (req?: Request) => Promise<Response>
    await fetch()
    await fetch()
    // Two ordinary reads: the workspace was resolved once, the second was cached.
    expect(calls).toBe(1)
    const forced = await (await fetch(new Request('http://localhost/x?refresh=1'))).json() as { scannedAt: number }
    expect(calls).toBe(2)
    expect(forced.scannedAt).toBeGreaterThan(0)
  })

  it('does not throw when no connection service is loaded', () => {
    const { ctx } = webContext({})
    expect(() => apply(ctx as never, resolveConfig())).not.toThrow()
  })

  it('registers the route when Connection arrives AFTER apply (late binding)', () => {
    // The measured failure: a one-shot ctx.get at apply time registered nothing
    // because Connection mounted later, and the route answered 404 forever.
    const conn = connectionStub()
    const { ctx } = webContext({}, project, { connection: conn.service })
    apply(ctx as never, resolveConfig())
    expect(conn.routes.length).toBe(1)
  })

  it('prefers connection.fetch over a bare webServer route', () => {
    // A bare webServer route would bypass Connection's browser-trust fence.
    const conn = connectionStub()
    const webRoutes: Array<Record<string, unknown>> = []
    const { ctx } = webContext({
      connection: conn.service,
      webServer: { register: (route: Record<string, unknown>) => { webRoutes.push(route); return () => {} } },
    })
    apply(ctx as never, resolveConfig())
    expect(conn.routes.length).toBe(1)
    expect(webRoutes.length).toBe(0)
  })

  it('keeps the disposer, so unload removes the route', () => {
    const conn = connectionStub()
    const { ctx, effects } = webContext({ connection: conn.service })
    apply(ctx as never, resolveConfig())
    expect(effects.length).toBe(1)
  })

  it('switches to a named workspace and publishes the candidates it offered', async () => {
    // The panel's switch rides the query string, and it is honored only for a
    // directory this host itself offered: anything else keeps the default, so a
    // hand-edited parameter cannot point the scan at an arbitrary directory.
    const second = await mkdtemp(join(tmpdir(), 'dshrm-entry-second-'))
    try {
      await mkdir(join(second, '.git'), { recursive: true })
      await mkdir(join(second, '.codebuddy', 'rules'), { recursive: true })
      await writeFile(join(second, '.codebuddy', 'rules', 'second.mdc'),
        '---\ndescription: second\n---\nB\n', 'utf8')

      const conn = connectionStub()
      const { ctx } = webContext({
        connection: conn.service,
        workspaceRegistry: { list: () => [{ path: project }, { path: second }] },
      })
      apply(ctx as never, resolveConfig())
      const fetch = conn.routes[0]!['fetch'] as (req?: Request) => Promise<Response>
      const body = await (await fetch(new Request(
        `http://localhost/x?workspace=${encodeURIComponent(second)}`,
      ))).json() as {
        rules: Array<Record<string, unknown>>
        workspace: { path: string; source: string; options?: readonly string[] }
      }
      expect(body.workspace.path).toBe(second)
      expect(body.workspace.source).toBe('selected')
      // The full candidate list, current directory included, is what feeds the
      // panel's switch.
      expect(body.workspace.options).toEqual([project, second])
      expect(body.rules.map((rule) => rule['name'])).toContain('second')

      const stranger = await (await fetch(new Request(
        `http://localhost/x?workspace=${encodeURIComponent(tmpdir())}`,
      ))).json() as { rules: Array<Record<string, unknown>>; workspace: { path: string; source: string } }
      expect(stranger.workspace.path).toBe(project)
      expect(stranger.workspace.source).toBe('workspace-registry')
      expect(stranger.rules.map((rule) => rule['name'])).toContain('always')
    } finally {
      await rm(second, { recursive: true, force: true })
    }
  })
})

describe('apply — registration', () => {
  it('registers exactly one tool', () => {
    const { ctx, registered } = fakeContext()
    apply(ctx as never, resolveConfig())
    expect(registered.length).toBe(1)
    expect((registered[0] as { name: string }).name).toBe('read_rules')
  })

  it('subscribes to agent/pre-step when injection is on', () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    expect(listeners.length).toBe(1)
  })

  it('skips the pre-step listener when injectRules is false, keeping the tool', () => {
    const { ctx, registered, listeners } = fakeContext()
    apply(ctx as never, resolveConfig({ injectRules: false }))
    expect(listeners.length).toBe(0)
    expect(registered.length).toBe(1)
  })

  it('exposes the documented cordis id and inject list', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('rules-manager')
    expect(mod.inject).toEqual(['tools', 'workingDirectory'])
  })
})

describe('apply — pre-step injection', () => {
  /** A payload matching the real event shape; `messages` is the claimed batch. */
  const payload = (over: Record<string, unknown> = {}) => ({
    agent: {},
    messages: [],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
    ...over,
  })

  it('injects the rules block as a user message', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'user prompt' }] }
    const decision = await listeners[0]!(
      payload({ messages: [claimed] }),
      async () => ({ kind: 'enter' as const, messages: [claimed] }),
    ) as { messages: Array<{ content: Array<{ text: string }> }> }

    expect(decision.messages.length).toBe(2)
    const injected = decision.messages[1]!.content[0]!.text
    expect(injected).toContain('<rules>')
    expect(injected).toContain('ALWAYS BODY')
    // On-demand bodies stay out of the prompt.
    expect(injected).not.toContain('ONDEMAND BODY')
  })

  it('folds the block right after the claimed batch, before later context', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'user prompt' }] }
    const context = { content: [{ type: 'text', text: 'runtime context' }] }
    const decision = await listeners[0]!(
      payload({ messages: [claimed] }),
      async () => ({ kind: 'enter' as const, messages: [claimed, context] }),
    ) as { messages: Array<{ content: Array<{ text: string }> }> }

    expect(decision.messages.length).toBe(3)
    expect(decision.messages[0]).toBe(claimed)
    expect(decision.messages[1]!.content[0]!.text).toContain('<rules>')
    expect(decision.messages[2]).toBe(context)
  })

  it('preserves the claimed batch and any startsRequestSeries flag', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'user prompt' }] }
    const decision = await listeners[0]!(
      payload({ messages: [claimed] }),
      async () => ({ kind: 'enter' as const, messages: [claimed], startsRequestSeries: true as const }),
    ) as { messages: unknown[]; startsRequestSeries?: true }

    expect(decision.messages.length).toBe(2)
    expect(decision.messages[0]).toBe(claimed)
    expect(decision.startsRequestSeries).toBe(true)
  })

  it('leaves a first step that claimed nothing untouched', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const decision = await listeners[0]!(
      payload({ step: 1 }),
      async () => ({ kind: 'enter' as const, messages: [] }),
    ) as { messages: unknown[] }
    // Injecting here would manufacture a request the turn does not own.
    expect(decision.messages.length).toBe(0)
  })

  it('leaves a first step alone even when the decision carries other context', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const context = { content: [{ type: 'text', text: 'ctx' }] }
    const decision = await listeners[0]!(
      payload({ step: 1 }),
      async () => ({ kind: 'enter' as const, messages: [context] }),
    ) as { messages: unknown[] }
    expect(decision.messages.length).toBe(1)
    expect(decision.messages[0]).toBe(context)
  })

  it('skips a later step whose claim is empty too', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const context = { content: [{ type: 'text', text: 'tool result' }] }
    const decision = await listeners[0]!(
      payload({ step: 3 }),
      () => Promise.resolve({ kind: 'enter' as const, messages: [context] }),
    ) as { messages: unknown[] }
    // The skip is driven by the empty claim, not by the step number: with
    // nothing removed from the inbox there is nothing to fold in after.
    expect(decision.messages.length).toBe(1)
    expect(decision.messages[0]).toBe(context)
  })

  it('injects on a later step that did claim a message', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const claimed = { content: [{ type: 'text', text: 'follow-up' }] }
    const decision = await listeners[0]!(
      payload({ step: 3, messages: [claimed] }),
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    ) as { messages: unknown[] }
    expect(decision.messages.length).toBe(2)
  })

  it('does not duplicate the block when it is already present', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const agent = {}
    const claimed = { content: [{ type: 'text', text: 'user prompt' }] }
    const next2 = async (msgs: unknown[]) => ({ kind: 'enter' as const, messages: msgs })

    const first = await listeners[0]!(
      payload({ agent, messages: [claimed] }),
      () => next2([claimed]),
    ) as { messages: unknown[] }

    // Feed the produced batch back in as the claimed set; the block is present.
    const second = await listeners[0]!(
      payload({ agent, messages: first.messages }),
      () => next2(first.messages),
    ) as { messages: unknown[] }

    expect(second.messages.length).toBe(first.messages.length)
  })

  it('injects nothing when the project has no rules', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'dshrm-bare-'))
    try {
      await mkdir(join(bare, '.git'), { recursive: true })
      const { ctx, listeners } = fakeContext(bare)
      apply(ctx as never, resolveConfig())
      const claimed = { content: [{ type: 'text', text: 'user prompt' }] }
      const decision = await listeners[0]!(
        payload({ messages: [claimed] }),
        () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
      ) as { messages: unknown[] }
      expect(decision.messages.length).toBe(1)
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })

  it('scans the session directory, not the host process directory', async () => {
    // The defect this guards: the scan used `process.cwd()`, which in a real
    // host is the DSH installation directory. No project marker there meant
    // every project rule was silently missed and the block never rendered,
    // even though the session directory was full of rules.
    const elsewhere = await mkdtemp(join(tmpdir(), 'dshrm-elsewhere-'))
    try {
      await mkdir(join(elsewhere, '.git'), { recursive: true })
      vi.spyOn(process, 'cwd').mockReturnValue(elsewhere)
      const { ctx, listeners, ensure } = fakeContext(project)
      apply(ctx as never, resolveConfig())
      const claimed = { content: [{ type: 'text', text: 'user prompt' }] }
      const decision = await listeners[0]!(
        payload({ messages: [claimed] }),
        async () => ({ kind: 'enter' as const, messages: [claimed] }),
      ) as { messages: Array<{ content: Array<{ text: string }> }> }

      expect(ensure).toHaveBeenCalled()
      expect(decision.messages.length).toBe(2)
      expect(decision.messages[1]!.content[0]!.text).toContain('ALWAYS BODY')
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('leaves a rejected decision untouched', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const decision = await listeners[0]!(
      payload(),
      async () => ({ kind: 'reject' as const }),
    )
    expect(decision).toEqual({ kind: 'reject' })
  })

  it('propagates an aborted signal instead of injecting', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const controller = new AbortController()
    controller.abort()
    await expect(listeners[0]!(
      payload({ signal: controller.signal, messages: [{ content: [] }] }),
      async () => ({ kind: 'enter' as const, messages: [{ content: [] }] }),
    )).rejects.toThrow()
  })
})

describe('apply — the registered tool reads the scanned catalog', () => {
  it('resolves a rule by basename after a pre-step scan', async () => {
    const { ctx, registered, listeners } = fakeContext()
    apply(ctx as never, resolveConfig())
    const agent = {}
    // A proceeding step with a claimed message is what runs the scan.
    const claimed = { content: [{ type: 'text', text: 'user prompt' }] }
    await listeners[0]!(
      { agent, messages: [claimed], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    )
    const tool = registered[0] as {
      execute(args: unknown, exec: unknown): Promise<{ content: string; resolvedCount: number }>
    }
    const out = await tool.execute({ ruleNames: ['ondemand.mdc'] }, { agent })
    expect(out.resolvedCount).toBe(1)
    expect(out.content).toContain('ONDEMAND BODY')
  })

  it('returns nothing for an agent that never ran a scan', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx as never, resolveConfig())
    const tool = registered[0] as {
      execute(args: unknown, exec: unknown): Promise<{ resolvedCount: number; content: string }>
    }
    const out = await tool.execute({ ruleNames: ['ondemand.mdc'] }, { agent: {} })
    expect(out.resolvedCount).toBe(0)
    expect(out.content).toContain('Not found')
  })

  it('returns nothing when there is no agent at all', async () => {
    const { ctx, registered } = fakeContext()
    apply(ctx as never, resolveConfig())
    const tool = registered[0] as {
      execute(args: unknown, exec: unknown): Promise<{ resolvedCount: number }>
    }
    const out = await tool.execute({ ruleNames: ['ondemand.mdc'] }, { agent: undefined })
    expect(out.resolvedCount).toBe(0)
  })
})

describe('apply — a touched file makes a file-scoped rule resident', () => {
  /**
   * A rule that only applies to TypeScript sources.
   *
   * CodeBuddy is the family already present in the fixture project, and
   * `paths` is its documented scoping key, so this is the real pipeline: the
   * file is classified as requestable *because* it declares a pattern.
   */
  const SCOPED_BODY = 'SCOPED TS BODY'
  async function writeScopedRule(): Promise<string> {
    await mkdir(join(project, 'src'), { recursive: true })
    const file = join(project, '.codebuddy', 'rules', 'scoped.mdc')
    await writeFile(file,
      '---\ndescription: for TS files\nalwaysApply: false\npaths: src/**/*.ts\n---\n' + SCOPED_BODY + '\n',
      'utf8')
    return file
  }

  /**
   * A ctx that can serve the panel route as well as the pre-step hook.
   *
   * The route needs `ctx.get` and `ctx.inject` (Connection mounts through the
   * latter), which the injection-only fixture above does not model.
   */
  function panelContext() {
    const routes: Array<Record<string, unknown>> = []
    const listeners: Array<(payload: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
    const results: Array<(exec: unknown, result: unknown) => unknown> = []
    const services: Record<string, unknown> = {
      connection: {
        fetch: {
          register: (route: Record<string, unknown>) => {
            routes.push(route)
            return () => {}
          },
        },
      },
    }
    const ctx: Record<string, unknown> = {
      tools: { register: () => {} },
      on: (event: string, handler: never) => {
        if (event === 'agent/pre-step') listeners.push(handler)
        if (event === 'tools/result') results.push(handler)
      },
      workingDirectory: { ensure: () => Promise.resolve(project) },
      get: (name: string) => services[name],
      // Effects run immediately, like the real host: the route is registered
      // from inside one, so a no-op effect would leave `routes` empty.
      effect: (callback: () => unknown) => { callback() },
      inject: (names: string[], callback: (scoped: unknown) => void) => {
        const scoped = () => Object.assign(Object.create(null), ctx, services)
        if (names.every((n) => services[n] !== undefined)) callback(scoped())
      },
    }
    return { ctx, listeners, results, routes }
  }

  /** The payload shape of the real `agent/pre-step` event. */
  const stepPayload = (agent: object, claimed: unknown) => ({
    agent,
    messages: [claimed],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  })

  /** Run one request and return the injected block, or null when none was added. */
  async function blockFor(
    listeners: Array<(payload: unknown, next: () => Promise<unknown>) => Promise<unknown>>,
    agent: object,
  ): Promise<string | null> {
    const claimed = { content: [{ type: 'text', text: 'user prompt' }] }
    const decision = await listeners[0]!(
      stepPayload(agent, claimed),
      () => Promise.resolve({ kind: 'enter' as const, messages: [claimed] }),
    ) as { messages: Array<{ content: Array<{ text?: string }> }> }
    if (decision.messages.length < 2) return null
    return decision.messages[1]!.content[0]!.text ?? null
  }

  it('subscribes to tools/result only when injection is on', () => {
    const on = fakeContext()
    apply(on.ctx as never, resolveConfig())
    expect(on.results.length).toBe(1)
    // With the block switched off there is nothing an attachment could change,
    // so the observer is not registered at all.
    const off = fakeContext()
    apply(off.ctx as never, resolveConfig({ injectRules: false }))
    expect(off.results.length).toBe(0)
  })

  it('injects the body once the session reads a matching file', async () => {
    const scoped = await writeScopedRule()
    const { ctx, listeners, results } = fakeContext()
    apply(ctx as never, resolveConfig())
    const agent = {}

    // Before the touch the rule is an index line, and its body is nowhere.
    const before = await blockFor(listeners, agent)
    expect(before).toContain('<agent_requestable_workspace_rules')
    expect(before).toContain(scoped)
    expect(before).not.toContain(SCOPED_BODY)

    // A successful read of a file the pattern matches. The path is relative on
    // purpose: it must resolve against the session directory the host reports,
    // not against whatever directory the test process happens to run in.
    results[0]!( { name: 'read', agent, arguments: { file_path: 'src/a.ts' } }, { isError: false })

    const after = await blockFor(listeners, agent)
    expect(after).toContain(SCOPED_BODY)
    expect(after).toContain('<always_applied_workspace_rules')
    // It is no longer something the agent has to ask for, so its index line is
    // gone. The section itself remains, because the fixture project also holds
    // an on-demand rule with no pattern — which can never be attached.
    expect(after).not.toContain('- ' + scoped + ': ')
    expect(after).toContain('- ')
  })

  it('keeps the body resident on every later request', async () => {
    await writeScopedRule()
    const { ctx, listeners, results } = fakeContext()
    apply(ctx as never, resolveConfig())
    const agent = {}
    await blockFor(listeners, agent)
    results[0]!({ name: 'read', agent, arguments: { file_path: 'src/a.ts' } }, { isError: false })
    await blockFor(listeners, agent)
    // Reading the touch list must not consume it: attachment is a property of
    // the session, not of one request.
    const third = await blockFor(listeners, agent)
    expect(third).toContain(SCOPED_BODY)
  })

  it('ignores a read of a file the pattern does not match', async () => {
    await writeScopedRule()
    const { ctx, listeners, results } = fakeContext()
    apply(ctx as never, resolveConfig())
    const agent = {}
    results[0]!({ name: 'read', agent, arguments: { file_path: 'README.md' } }, { isError: false })
    const block = await blockFor(listeners, agent)
    expect(block).not.toContain(SCOPED_BODY)
    expect(block).toContain('<agent_requestable_workspace_rules')
  })

  it('does not count a failed tool call as a touch', async () => {
    await writeScopedRule()
    const { ctx, listeners, results } = fakeContext()
    apply(ctx as never, resolveConfig())
    const agent = {}
    // A read that errored never put the file in front of the model, and a
    // failed edit changed nothing on disk.
    results[0]!({ name: 'read', agent, arguments: { file_path: 'src/a.ts' } }, { isError: true })
    const block = await blockFor(listeners, agent)
    expect(block).not.toContain(SCOPED_BODY)
  })

  it('keeps each agent\'s touches to itself', async () => {
    await writeScopedRule()
    const { ctx, listeners, results } = fakeContext()
    apply(ctx as never, resolveConfig())
    const reader = {}
    const other = {}
    results[0]!({ name: 'read', agent: reader, arguments: { file_path: 'src/a.ts' } }, { isError: false })
    const mine = await blockFor(listeners, reader)
    const theirs = await blockFor(listeners, other)
    expect(mine).toContain(SCOPED_BODY)
    expect(theirs).not.toContain(SCOPED_BODY)
  })

  it('takes the files an apply_patch changed', async () => {
    await writeScopedRule()
    const { ctx, listeners, results } = fakeContext()
    apply(ctx as never, resolveConfig())
    const agent = {}
    // apply_patch carries no path argument: the files are named inside the
    // patch document itself.
    const input = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n')
    results[0]!({ name: 'apply_patch', agent, arguments: { input } }, { isError: false })
    const block = await blockFor(listeners, agent)
    expect(block).toContain(SCOPED_BODY)
  })

  it('survives a result whose exec carries no agent', async () => {
    const { ctx, listeners, results } = fakeContext()
    apply(ctx as never, resolveConfig())
    // The route-driven panel scan and any host-internal tool call can arrive
    // without an agent; the observer must not throw on them.
    expect(() => {
      results[0]!({ name: 'read', arguments: { file_path: 'src/a.ts' } }, { isError: false })
    }).not.toThrow()
    const block = await blockFor(listeners, {})
    expect(block).not.toContain(SCOPED_BODY)
  })

  /**
   * A ctx whose session directory can change mid-conversation.
   *
   * The host resolves the directory from `ctx.workingDirectory.ensure(agent)`,
   * not from the event payload, so a move is expressed here rather than in the
   * payload `stepPayload` builds.
   */
  function moveContext() {
    const listeners: Array<(payload: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
    const results: Array<(exec: unknown, result: unknown) => unknown> = []
    const dirs = new WeakMap<object, string>()
    const ctx: Record<string, unknown> = {
      tools: { register: () => {} },
      on: (event: string, handler: never) => {
        if (event === 'agent/pre-step') listeners.push(handler)
        if (event === 'tools/result') results.push(handler)
      },
      workingDirectory: { ensure: (agent: object) => Promise.resolve(dirs.get(agent) ?? project) },
    }
    return { ctx, listeners, results, move: (agent: object, dir: string) => { dirs.set(agent, dir) } }
  }

  it('starts the touch list over when the session moves to another directory', async () => {
    await writeScopedRule()
    // A tree that holds no rules at all: after the move nothing from the old
    // tree may still be resident.
    const other = await mkdtemp(join(tmpdir(), 'dshrm-elsewhere-'))
    try {
      const { ctx, listeners, results, move } = moveContext()
      apply(ctx as never, resolveConfig())
      const agent = {}
      results[0]!({ name: 'read', agent, arguments: { file_path: 'src/a.ts' } }, { isError: false })
      expect(await blockFor(listeners, agent)).toContain(SCOPED_BODY)

      move(agent, other)
      // The relative path now resolves in a directory the session has left, so
      // the rule it made resident must not travel with it.
      expect(await blockFor(listeners, agent) ?? '').not.toContain(SCOPED_BODY)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('answers a repeated panel request from the same attachment', async () => {
    await writeScopedRule()
    const { ctx, listeners, results, routes } = panelContext()
    apply(ctx as never, resolveConfig())
    const agent = {}
    await blockFor(listeners, agent)
    results[0]!({ name: 'read', agent, arguments: { file_path: 'src/a.ts' } }, { isError: false })
    const read = async () => await (await (routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
      rules: Array<Record<string, unknown>>
    }
    // The second poll runs with the previous answer already recorded, so it must
    // not read a stale or emptied cache as "nothing is attached".
    const first = await read()
    const second = await read()
    for (const body of [first, second]) {
      expect(body.rules.find((r) => r['name'] === 'scoped')?.['attached']).toBe(true)
    }
  })

  it('reports the same attachment through the panel route', async () => {
    await writeScopedRule()
    const { ctx, listeners, results, routes } = panelContext()
    apply(ctx as never, resolveConfig())
    const agent = {}
    await blockFor(listeners, agent)
    results[0]!({ name: 'read', agent, arguments: { file_path: 'src/a.ts' } }, { isError: false })

    const body = await (await (routes[0]!['fetch'] as () => Promise<Response>)()).json() as {
      rules: Array<Record<string, unknown>>
    }
    const row = body.rules.find((r) => r['name'] === 'scoped')
    // A browser request carries no agent, so the route answers with the most
    // recent session's touches; the row has to agree with what was injected.
    expect(row?.['attached']).toBe(true)
    expect(row?.['type']).toBe('requested')
  })
})
