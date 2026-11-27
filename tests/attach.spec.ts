/**
 * Unit tests for `src/attach.ts` - the touched-file log and the file-scoped
 * attachment of on-demand rules.
 *
 * The module is almost pure string/path logic: `touchedFilesOf` and
 * `createTouches` never touch the filesystem, and `attachedRules` receives the
 * project root and the working directory as plain strings. Most cases are
 * therefore written with synthetic absolute paths. The cases that exercise
 * relative-path resolution use a real mkdtemp fixture, because the module
 * resolves through `node:path`, whose behaviour is platform-native.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  attachedRules,
  createTouches,
  MAX_COMPILED_RULES,
  MAX_TOUCHED_PATHS,
  touchedFilesOf,
} from '../src/attach.ts'
import type { AttachInput } from '../src/attach.ts'
import type { Rule } from '../src/types.ts'

/**
 * One literal backslash, spelled without an escape sequence so the Windows
 * fixtures below read as the paths they are.
 */
const BACKSLASH = String.fromCharCode(92)

type RuleOverrides = Partial<Rule> & Pick<Rule, 'path' | 'type'>

/** A realistic Rule, the shape `tests/render.spec.ts` uses for the same type. */
function mkRule(over: RuleOverrides): Rule {
  return {
    path: over.path,
    name: over.name ?? 'rule',
    type: over.type,
    enabled: over.enabled ?? true,
    description: over.description ?? '',
    body: over.body ?? 'BODY',
    family: over.family ?? 'cursor',
    sourceKey: over.sourceKey ?? 'cursor',
    scope: over.scope ?? 'project',
    patterns: over.patterns ?? [],
    descriptionTokens: over.descriptionTokens ?? 1,
    bodyTokens: over.bodyTokens ?? 1,
    diagnostics: over.diagnostics ?? [],
  }
}

/** `attachedRules` with the synthetic project used by most cases. */
function run(over: Partial<AttachInput> & Pick<AttachInput, 'rules' | 'touched'>) {
  return attachedRules({ cwd: '/proj', projectRoot: '/proj', ...over })
}

let fixtureRoot = ''
let userRulesDir = ''

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'dshrm-attach-'))
  userRulesDir = join(fixtureRoot, '.cursor', 'rules')
  await mkdir(join(fixtureRoot, 'src'), { recursive: true })
  await mkdir(join(fixtureRoot, 'other', 'src'), { recursive: true })
  await mkdir(join(userRulesDir, 'src'), { recursive: true })
})

afterAll(async () => {
  if (fixtureRoot !== '') await rm(fixtureRoot, { recursive: true, force: true })
})

describe('bounds', () => {
  it('keeps 2000 touched paths', () => {
    expect(MAX_TOUCHED_PATHS).toBe(2000)
  })

  it('compiles at most 256 rules per resolution', () => {
    expect(MAX_COMPILED_RULES).toBe(256)
  })
})

describe('touchedFilesOf - documented file-path fields', () => {
  it.each([
    ['read', 'file_path'],
    ['read_image', 'file_path'],
    ['write', 'file_path'],
    ['edit', 'file_path'],
    ['str_replace_editor', 'path'],
  ])('%s reads %s', (tool, field) => {
    expect(touchedFilesOf(tool, { [field]: '/a/b.ts' })).toEqual(['/a/b.ts'])
  })

  it.each([
    ['read', 'path'],
    ['write', 'path'],
    ['edit', 'path'],
    ['read_image', 'path'],
    ['str_replace_editor', 'file_path'],
  ])('%s ignores the other convention\'s field %s', (tool, field) => {
    expect(touchedFilesOf(tool, { [field]: '/a/b.ts' })).toEqual([])
  })

  it('reads the field even when the arguments carry unrelated keys', () => {
    const args = { file_path: '/a/b.ts', path: '/ignored.ts', limit: 20, view: 'text' }
    expect(touchedFilesOf('read', args)).toEqual(['/a/b.ts'])
  })

  it('returns the value trimmed', () => {
    expect(touchedFilesOf('read', { file_path: '  /a/b.ts  ' })).toEqual(['/a/b.ts'])
    expect(touchedFilesOf('edit', { file_path: '\t/a/b.ts\n' })).toEqual(['/a/b.ts'])
  })

  it('is case-sensitive about the tool name', () => {
    expect(touchedFilesOf('Read', { file_path: '/a/b.ts' })).toEqual([])
    expect(touchedFilesOf('APPLY_PATCH', { input: '*** Add File: a.ts' })).toEqual([])
  })

  it('does not treat apply_patch as a file_path tool', () => {
    expect(touchedFilesOf('apply_patch', { file_path: '/a/b.ts' })).toEqual([])
  })
})

describe('touchedFilesOf - apply_patch documents', () => {
  it('returns every file named by the four line forms, in document order', () => {
    const document = [
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+export const a = 1',
      '*** Update File: src/old.ts',
      '@@',
      '-old',
      '+new',
      '*** Move to: src/moved.ts',
      '*** Delete File: src/gone.ts',
      '*** End Patch',
    ].join('\n')

    expect(touchedFilesOf('apply_patch', { input: document })).toEqual([
      'src/new.ts',
      'src/old.ts',
      'src/moved.ts',
      'src/gone.ts',
    ])
  })

  it('returns the move destination, not the source header, for a bare move', () => {
    expect(touchedFilesOf('apply_patch', { input: '*** Move to: dst/here.ts' })).toEqual(['dst/here.ts'])
  })

  it('returns only the destination when the source is named by a diff header', () => {
    const document = ['--- a/src/old.ts', '+++ b/src/new.ts', '*** Move to: src/moved.ts'].join('\n')
    expect(touchedFilesOf('apply_patch', { input: document })).toEqual(['src/moved.ts'])
  })

  it('returns several moves in order', () => {
    const document = ['*** Move to: a.ts', '*** Move to: b.ts', '*** Add File: c.ts'].join('\n')
    expect(touchedFilesOf('apply_patch', { input: document })).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('trims each patch filename', () => {
    expect(touchedFilesOf('apply_patch', { input: '*** Add File:   src/x.ts  \n' })).toEqual(['src/x.ts'])
  })

  it('handles a CRLF patch document', () => {
    const document = '*** Add File: a.ts\r\n*** Update File: b.ts\r\n'
    expect(touchedFilesOf('apply_patch', { input: document })).toEqual(['a.ts', 'b.ts'])
  })

  it('ignores header-like text that does not start a line', () => {
    const document = [
      'note: *** Add File: not-a-header.ts',
      '+*** Update File: also-not.ts',
      '*** Add File: real.ts',
    ].join('\n')
    expect(touchedFilesOf('apply_patch', { input: document })).toEqual(['real.ts'])
  })

  it('ignores a blank filename', () => {
    expect(touchedFilesOf('apply_patch', { input: '*** Add File:' })).toEqual([])
    expect(touchedFilesOf('apply_patch', { input: '*** Add File:  ' })).toEqual([])
  })

  it('ignores unknown patch verbs and lowercase variants', () => {
    const document = ['*** Rename File: a.ts', '*** add file: b.ts', '*** Move To: c.ts'].join('\n')
    expect(touchedFilesOf('apply_patch', { input: document })).toEqual([])
  })

  it('returns nothing for a patch with no file headers', () => {
    expect(touchedFilesOf('apply_patch', { input: '*** Begin Patch\n*** End Patch' })).toEqual([])
  })

  it('returns nothing for an empty patch string', () => {
    expect(touchedFilesOf('apply_patch', { input: '' })).toEqual([])
  })

  it('returns nothing when the input is missing or not a string', () => {
    expect(touchedFilesOf('apply_patch', {})).toEqual([])
    expect(touchedFilesOf('apply_patch', { input: undefined })).toEqual([])
    expect(touchedFilesOf('apply_patch', { input: null })).toEqual([])
    expect(touchedFilesOf('apply_patch', { input: 42 })).toEqual([])
    expect(touchedFilesOf('apply_patch', { input: { text: '*** Add File: a.ts' } })).toEqual([])
    expect(touchedFilesOf('apply_patch', { input: ['*** Add File: a.ts'] })).toEqual([])
  })

  it('returns nothing when the arguments are an array', () => {
    expect(touchedFilesOf('apply_patch', ['*** Add File: a.ts'])).toEqual([])
  })
})

describe('touchedFilesOf - malformed input returns an empty list and never throws', () => {
  it.each([undefined, null, 42, true, {}, [], '', 'bash', 'unknown-tool'])(
    'non-string or unknown tool name %j',
    (toolName) => {
      expect(touchedFilesOf(toolName, { file_path: '/a/b.ts' })).toEqual([])
      expect(touchedFilesOf(toolName, { input: '*** Add File: a.ts' })).toEqual([])
    },
  )

  it.each([null, undefined, 'file_path', 42, true, () => '/a/b.ts'])(
    'non-object args %j',
    (args) => {
      expect(touchedFilesOf('read', args)).toEqual([])
      expect(touchedFilesOf('apply_patch', args)).toEqual([])
    },
  )

  it('accepts a null-prototype argument object', () => {
    const bare = Object.create(null) as Record<string, unknown>
    bare['file_path'] = '/a/b.ts'
    expect(touchedFilesOf('read', bare)).toEqual(['/a/b.ts'])
  })

  it('returns nothing when the field is missing', () => {
    expect(touchedFilesOf('read', {})).toEqual([])
    expect(touchedFilesOf('str_replace_editor', { file_path: '/a/b.ts' })).toEqual([])
  })

  it.each([
    ['read', 'file_path'],
    ['read_image', 'file_path'],
    ['write', 'file_path'],
    ['edit', 'file_path'],
    ['str_replace_editor', 'path'],
  ])('%s returns nothing for a non-string %s', (tool, field) => {
    expect(touchedFilesOf(tool, { [field]: 42 })).toEqual([])
    expect(touchedFilesOf(tool, { [field]: null })).toEqual([])
    expect(touchedFilesOf(tool, { [field]: undefined })).toEqual([])
    expect(touchedFilesOf(tool, { [field]: true })).toEqual([])
    expect(touchedFilesOf(tool, { [field]: {} })).toEqual([])
    expect(touchedFilesOf(tool, { [field]: ['/a/b.ts'] })).toEqual([])
  })

  it.each([
    ['read', 'file_path'],
    ['read_image', 'file_path'],
    ['write', 'file_path'],
    ['edit', 'file_path'],
    ['str_replace_editor', 'path'],
  ])('%s returns nothing for empty or whitespace-only %s', (tool, field) => {
    expect(touchedFilesOf(tool, { [field]: '' })).toEqual([])
    expect(touchedFilesOf(tool, { [field]: '   ' })).toEqual([])
    expect(touchedFilesOf(tool, { [field]: '\t\n ' })).toEqual([])
  })

  it('survives a battery of hostile inputs without throwing', () => {
    const names = [undefined, null, 0, '', 'read', 'apply_patch', {}, [], Symbol('t')]
    const argv = [undefined, null, 0, '', {}, [], 'x', true]
    for (const name of names) {
      for (const args of argv) {
        expect(() => touchedFilesOf(name, args)).not.toThrow()
        expect(touchedFilesOf(name, args)).toEqual([])
      }
    }
  })
})

describe('createTouches - ordering, dedupe and the bound', () => {
  it('keeps insertion order across calls', () => {
    const touches = createTouches()
    touches.record(['/a.ts', '/b.ts'])
    touches.record(['/c.ts'])
    expect(touches.list()).toEqual(['/a.ts', '/b.ts', '/c.ts'])
  })

  it('deduplicates repeats inside one call', () => {
    const touches = createTouches()
    touches.record(['/a.ts', '/a.ts', '/b.ts', '/a.ts'])
    expect(touches.list()).toEqual(['/a.ts', '/b.ts'])
  })

  it('deduplicates repeats across calls without moving the entry', () => {
    const touches = createTouches()
    touches.record(['/a.ts', '/b.ts'])
    touches.record(['/b.ts', '/a.ts'])
    expect(touches.list()).toEqual(['/a.ts', '/b.ts'])
  })

  it('evicts the oldest entry first at the bound', () => {
    const touches = createTouches(3)
    touches.record(['/a.ts', '/b.ts', '/c.ts'])
    expect(touches.list()).toEqual(['/a.ts', '/b.ts', '/c.ts'])
    touches.record(['/d.ts'])
    expect(touches.list()).toEqual(['/b.ts', '/c.ts', '/d.ts'])
  })

  it('never holds more entries than max, even from one oversized call', () => {
    const touches = createTouches(2)
    touches.record(['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts'])
    expect(touches.list()).toEqual(['/d.ts', '/e.ts'])
    expect(touches.list().length).toBe(2)
  })

  it('makes a dropped path new again when it is recorded again', () => {
    const touches = createTouches(2)
    touches.record(['/a.ts', '/b.ts'])
    touches.record(['/c.ts'])
    expect(touches.list()).toEqual(['/b.ts', '/c.ts'])
    touches.record(['/a.ts'])
    expect(touches.list()).toEqual(['/c.ts', '/a.ts'])
  })

  it('keeps only the newest entry at max = 1', () => {
    const touches = createTouches(1)
    touches.record(['/a.ts'])
    touches.record(['/b.ts'])
    expect(touches.list()).toEqual(['/b.ts'])
  })

  it('holds nothing at max = 0', () => {
    const touches = createTouches(0)
    touches.record(['/a.ts', '/b.ts'])
    expect(touches.list()).toEqual([])
  })

  it('ignores an empty recording', () => {
    const touches = createTouches(3)
    touches.record([])
    expect(touches.list()).toEqual([])
  })

  it('returns the same array from list() and reflects later recordings', () => {
    const touches = createTouches()
    const first = touches.list()
    expect(touches.list()).toBe(first)
    touches.record(['/a.ts'])
    expect(first).toHaveLength(1)
    expect(first).toContain('/a.ts')
  })

  it('bounds the log at MAX_TOUCHED_PATHS by default', () => {
    const touches = createTouches()
    const files = Array.from({ length: MAX_TOUCHED_PATHS + 1 }, (_, i) => `/p/f${i}.ts`)
    touches.record(files)
    const kept = touches.list()
    expect(kept).toHaveLength(MAX_TOUCHED_PATHS)
    expect(kept[0]).toBe('/p/f1.ts')
    expect(kept[kept.length - 1]).toBe(`/p/f${MAX_TOUCHED_PATHS}.ts`)
  })

  it('treats paths as opaque strings, so case and separators are not normalized', () => {
    const windowsPath = ['C:', 'x', 'y.ts'].join(BACKSLASH)
    const touches = createTouches()
    touches.record(['/A.ts', '/a.ts', windowsPath])
    expect(touches.list()).toEqual(['/A.ts', '/a.ts', windowsPath])
  })
})

describe('attachedRules - which rules are candidates', () => {
  const projectRule = mkRule({
    path: '/proj/.cursor/rules/ts.mdc',
    type: 'requested',
    patterns: ['src/**/*.ts'],
  })
  const touched = ['/proj/src/app.ts']

  it('attaches a requested project rule whose pattern matches a touched file', () => {
    const result = run({ rules: [projectRule], touched })
    expect(result.attached).toBeInstanceOf(Set)
    expect([...result.attached]).toEqual(['/proj/.cursor/rules/ts.mdc'])
    expect(result.diagnostics).toEqual([])
  })

  it('does not attach a requested rule whose pattern matches nothing', () => {
    const rule = mkRule({ path: '/proj/r.md', type: 'requested', patterns: ['lib/**/*.rs'] })
    expect(run({ rules: [rule], touched }).attached.size).toBe(0)
  })

  it('does not attach an always-on rule even when its pattern matches', () => {
    const rule = mkRule({ path: '/proj/r.md', type: 'always', patterns: ['src/**/*.ts'] })
    expect(run({ rules: [rule], touched }).attached.size).toBe(0)
  })

  it('does not attach a manual rule even when its pattern matches', () => {
    const rule = mkRule({ path: '/proj/r.md', type: 'manual', patterns: ['src/**/*.ts'] })
    expect(run({ rules: [rule], touched }).attached.size).toBe(0)
  })

  it('does not attach a disabled rule even when its pattern matches', () => {
    const rule = mkRule({ path: '/proj/r.md', type: 'requested', enabled: false, patterns: ['src/**/*.ts'] })
    expect(run({ rules: [rule], touched }).attached.size).toBe(0)
  })

  it('does not attach a requested rule with no patterns', () => {
    const rule = mkRule({ path: '/proj/r.md', type: 'requested', patterns: [] })
    expect(run({ rules: [rule], touched }).attached.size).toBe(0)
  })

  it('skips blank patterns silently', () => {
    const blank = mkRule({ path: '/proj/blank.md', type: 'requested', patterns: [''] })
    const spaces = mkRule({ path: '/proj/spaces.md', type: 'requested', patterns: ['   ', '\t'] })
    const result = run({ rules: [blank, spaces], touched })
    expect(result.attached.size).toBe(0)
    expect(result.diagnostics).toEqual([])
  })

  it('attaches every matching rule and only those', () => {
    const a = mkRule({ path: '/proj/a.md', type: 'requested', patterns: ['src/**/*.ts'] })
    const b = mkRule({ path: '/proj/b.md', type: 'requested', patterns: ['**/*.tsx'] })
    const c = mkRule({ path: '/proj/c.md', type: 'requested', patterns: ['docs/**'] })
    const result = run({ rules: [a, b, c], touched: ['/proj/src/x.ts', '/proj/ui/y.tsx'] })
    expect([...result.attached].sort()).toEqual(['/proj/a.md', '/proj/b.md'])
  })

  it('reports rule paths, never rule names', () => {
    const rule = mkRule({ path: '/proj/deep/path/ts.mdc', name: 'ts-standard', type: 'requested', patterns: ['src/**/*.ts'] })
    const result = run({ rules: [rule], touched })
    expect([...result.attached]).toEqual(['/proj/deep/path/ts.mdc'])
  })

  it('returns an empty set for an empty rule list', () => {
    const result = run({ rules: [], touched })
    expect(result.attached.size).toBe(0)
    expect(result.diagnostics).toEqual([])
  })
})

describe('attachedRules - the base directory', () => {
  it('matches project rules relative to projectRoot', () => {
    const rule = mkRule({ path: '/proj/rules/ts.mdc', type: 'requested', scope: 'project', patterns: ['src/**/*.ts'] })
    expect(run({ rules: [rule], touched: ['/proj/src/app.ts'] }).attached.size).toBe(1)
  })

  it('does not match a project rule against a file outside projectRoot', () => {
    const rule = mkRule({ path: '/proj/rules/ts.mdc', type: 'requested', scope: 'project', patterns: ['src/**/*.ts'] })
    expect(run({ rules: [rule], touched: ['/other/src/app.ts'] }).attached.size).toBe(0)
  })

  it('rejects the project root itself, which has no base-relative path', () => {
    const rule = mkRule({ path: '/proj/rules/ts.mdc', type: 'requested', scope: 'project', patterns: ['**'] })
    expect(run({ rules: [rule], touched: ['/proj'] }).attached.size).toBe(0)
  })

  it('tolerates a trailing separator on projectRoot', () => {
    const rule = mkRule({ path: '/proj/rules/ts.mdc', type: 'requested', scope: 'project', patterns: ['src/**/*.ts'] })
    expect(run({ rules: [rule], touched: ['/proj/src/app.ts'], projectRoot: '/proj/' }).attached.size).toBe(1)
  })

  it('falls back to cwd when projectRoot is null', () => {
    const rule = mkRule({ path: '/proj/rules/ts.mdc', type: 'requested', scope: 'project', patterns: ['src/**/*.ts'] })
    const result = run({ rules: [rule], touched: ['/proj/src/app.ts'], cwd: '/proj', projectRoot: null })
    expect(result.attached.size).toBe(1)
  })

  it('does not fall back to cwd when projectRoot names another directory', () => {
    const rule = mkRule({ path: '/proj/rules/ts.mdc', type: 'requested', scope: 'project', patterns: ['src/**/*.ts'] })
    const result = run({ rules: [rule], touched: ['/proj/src/app.ts'], cwd: '/proj', projectRoot: '/elsewhere' })
    expect(result.attached.size).toBe(0)
  })

  it('matches user rules relative to the directory holding the rule file', () => {
    const rulePath = join(userRulesDir, 'ts.mdc')
    const rule = mkRule({ path: rulePath, type: 'requested', scope: 'user', patterns: ['src/**/*.ts'] })
    const touched = [join(userRulesDir, 'src', 'app.ts')]
    const result = run({ rules: [rule], touched, cwd: fixtureRoot, projectRoot: fixtureRoot })
    expect([...result.attached]).toEqual([rulePath])
  })

  it('does not match a user rule against an otherwise identical project file', () => {
    const rulePath = join(userRulesDir, 'ts.mdc')
    const rule = mkRule({ path: rulePath, type: 'requested', scope: 'user', patterns: ['src/**/*.ts'] })
    const touched = [join(fixtureRoot, 'src', 'app.ts')]
    expect(run({ rules: [rule], touched, cwd: fixtureRoot, projectRoot: fixtureRoot }).attached.size).toBe(0)
  })

  it('uses the rule file directory for a user rule even when projectRoot is set', () => {
    const rulePath = join(userRulesDir, 'ts.mdc')
    const rule = mkRule({ path: rulePath, type: 'requested', scope: 'user', patterns: ['**/*.ts'] })
    const projectFile = [join(fixtureRoot, 'src', 'app.ts')]
    expect(run({ rules: [rule], touched: projectFile, cwd: fixtureRoot, projectRoot: fixtureRoot }).attached.size).toBe(0)
    const userFile = [join(userRulesDir, 'any', 'deep.ts')]
    expect(run({ rules: [rule], touched: userFile, cwd: fixtureRoot, projectRoot: fixtureRoot }).attached.size).toBe(1)
  })

  it('resolves a relative touched path against cwd', () => {
    const rule = mkRule({ path: join(fixtureRoot, 'rules', 'ts.mdc'), type: 'requested', scope: 'project', patterns: ['src/**/*.ts'] })
    const result = run({ rules: [rule], touched: ['src/app.ts'], cwd: fixtureRoot, projectRoot: fixtureRoot })
    expect(result.attached.size).toBe(1)
  })

  it('uses an absolute touched path as-is', () => {
    const rule = mkRule({ path: join(fixtureRoot, 'rules', 'ts.mdc'), type: 'requested', scope: 'project', patterns: ['src/**/*.ts'] })
    const absolute = resolve(fixtureRoot, 'src/app.ts')
    expect(absolute.startsWith(fixtureRoot)).toBe(true)
    const result = run({ rules: [rule], touched: [absolute], cwd: fixtureRoot, projectRoot: fixtureRoot })
    expect(result.attached.size).toBe(1)
  })

  it('resolves a relative path against cwd, not against projectRoot', () => {
    const rule = mkRule({ path: '/proj/rules/ts.mdc', type: 'requested', scope: 'project', patterns: ['**/*.ts'] })
    const touched = ['src/app.ts']
    expect(run({ rules: [rule], touched, cwd: fixtureRoot, projectRoot: fixtureRoot }).attached.size).toBe(1)
    expect(run({ rules: [rule], touched, cwd: fixtureRoot, projectRoot: join(fixtureRoot, 'other') }).attached.size).toBe(0)
  })

  it('normalizes Windows separators on both sides', () => {
    // Absolute on every platform, and the root is spelled with forward slashes
    // on purpose: a drive-letter root is absolute only under win32, so `node:path`
    // rewrites `D:\proj` into a nonsense path on posix and the rule never matches
    // there. Only the separators *inside* the two paths stay Windows-shaped, which
    // is the normalization this case is about.
    const sep = BACKSLASH
    const projectRoot = '/proj'
    const rule = mkRule({
      path: [projectRoot, '.cursor', 'rules', 'ts.mdc'].join(sep),
      type: 'requested',
      scope: 'project',
      patterns: ['src/**/*.ts'],
    })
    const touched = [[projectRoot, 'src', 'app.ts'].join(sep)]
    const result = run({ rules: [rule], touched, cwd: projectRoot, projectRoot })
    expect(result.attached.size).toBe(1)
  })
})

describe('attachedRules - empty touched list', () => {
  it('returns an empty set and no diagnostics', () => {
    const rule = mkRule({ path: '/proj/rules/ts.mdc', type: 'requested', patterns: ['**/*.ts'] })
    const result = run({ rules: [rule], touched: [] })
    expect(result.attached.size).toBe(0)
    expect(result.diagnostics).toEqual([])
  })

  it('does not even compile patterns, so no pattern diagnostic is produced', () => {
    const catastrophic = mkRule({ path: '/proj/bad.md', type: 'requested', patterns: ['*a*a*a*a*a*a*a*a*a*.ts'] })
    const result = run({ rules: [catastrophic], touched: [] })
    expect(result.diagnostics).toEqual([])
  })
})

describe('attachedRules - compiled-rule cap', () => {
  function matchingRules(count: number): Rule[] {
    return Array.from({ length: count }, (_, i) => mkRule({
      path: `/proj/.cursor/rules/r${i}.mdc`,
      type: 'requested',
      scope: 'project',
      patterns: ['src/**/*.ts'],
    }))
  }

  it('compiles up to the cap and reports the first rule past it once', () => {
    const rules = matchingRules(MAX_COMPILED_RULES + 4)
    const result = run({ rules, touched: ['/proj/src/app.ts'] })
    expect(result.attached.size).toBe(MAX_COMPILED_RULES)
    expect(result.diagnostics).toHaveLength(1)
    const diagnostic = result.diagnostics[0]
    expect(diagnostic?.code).toBe('attach.limit')
    expect(diagnostic?.path).toBe(`/proj/.cursor/rules/r${MAX_COMPILED_RULES}.mdc`)
    expect(diagnostic?.detail).toContain(String(MAX_COMPILED_RULES))
    expect(result.attached.has(`/proj/.cursor/rules/r${MAX_COMPILED_RULES}.mdc`)).toBe(false)
  })

  it('does not count non-candidate rules against the cap', () => {
    const skipped = [
      mkRule({ path: '/proj/s1.md', type: 'always', patterns: ['src/**/*.ts'] }),
      mkRule({ path: '/proj/s2.md', type: 'manual', patterns: ['src/**/*.ts'] }),
      mkRule({ path: '/proj/s3.md', type: 'requested', enabled: false, patterns: ['src/**/*.ts'] }),
      mkRule({ path: '/proj/s4.md', type: 'requested', patterns: [] }),
    ]
    const rules = [...skipped, ...matchingRules(MAX_COMPILED_RULES + 1)]
    const result = run({ rules, touched: ['/proj/src/app.ts'] })
    expect(result.attached.size).toBe(MAX_COMPILED_RULES)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.code).toBe('attach.limit')
    expect(result.diagnostics[0]?.path).toBe(`/proj/.cursor/rules/r${MAX_COMPILED_RULES}.mdc`)
  })

  it('emits no limit diagnostic when every rule is a non-candidate', () => {
    const rules = Array.from({ length: MAX_COMPILED_RULES + 10 }, (_, i) => mkRule({
      path: `/proj/off${i}.md`,
      type: 'requested',
      enabled: false,
      patterns: ['src/**/*.ts'],
    }))
    const result = run({ rules, touched: ['/proj/src/app.ts'] })
    expect(result.attached.size).toBe(0)
    expect(result.diagnostics).toEqual([])
  })
})

describe('attachedRules - pattern diagnostics', () => {
  it('warns and skips a rule whose only pattern is catastrophic', () => {
    const rule = mkRule({ path: '/proj/bad.md', type: 'requested', patterns: ['*a*a*a*a*a*a*a*a*a*.ts'] })
    const result = run({ rules: [rule], touched: ['/proj/src/a.ts'] })
    expect(result.attached.size).toBe(0)
    expect(result.diagnostics).toHaveLength(1)
    const diagnostic = result.diagnostics[0]
    expect(diagnostic?.code).toBe('attach.pattern')
    expect(diagnostic?.path).toBe('/proj/bad.md')
    expect(diagnostic?.detail).toContain('回溯风险')
  })

  it('warns about a catastrophic pattern but still attaches through a good sibling', () => {
    const rule = mkRule({
      path: '/proj/mixed.md',
      type: 'requested',
      patterns: ['*a*a*a*a*a*a*a*a*a*.ts', 'src/**/*.ts'],
    })
    const result = run({ rules: [rule], touched: ['/proj/src/a.ts'] })
    expect([...result.attached]).toEqual(['/proj/mixed.md'])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.code).toBe('attach.pattern')
    expect(result.diagnostics[0]?.path).toBe('/proj/mixed.md')
  })

  it('reports one diagnostic per bad pattern', () => {
    const rule = mkRule({
      path: '/proj/two-bad.md',
      type: 'requested',
      patterns: ['*a*a*a*a*a*a*a*a*a*.ts', '*b*b*b*b*b*b*b*b*b*.ts'],
    })
    const result = run({ rules: [rule], touched: ['/proj/src/a.ts'] })
    expect(result.attached.size).toBe(0)
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics.every((d) => d.code === 'attach.pattern' && d.path === '/proj/two-bad.md')).toBe(true)
  })

  it('keeps diagnostics attributed to the rule that produced them', () => {
    const bad = mkRule({ path: '/proj/bad.md', type: 'requested', patterns: ['*a*a*a*a*a*a*a*a*a*.ts'] })
    const good = mkRule({ path: '/proj/good.md', type: 'requested', patterns: ['src/**/*.ts'] })
    const result = run({ rules: [bad, good], touched: ['/proj/src/a.ts'] })
    expect([...result.attached]).toEqual(['/proj/good.md'])
    expect(result.diagnostics.map((d) => d.path)).toEqual(['/proj/bad.md'])
  })

  it('does not warn about a pattern picomatch merely cannot read', () => {
    // Measured in tests/globs.spec.ts: picomatch does not throw on this shape,
    // it compiles a matcher that never matches. No warning is produced and the
    // rule simply does not attach.
    const rule = mkRule({ path: '/proj/broken.md', type: 'requested', patterns: ['BAD[[[pattern'] })
    const result = run({ rules: [rule], touched: ['/proj/src/a.ts'] })
    expect(result.attached.size).toBe(0)
    expect(result.diagnostics).toEqual([])
  })
})

describe('attachedRules - self-check budget', () => {
  it('warns and skips a rule whose matchers exceed the self-check budget', () => {
    const rule = mkRule({ path: '/proj/slow.md', type: 'requested', patterns: ['src/**/*.ts'] })
    // selfCheck() reads the clock twice: once before its probe loop and once
    // after. A clock that jumps past the 200 ms budget makes the "slowness"
    // branch fire deterministically, on any machine, without a slow pattern.
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValueOnce(0).mockReturnValueOnce(10_000)
      const result = run({ rules: [rule], touched: ['/proj/src/app.ts'] })
      expect(result.attached.size).toBe(0)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]?.code).toBe('attach.slow')
      expect(result.diagnostics[0]?.path).toBe('/proj/slow.md')
    } finally {
      now.mockRestore()
    }
  })

  it('attaches normally when the clock stays inside the budget', () => {
    const rule = mkRule({ path: '/proj/fast.md', type: 'requested', patterns: ['src/**/*.ts'] })
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValueOnce(0).mockReturnValueOnce(1)
      expect(run({ rules: [rule], touched: ['/proj/src/app.ts'] }).attached.size).toBe(1)
    } finally {
      now.mockRestore()
    }
  })
})
