import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { Config, type Config as RulesManagerConfig } from '../src/config.ts'

/**
 * Panel-side workspace switching through `?workspace=<absolute path>`.
 *
 * The host may answer with a directory the resolver itself offered, and only
 * then does it report `selected`; every other spelling of the parameter has to
 * keep behaving exactly like the query-less read. These tests drive the real
 * Fetch route through a fake cordis context, so the choice travels the same
 * path the browser panel uses.
 */

let home: string
let project: string
const prev = process.env['DSH_RULES_MANAGER_HOME']

/** One fixture workspace: a project root with a single always-on rule file. */
async function workspaceFixture(prefix: string, ruleName: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(dir, '.git'), { recursive: true })
  await mkdir(join(dir, '.codebuddy', 'rules'), { recursive: true })
  await writeFile(join(dir, '.codebuddy', 'rules', `${ruleName}.mdc`),
    `---\ndescription: ${ruleName}\nalwaysApply: true\n---\n${ruleName.toUpperCase()} BODY\n`, 'utf8')
  return dir
}

/**
 * Resolve the config the way the host does, but point state at the fixture home.
 * The schemastery default is the real `~/.dsh/rules-manager`, which would make
 * these tests write into the developer's own settings.
 */
function resolveConfig(value: Record<string, unknown> = {}): RulesManagerConfig {
  return (Config as unknown as (v: unknown) => RulesManagerConfig)({ stateDir: home, ...value })
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

type WorkspaceBody = {
  rules: Array<Record<string, unknown>>
  scannedAt: number
  workspace: { path: string | null; source: string; options?: readonly string[] }
}

/**
 * Boot the plugin against one registry list and return readers for its route.
 *
 * `workspace` is appended the way the client appends it: URL-encoded, so a
 * Windows path survives the query string as the same absolute spelling.
 */
function boot(workspaces: readonly string[]) {
  const conn = connectionStub()
  const services: Record<string, unknown> = {
    connection: conn.service,
    workspaceRegistry: { list: () => workspaces.map((path) => ({ path })) },
  }
  const ctx = {
    tools: { register: () => {} },
    on: () => {},
    workingDirectory: { ensure: () => Promise.resolve(project) },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback() },
    inject: (names: string[], callback: (scoped: unknown) => void) => {
      if (names.every((name) => services[name] !== undefined)) {
        callback(Object.assign(Object.create(null), ctx, services))
      }
    },
  }
  apply(ctx as never, resolveConfig())

  const route = conn.routes[0]!['fetch'] as (request?: Request) => Promise<Response>
  const query = (workspace?: string) => workspace === undefined ? '' : `?workspace=${encodeURIComponent(workspace)}`
  const get = async (workspace?: string): Promise<WorkspaceBody> => {
    const response = await route(new Request(`http://localhost/x${query(workspace)}`))
    return await response.json() as WorkspaceBody
  }
  const post = async (action: Record<string, unknown>, workspace?: string): Promise<WorkspaceBody> => {
    const response = await route(new Request(`http://localhost/x${query(workspace)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action),
    }))
    return await response.json() as WorkspaceBody
  }
  return { get, post }
}

const names = (body: WorkspaceBody) => body.rules.map((rule) => rule['name'])

let extras: string[]

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dshrm-sel-home-'))
  project = await workspaceFixture('dshrm-sel-first-', 'first')
  extras = []
  process.env['DSH_RULES_MANAGER_HOME'] = home
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of [project, ...extras]) await rm(dir, { recursive: true, force: true })
  extras = []
  if (prev === undefined) delete process.env['DSH_RULES_MANAGER_HOME']
  else process.env['DSH_RULES_MANAGER_HOME'] = prev
})

describe('panel workspace selection through the query string', () => {
  it('offers every candidate and keeps the first workspace as the default', async () => {
    // The switch is only usable if the panel learns the alternatives, and the
    // list must include the directory currently shown, so the client can mark it.
    const second = await workspaceFixture('dshrm-sel-second-', 'second')
    extras.push(second)
    const { get } = boot([project, second])

    const body = await get()
    expect(body.workspace.path).toBe(project)
    expect(body.workspace.source).toBe('workspace-registry')
    expect(body.workspace.options).toEqual([project, second])
    expect(names(body)).toContain('first')
    expect(names(body)).not.toContain('second')
  })

  it('scans the workspace the panel names and reports it as selected', async () => {
    const second = await workspaceFixture('dshrm-sel-second-', 'second')
    extras.push(second)
    const { get } = boot([project, second])

    const body = await get(second)
    expect(body.workspace.path).toBe(second)
    expect(body.workspace.source).toBe('selected')
    expect(body.workspace.options).toEqual([project, second])
    expect(names(body)).toContain('second')
    expect(names(body)).not.toContain('first')
  })

  it('returns to the first workspace after reading another one', async () => {
    // The on-demand scan is a single slot, so a slot filled for B must not
    // answer a later read of A; the TTL alone would happily serve B's rules.
    const second = await workspaceFixture('dshrm-sel-second-', 'second')
    extras.push(second)
    const { get } = boot([project, second])

    const first = await get()
    const other = await get(second)
    const back = await get()
    expect(first.workspace.path).toBe(project)
    expect(other.workspace.path).toBe(second)
    expect(back.workspace.path).toBe(project)
    expect(back.workspace.source).toBe('workspace-registry')
    expect(names(back)).toContain('first')
    expect(names(back)).not.toContain('second')
  })

  it('ignores a workspace the resolver never named', async () => {
    // Not every directory the user can spell is one this host offered; scanning
    // it would let a hand-edited parameter point the panel anywhere.
    const second = await workspaceFixture('dshrm-sel-second-', 'second')
    const outsider = await workspaceFixture('dshrm-sel-outsider-', 'outsider')
    extras.push(second, outsider)
    const { get } = boot([project, second])

    const body = await get(outsider)
    expect(body.workspace.path).toBe(project)
    expect(body.workspace.source).toBe('workspace-registry')
    expect(names(body)).toContain('first')
    expect(names(body)).not.toContain('outsider')
  })

  it('ignores a relative workspace name', async () => {
    const { get } = boot([project])
    const body = await get('relative/path')
    expect(body.workspace.path).toBe(project)
    expect(body.workspace.source).toBe('workspace-registry')
  })

  it('ignores an empty workspace parameter', async () => {
    const { get } = boot([project])
    const empty = await get('')
    expect(empty.workspace.path).toBe(project)
    expect(empty.workspace.source).toBe('workspace-registry')
  })

  it('treats a trailing separator as the same directory', async () => {
    // The client may round-trip either spelling of the same directory.
    const second = await workspaceFixture('dshrm-sel-second-', 'second')
    extras.push(second)
    const { get } = boot([project, second])

    const body = await get(`${second}/`)
    expect(body.workspace.path).toBe(second)
    expect(body.workspace.source).toBe('selected')
  })

  it('keeps the named workspace on a POST write', async () => {
    // A write carries the workspace in its own query: answering it from the
    // default workspace made a switched panel jump back on the first toggle.
    const second = await workspaceFixture('dshrm-sel-second-', 'second')
    extras.push(second)
    const { get, post } = boot([project, second])
    await get(second)

    const target = join(second, '.codebuddy', 'rules', 'second.mdc')
    const body = await post({ action: 'setRule', key: 'codebuddy', path: target, enabled: false }, second)
    expect(body.workspace.path).toBe(second)
    expect(body.workspace.source).toBe('selected')
    expect(body.workspace.options).toEqual([project, second])
    expect(body.rules.find((rule) => rule['path'] === target)?.['active']).toBe(false)
  })

  it('never rescans a workspace the resolver never named on a write', async () => {
    const second = await workspaceFixture('dshrm-sel-second-', 'second')
    const outsider = await workspaceFixture('dshrm-sel-outsider-', 'outsider')
    extras.push(second, outsider)
    const { get, post } = boot([project, second])
    await get()

    const body = await post({ action: 'setSource', key: 'codebuddy', enabled: true }, outsider)
    expect(body.workspace.path).toBe(project)
    expect(names(body)).not.toContain('outsider')
    expect(names(body)).toContain('first')
  })
})
