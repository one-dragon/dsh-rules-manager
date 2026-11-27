import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { Config, type Config as RulesManagerConfig } from '../src/config.ts'
import { RULES_ROUTE } from '../src/panel.ts'
import { setStateDir, statePath } from '../src/state.ts'

/**
 * Route tests: the host HTTP and panel query branches the entry suite does not
 * reach.
 *
 * Every case drives the handler that `apply` registers on a fake Connection,
 * with a real Request and the real Response the host would send. The covered
 * lines are therefore exercised through the behaviour they implement — a
 * fallback that keeps the default workspace, a rejection that names its reason —
 * rather than by reaching into a private helper.
 */

let home: string
let project: string
const prevHome = process.env['DSH_RULES_MANAGER_HOME']

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dshrm-routes-home-'))
  project = await mkdtemp(join(tmpdir(), 'dshrm-routes-proj-'))
  process.env['DSH_RULES_MANAGER_HOME'] = home
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, '.codebuddy', 'rules'), { recursive: true })
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (prevHome === undefined) delete process.env['DSH_RULES_MANAGER_HOME']
  else process.env['DSH_RULES_MANAGER_HOME'] = prevHome
  await rm(home, { recursive: true, force: true })
  await rm(project, { recursive: true, force: true })
})

/**
 * Resolve config the way the host does, but pin state at the fixture home.
 *
 * The schemastery default is the real `~/.dsh/rules-manager`, which is
 * non-empty, so `apply` would otherwise point every write at the developer's
 * own settings.
 */
function resolveConfig(): RulesManagerConfig {
  return (Config as unknown as (v: unknown) => RulesManagerConfig)({ stateDir: home })
}

/**
 * A fake cordis context that captures the route `apply` registers.
 *
 * `inject` runs its callback only once every named service is present, which is
 * the documented late-binding contract the entry point depends on. The registry
 * names the fixture project so the route can answer without any agent session.
 */
function routeContext(extraServices: Record<string, unknown> = {}) {
  const routes: Array<Record<string, unknown>> = []
  const available: Record<string, unknown> = {
    connection: { fetch: { register: (route: Record<string, unknown>) => { routes.push(route); return () => {} } } },
    workspaceRegistry: { list: () => [{ path: project }] },
    ...extraServices,
  }
  const ctx: Record<string, unknown> = {
    tools: { register: () => {} },
    on: () => {},
    workingDirectory: { ensure: () => Promise.resolve(project) },
    get: (name: string) => available[name],
    effect: (callback: () => unknown) => { void callback() },
    inject: (names: string[], callback: (scoped: unknown) => void) => {
      if (names.every((name) => available[name] !== undefined)) {
        callback(Object.assign(Object.create(null), ctx, available))
      }
    },
  }
  apply(ctx as never, resolveConfig())
  return { routes, fetch: routes[0]!['fetch'] as (request?: Request) => Promise<Response> }
}

/** One GET at the panel route. */
function panelGet(url = `http://localhost${RULES_ROUTE}`): Request {
  return new Request(url)
}

/** One POST at the panel route carrying a raw, possibly broken, body. */
function panelPost(body: string): Request {
  return new Request(`http://localhost${RULES_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

/**
 * Replace a Request's URL with one the URL parser refuses.
 *
 * `new URL('http://[')` throws ERR_INVALID_URL, while the query strings a client
 * actually sends (`http://x/%`, `not a url`, `%`) all parse: this is the shape
 * that reaches the parse guards' failure arms. The Request constructor rejects
 * such a URL outright, hence the own-property replacement.
 */
function withUnparsableUrl(request: Request): Request {
  Object.defineProperty(request, 'url', { value: 'http://[', configurable: true })
  return request
}

interface PanelDiagnosticRow {
  code: string
  detail: string
  line?: number
  kind: string
}

describe('apply — host route branches the entry suite leaves uncovered', () => {
  it('falls back to the default workspace when the request URL cannot be parsed', async () => {
    const { fetch } = routeContext()

    const normal = await (await fetch(panelGet())).json() as {
      workspace: { path: string | null; source: string; options?: readonly string[] }
    }
    expect(normal.workspace.path).toBe(project)
    expect(normal.workspace.options).toEqual([project])

    // A URL the parser refuses names no workspace at all, so the request must
    // read as \"no request\" and keep the directory the registry offered rather
    // than scanning somewhere a malformed parameter implied.
    const malformed = await (await fetch(withUnparsableUrl(panelGet()))).json() as {
      workspace: { path: string | null; source: string; options?: readonly string[] }
    }
    expect(malformed.workspace.path).toBe(project)
    expect(malformed.workspace.source).toBe('workspace-registry')
    expect(malformed.workspace.options).toEqual([project])
  })

  it('treats an unparsable refresh parameter as a plain read instead of a rescan', async () => {
    let resolves = 0
    const { fetch } = routeContext({
      workspaceRegistry: { list: () => { resolves += 1; return [{ path: project }] } },
    })

    await fetch(panelGet())
    expect(resolves).toBe(1)

    // The refresh guard answered false, so the cached scan stands and the
    // workspace is resolved once, not twice.
    await fetch(withUnparsableUrl(panelGet()))
    expect(resolves).toBe(1)

    // The documented escape still works: only an explicit 1 forces the walk.
    await fetch(panelGet(`http://localhost${RULES_ROUTE}?refresh=1`))
    expect(resolves).toBe(2)
  })

  it('answers 400 without writing state when the POST body is not JSON', async () => {
    const { fetch } = routeContext()

    const response = await fetch(panelPost('{\"action\": \"setSource\", '))
    expect(response.status).toBe(400)
    const body = await response.json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('invalid JSON body')
    // A body that never parsed never reached the write queue either.
    expect(existsSync(statePath())).toBe(false)
  })

  it('answers 500 with the write failure reason when the state file cannot be written', async () => {
    // stateDir pointed at a regular file: the directory the write needs cannot
    // be created, so writeState rejects. The route must report that reason
    // instead of letting the rejection escape as a bare transport error.
    const blocker = join(home, 'not-a-directory')
    await writeFile(blocker, 'x', 'utf8')
    const { fetch } = routeContext()
    setStateDir(blocker)
    try {
      const response = await fetch(panelPost(JSON.stringify({ action: 'setSource', key: 'codebuddy', enabled: false })))
      expect(response.status).toBe(500)
      const body = await response.json() as { ok: boolean; error: string }
      expect(body.ok).toBe(false)
      expect(body.error).toContain('EEXIST')
      expect(existsSync(statePath())).toBe(false)
    } finally {
      setStateDir(home)
      await rm(blocker, { force: true })
    }
  })

  it('sends the line a rule diagnostic knows and omits it for one that has none', async () => {
    const withLinePath = join(project, '.codebuddy', 'rules', 'line-bearing.mdc')
    await writeFile(withLinePath,
      '---\ntype: requested\ndescription: for the panel\nnot a key value line\n---\nLINE BODY\n', 'utf8')
    // Same rule type and source, but the diagnostic is about a field whose key
    // is absent from the file, so there is no line to point at.
    await writeFile(join(project, '.codebuddy', 'rules', 'without-line.mdc'),
      '---\ntype: requested\n---\nNO LINE BODY\n', 'utf8')

    const { fetch } = routeContext()
    const body = await (await fetch(panelGet())).json() as {
      rules: Array<{ name: string; diagnostics: PanelDiagnosticRow[] }>
    }

    const withLine = body.rules.find((rule) => rule.name === 'line-bearing')
    const withoutLine = body.rules.find((rule) => rule.name === 'without-line')
    expect(withLine).toBeDefined()
    expect(withoutLine).toBeDefined()

    const malformed = withLine!.diagnostics.find((row) => row.code === 'fm.malformed')
    expect(malformed).toBeDefined()
    // The number travels as its own field and nothing else is invented: a
    // reader can open the file at the line the panel prints.
    expect(Object.keys(malformed!).sort()).toEqual(['code', 'detail', 'kind', 'line'])
    expect(malformed!.kind).toBe('rule')
    const lines = (await readFile(withLinePath, 'utf8')).split('\n')
    expect(lines[malformed!.line! - 1]).toBe('not a key value line')

    const noLine = withoutLine!.diagnostics.find((row) => row.code === 'requested.noDescription')
    expect(noLine).toBeDefined()
    expect(Object.keys(noLine!).sort()).toEqual(['code', 'detail', 'kind'])
    expect('line' in noLine!).toBe(false)
  })
})
