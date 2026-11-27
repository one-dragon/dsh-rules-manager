import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultState, disabledPaths, isRuleDisabled, isSourceEnabled, readState, scopedKey,
  setStateDir, STATE_MAX_BYTES, statePath, writeState, type ManagerState,
} from '../src/state.ts'

let home: string
let previous: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dshrm-state-'))
  previous = process.env['DSH_RULES_MANAGER_HOME']
  process.env['DSH_RULES_MANAGER_HOME'] = home
})

afterEach(async () => {
  if (previous === undefined) delete process.env['DSH_RULES_MANAGER_HOME']
  else process.env['DSH_RULES_MANAGER_HOME'] = previous
  await rm(home, { recursive: true, force: true })
})

describe('defaultState', () => {
  it('enables both entries and no overrides', () => {
    const s = defaultState()
    expect(s.version).toBe(1)
    expect(s.entryLocation).toBe('both')
    expect(s.sources).toEqual({})
    expect(s.disabled).toEqual({})
    expect(s.budgets).toEqual({})
  })
})

describe('readState', () => {
  it('falls back to defaults when the file is missing', async () => {
    expect(await readState()).toEqual(defaultState())
  })

  it('falls back to defaults when the file is corrupt', async () => {
    await writeState(defaultState())
    const { writeFile } = await import('node:fs/promises')
    await writeFile(statePath(), '{ not json', 'utf8')
    expect(await readState()).toEqual(defaultState())
  })

  it('falls back when the file holds a non-object', async () => {
    await writeState(defaultState())
    const { writeFile } = await import('node:fs/promises')
    await writeFile(statePath(), '42', 'utf8')
    expect(await readState()).toEqual(defaultState())
  })

  it('accepts only the three locations it knows, and keeps the panel reachable otherwise', async () => {
    // The file is hand-editable, and the README tells people they may edit it.
    // A typo in the location used to travel straight to the panel, where no
    // button matched it; falling back to 'both' keeps every entry reachable so
    // the mistake can be undone from the panel itself.
    const { writeFile } = await import('node:fs/promises')
    for (const known of ['settings', 'sidebar', 'both'] as const) {
      await writeFile(statePath(), JSON.stringify({ ...defaultState(), entryLocation: known }), 'utf8')
      expect((await readState()).entryLocation).toBe(known)
    }
    for (const wrong of ['everywhere', 'Settings', '', 0, 1, null, true, {}, ['both']]) {
      await writeFile(statePath(), JSON.stringify({ ...defaultState(), entryLocation: wrong }), 'utf8')
      expect((await readState()).entryLocation, 'fallback for ' + JSON.stringify(wrong)).toBe('both')
    }
    // A missing field is not a wrong one: a state file written before the
    // location existed still reads, and it reads as the default layout.
    await writeFile(statePath(), JSON.stringify({ version: 1, sources: {}, disabled: {}, budgets: {} }), 'utf8')
    expect((await readState()).entryLocation).toBe('both')
  })
})

describe('writeState / readState round trip', () => {
  it('persists and reloads every field', async () => {
    const state: ManagerState = {
      version: 1,
      sources: { codebuddy: false, cursor: true },
      disabled: { codebuddy: ['/p/a.mdc'] },
      entryLocation: 'sidebar',
      budgets: { perRuleMax: 4000 },
    }
    await writeState(state)
    const back = await readState()
    expect(back.sources['codebuddy']).toBe(false)
    expect(back.disabled['codebuddy']).toEqual(['/p/a.mdc'])
    expect(back.entryLocation).toBe('sidebar')
    expect(back.budgets['perRuleMax']).toBe(4000)
  })

  it('writes valid JSON with a trailing newline', async () => {
    await writeState(defaultState())
    const raw = await readFile(statePath(), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('creates the directory when it does not exist', async () => {
    process.env['DSH_RULES_MANAGER_HOME'] = join(home, 'nested', 'deeper')
    await writeState(defaultState())
    const raw = await readFile(statePath(), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('overwrites an existing file', async () => {
    await writeState({ ...defaultState(), entryLocation: 'settings' })
    await writeState({ ...defaultState(), entryLocation: 'both' })
    expect((await readState()).entryLocation).toBe('both')
  })
})

describe('readState size ceiling', () => {
  it('exports a one-megabyte ceiling', () => {
    expect(STATE_MAX_BYTES).toBe(1_048_576)
  })

  it('refuses a state.json one byte over the ceiling', async () => {
    // The body would parse to a *different* state, so seeing the defaults
    // proves the file was refused on size and never handed to JSON.parse.
    const over = `{"entryLocation":"settings","pad":"${' '.repeat(STATE_MAX_BYTES)}"}`
    await writeFile(statePath(), over, 'utf8')
    expect(Buffer.byteLength(over, 'utf8')).toBeGreaterThan(STATE_MAX_BYTES)
    expect(await readState()).toEqual(defaultState())
  })

  it('still reads a state.json of exactly the ceiling size', async () => {
    // The boundary is inclusive: exactly STATE_MAX_BYTES is a legal file.
    const prefix = '{"entryLocation":"settings","pad":"'
    const suffix = '"}'
    const pad = ' '.repeat(STATE_MAX_BYTES - prefix.length - suffix.length)
    const exact = prefix + pad + suffix
    expect(Buffer.byteLength(exact, 'utf8')).toBe(STATE_MAX_BYTES)
    await writeFile(statePath(), exact, 'utf8')
    expect((await readState()).entryLocation).toBe('settings')
  })
})

describe('writeState symlink guard', () => {
  it('rejects a symbolic-link target and leaves the directory byte for byte as it was', async () => {
    // Measured on this host before writing the case: fs.symlink(real, link,
    // 'file') succeeds and lstat(link).isSymbolicLink() === true (Node
    // v24.11.0, win32, developer mode). No mocking is used here.
    const real = join(home, 'real-state.json')
    const link = statePath()
    const realContent = '{"version":1,"sources":{},"disabled":{},"entryLocation":"settings","budgets":{}}\n'
    await writeFile(real, realContent, 'utf8')
    await symlink(real, link, 'file')
    const resolved = await realpath(link)
    const before = (await readdir(home)).sort()

    const error = await writeState({ ...defaultState(), entryLocation: 'sidebar' })
      .then(() => null, (reason: unknown) => reason as Error)

    expect(error).toBeInstanceOf(Error)
    // Both halves of the contract in the message: the file and the reason.
    expect(error?.message).toContain('state.json')
    expect(error?.message).toContain('symbolic link')
    // The link is still a link, still pointing where it did.
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await realpath(link)).toBe(resolved)
    // The link's destination was not rewritten either.
    expect(await readFile(real, 'utf8')).toBe(realContent)
    // No temp file, and no other new entry: the refusal happened before any write.
    expect((await readdir(home)).sort()).toEqual(before)
    expect(before).not.toContain('state.json.tmp')
  })
})

describe('writeState failure keeps the previous state', () => {
  it('rejects when the temp path is a directory, leaving the existing state.json verbatim', async () => {
    await writeState({ ...defaultState(), entryLocation: 'settings' })
    const good = await readFile(statePath(), 'utf8')
    // A directory squatting on the temp path: writeFile fails with EISDIR
    // (measured on this host), so the rename never runs.
    await mkdir(`${statePath()}.tmp`)

    await expect(writeState({ ...defaultState(), entryLocation: 'sidebar' })).rejects.toThrow()

    expect(await readFile(statePath(), 'utf8')).toBe(good)
    expect((await readState()).entryLocation).toBe('settings')
  })

  it('rejects when the state directory cannot be created, leaving the existing state.json verbatim', async () => {
    await writeState({ ...defaultState(), entryLocation: 'settings' })
    const good = await readFile(statePath(), 'utf8')
    // Route the state dir through a regular file: lstat of the target is
    // ENOENT (treated as "no file yet"), and mkdir then fails with ENOTDIR
    // (measured on this host) instead of swallowing the problem.
    const blocked = join(home, 'blocker')
    await writeFile(blocked, 'not a directory', 'utf8')
    setStateDir(join(blocked, 'nested'))

    const error = await writeState(defaultState()).then(() => null, (reason: unknown) => reason as NodeJS.ErrnoException)

    setStateDir(home)
    expect(error?.code).toBe('ENOTDIR')
    expect(await readFile(statePath(), 'utf8')).toBe(good)
  })
})

describe('switch helpers', () => {
  it('treats an absent source as enabled', () => {
    expect(isSourceEnabled(defaultState(), 'codebuddy')).toBe(true)
  })

  it('honours an explicit false', () => {
    const s: ManagerState = { ...defaultState(), sources: { codebuddy: false } }
    expect(isSourceEnabled(s, 'codebuddy')).toBe(false)
  })

  it('treats an absent rule entry as not disabled', () => {
    expect(isRuleDisabled(defaultState(), 'codebuddy', '/p/a.mdc')).toBe(false)
  })

  it('honours an explicitly disabled rule', () => {
    const s: ManagerState = { ...defaultState(), disabled: { codebuddy: ['/p/a.mdc'] } }
    expect(isRuleDisabled(s, 'codebuddy', '/p/a.mdc')).toBe(true)
    expect(isRuleDisabled(s, 'codebuddy', '/p/b.mdc')).toBe(false)
    expect(isRuleDisabled(s, 'cursor', '/p/a.mdc')).toBe(false)
  })
})

describe('scoped switch helpers', () => {
  it('builds \`<scope>:<key>\` with a scope and the bare key without one', () => {
    expect(scopedKey('codebuddy', 'user')).toBe('user:codebuddy')
    expect(scopedKey('codebuddy', 'project')).toBe('project:codebuddy')
    // The legacy address: an action that names no tier keeps the bare key.
    expect(scopedKey('codebuddy')).toBe('codebuddy')
  })

  it('lets a scoped entry win over the legacy bare one', () => {
    // The defect: one key present in two tiers shared a single switch. A scoped
    // entry is read first, so the tiers are independent as soon as one is set.
    const s: ManagerState = { ...defaultState(), sources: { codebuddy: false, 'project:codebuddy': true } }
    expect(isSourceEnabled(s, 'codebuddy', 'project')).toBe(true)
    // A tier with no entry of its own still follows the bare one.
    expect(isSourceEnabled(s, 'codebuddy', 'user')).toBe(false)
  })

  it('reads the same priority for a rule', () => {
    const s: ManagerState = { ...defaultState(), disabled: { codebuddy: ['/p/a.mdc'], 'project:codebuddy': [] } }
    expect(isRuleDisabled(s, 'codebuddy', '/p/a.mdc', 'project')).toBe(false)
    expect(isRuleDisabled(s, 'codebuddy', '/p/a.mdc', 'user')).toBe(true)
    // An unrelated key stays untouched in either tier.
    expect(isRuleDisabled(s, 'cursor', '/p/a.mdc', 'project')).toBe(false)
  })

  it('hands a write the scoped list when one exists, else the bare list', () => {
    // A scoped write replaces the whole list under its key, so the starting
    // point must be the effective list or the other rules would be revived.
    const scoped: ManagerState = {
      ...defaultState(),
      disabled: { codebuddy: ['/p/a.mdc'], 'user:codebuddy': ['/p/b.mdc'] },
    }
    expect(disabledPaths(scoped, 'codebuddy', 'user')).toEqual(['/p/b.mdc'])
    expect(disabledPaths(scoped, 'codebuddy', 'project')).toEqual(['/p/a.mdc'])
    expect(disabledPaths(scoped, 'codebuddy')).toEqual(['/p/a.mdc'])
    expect(disabledPaths(defaultState(), 'codebuddy', 'user')).toEqual([])
  })
})

describe('the state location itself', () => {
  beforeEach(() => {
    // An earlier case in this file pins a directory of its own; clear the
    // override so the rung under test is the environment variable.
    setStateDir('')
  })

  afterEach(() => {
    setStateDir('')
  })

  it('reads the environment variable when nothing pinned a directory', () => {
    // `setStateDir` was not called in this case, so the middle rung of the
    // chain is the one that answers; a deployment that relocates state sets
    // exactly this variable (see the precedence note in src/state.ts).
    const configured = process.env['DSH_RULES_MANAGER_HOME']
    expect(statePath()).toBe(join(String(configured), 'state.json'))
  })

  it('falls back to the home directory when the variable is not set either', async () => {
    // Neither rung above is configured; the state lives under the user's home.
    delete process.env['DSH_RULES_MANAGER_HOME']
    expect(statePath()).toBe(join(homedir(), '.dsh', 'rules-manager', 'state.json'))
  })

  it('reads a file that names no entry location as both entries', async () => {
    // A file without the field — an older build's, or one written by hand —
    // must read back as the default rather than as an unknown location.
    await writeFile(
      statePath(),
      JSON.stringify({ version: 1, sources: {}, disabled: {} }),
      'utf8',
    )
    const state = await readState()
    expect(state.entryLocation).toBe('both')
  })

  it('refuses to write when the target path cannot be inspected at all', async () => {
    // A path the filesystem rejects outright: lstat raises ERR_INVALID_ARG_VALUE
    // (measured on this host) rather than ENOENT, so the guard must rethrow
    // instead of treating the path as "no file yet".
    setStateDir('a\u0000b')
    const error = await writeState(defaultState()).then(() => null, (reason: unknown) => reason as NodeJS.ErrnoException)
    expect(error?.code).toBe('ERR_INVALID_ARG_VALUE')
    expect(String(error?.message)).toContain('null bytes')
  })
})

