import { describe, expect, it } from 'vitest'
import { resolveWorkspace, sessionCwds, workspacePaths } from '../src/workspace.ts'

/**
 * Workspace resolution.
 *
 * The shapes here mirror the host's real services:
 * `WorkspaceRegistry.list(): Workspace[]` with a `path` accessor
 * (`dsh-workspace/src/index.ts`, `entity.ts`), and `SessionHeader.cwd?`
 * reachable through the sessions service.
 */

describe('workspacePaths', () => {
  it('reads path from each entry', () => {
    expect(workspacePaths({ list: () => [{ path: 'D:/a' }, { path: 'D:/b' }] })).toEqual(['D:/a', 'D:/b'])
  })

  it('accepts the older cwd spelling', () => {
    expect(workspacePaths({ list: () => [{ cwd: 'D:/a' }] })).toEqual(['D:/a'])
  })

  it('drops blanks, duplicates and non-strings', () => {
    expect(workspacePaths({ list: () => [{ path: ' D:/a ' }, { path: '' }, { path: '   ' }, { path: 'D:/a' }, {}, { path: 7 }] }))
      .toEqual(['D:/a'])
  })

  it('returns nothing when the service is absent or malformed', () => {
    expect(workspacePaths(undefined)).toEqual([])
    expect(workspacePaths({})).toEqual([])
    expect(workspacePaths({ list: 'nope' } as never)).toEqual([])
  })

  it('returns nothing, rather than throwing, when list() throws', () => {
    // A broken registry must not take the panel down with it.
    expect(workspacePaths({ list: () => { throw new Error('boom') } })).toEqual([])
  })

  it('returns nothing when list() is not an array', () => {
    expect(workspacePaths({ list: () => 'nope' })).toEqual([])
  })
})

describe('sessionCwds', () => {
  it('prefers the named session', () => {
    const sessions = { get: (id: string) => ({ header: { cwd: 'D:/' + id } }), list: () => [{ header: { cwd: 'D:/other' } }] }
    expect(sessionCwds(sessions, 's1')).toEqual(['D:/s1'])
  })

  it('falls back to every listed session when the id is unknown', () => {
    const sessions = { get: () => undefined, list: () => [{ header: { cwd: 'D:/a' } }, { header: { cwd: 'D:/b' } }] }
    expect(sessionCwds(sessions, 'missing')).toEqual(['D:/a', 'D:/b'])
  })

  it('lists without an id', () => {
    const sessions = { list: () => [{ header: { cwd: 'D:/a' } }] }
    expect(sessionCwds(sessions)).toEqual(['D:/a'])
  })

  it('reads a bare cwd as well as a header one', () => {
    expect(sessionCwds({ list: () => [{ cwd: 'D:/a' }] })).toEqual(['D:/a'])
  })

  it('returns nothing when absent, and never throws', () => {
    expect(sessionCwds(undefined)).toEqual([])
    expect(sessionCwds({ list: () => { throw new Error('boom') } })).toEqual([])
    expect(sessionCwds({ list: () => 'nope' })).toEqual([])
  })
})

describe('resolveWorkspace — precedence', () => {
  it('prefers the last scan root', () => {
    const out = resolveWorkspace({
      lastScanRoot: 'D:/session',
      registry: { list: () => [{ path: 'D:/registered' }] },
      sessions: { list: () => [{ header: { cwd: 'D:/session2' } }] },
    })
    expect(out).toEqual({ path: 'D:/session', source: 'last-scan', candidates: ['D:/session', 'D:/registered', 'D:/session2'] })
  })

  it('uses the registry when no scan has happened — the boot case', () => {
    // This is the reported bug: the host has just started, so there is no
    // lastScan, and the panel must still find the workspace.
    const out = resolveWorkspace({ registry: { list: () => [{ path: 'D:/booted' }] } })
    expect(out.path).toBe('D:/booted')
    expect(out.source).toBe('workspace-registry')
  })

  it('uses sessions when there is no registry', () => {
    const out = resolveWorkspace({ sessions: { list: () => [{ header: { cwd: 'D:/only-session' } }] } })
    expect(out.path).toBe('D:/only-session')
    expect(out.source).toBe('sessions')
  })

  it('prefers the registry over sessions when both exist', () => {
    const out = resolveWorkspace({
      registry: { list: () => [{ path: 'D:/registered' }] },
      sessions: { list: () => [{ header: { cwd: 'D:/session' } }] },
    })
    expect(out.path).toBe('D:/registered')
  })

  it('takes the first of several workspaces rather than giving up', () => {
    // "More than one" is not a reason to show an empty panel.
    const out = resolveWorkspace({ registry: { list: () => [{ path: 'D:/first' }, { path: 'D:/second' }] } })
    expect(out.path).toBe('D:/first')
    expect(out.candidates).toEqual(['D:/first', 'D:/second'])
  })

  it('reports no workspace, and no candidates, when nothing is available', () => {
    expect(resolveWorkspace({})).toEqual({ path: null, source: 'none', candidates: [] })
  })

  it('survives both services being absent, and reports which', () => {
    const out = resolveWorkspace({ registry: undefined, sessions: undefined, lastScanRoot: null })
    expect(out.source).toBe('none')
    expect(out.path).toBe(null)
  })

  it('ignores a blank last-scan root and falls through', () => {
    const out = resolveWorkspace({ lastScanRoot: '   ', registry: { list: () => [{ path: 'D:/reg' }] } })
    expect(out.path).toBe('D:/reg')
  })

  it('ignores a throwing registry and still uses sessions', () => {
    const out = resolveWorkspace({
      registry: { list: () => { throw new Error('boom') } },
      sessions: { list: () => [{ header: { cwd: 'D:/s' } }] },
    })
    expect(out.path).toBe('D:/s')
  })

  it('deduplicates candidates that appear in more than one source', () => {
    const out = resolveWorkspace({
      lastScanRoot: 'D:/same',
      registry: { list: () => [{ path: 'D:/same' }] },
    })
    expect(out.candidates).toEqual(['D:/same'])
  })
})

describe('sessionCwds — a sessions service that cannot list', () => {
  it('answers nothing rather than throwing when get exists but list does not', () => {
    // A partial host service: `get` was added by one version and `list` is
    // absent. The tier has to read as empty instead of raising out of the
    // panel's workspace probe.
    expect(sessionCwds({ get: () => undefined })).toEqual([])
    expect(sessionCwds({ get: () => undefined } as never, 'abc')).toEqual([])
  })

  it('still reads a named session through get alone', () => {
    expect(sessionCwds({ get: (id: string) => ({ cwd: 'D:/' + id }) }, 'abc')).toEqual(['D:/abc'])
  })
})

