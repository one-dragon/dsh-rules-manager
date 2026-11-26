import { promises as fsPromises } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  displayPath, findProjectRoot, scanAll, SOURCES, MAX_SCAN_DEPTH, MAX_SCAN_DIRECTORIES, MAX_SCAN_ENTRIES,
  agentsHome, clineHome, copilotHome, kiroHome,
} from '../src/scan.ts'
import { toPanelDiagnostics } from '../src/panel.ts'
import type { Rule } from '../src/types.ts'

/**
 * A real fixture tree: a project with a `.git` marker, rules under two
 * conventions, one disabled rule, one manual rule, and two files that must be
 * rejected (a Codex command list and a plain markdown note).
 */
async function buildFixture(root: string): Promise<void> {
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, '.codebuddy', 'rules'), { recursive: true })
  await mkdir(join(root, '.cursor', 'rules'), { recursive: true })

  // Always-on project rule.
  await writeFile(join(root, '.codebuddy', 'rules', 'discipline.mdc'),
    '---\ndescription: keep diffs small\nalwaysApply: true\nenabled: true\n---\nDISCIPLINE BODY\n', 'utf8')
  // On-demand rule.
  await writeFile(join(root, '.codebuddy', 'rules', 'ts-standard.mdc'),
    '---\ndescription: when editing TypeScript\nalwaysApply: false\nenabled: true\n---\nTS BODY\n', 'utf8')
  // Disabled rule: kept in the list so a panel can re-enable it.
  await writeFile(join(root, '.codebuddy', 'rules', 'css-standard.mdc'),
    '---\ndescription: when editing CSS\nalwaysApply: false\nenabled: false\n---\nCSS BODY\n', 'utf8')
  // Manual rule: no description.
  await writeFile(join(root, '.codebuddy', 'rules', 'rare.mdc'),
    '---\nalwaysApply: false\n---\nRARE BODY\n', 'utf8')
  // Intranet-style rule.
  await writeFile(join(root, '.codebuddy', 'rules', 'intranet.mdc'),
    '---\ntype: always\n---\nINTRANET BODY\n', 'utf8')
  // Must be rejected: Codex command permissions, named with an accepted
  // extension so the classifier — not the extension filter — is what rejects it.
  await writeFile(join(root, '.codebuddy', 'rules', 'permissions.mdc'),
    'prefix_rule(pattern=["ls"], decision="allow")\n', 'utf8')
  // Rejected earlier than the classifier: wrong extension, never even read.
  await writeFile(join(root, '.codebuddy', 'rules', 'permissions.txt'),
    'prefix_rule(pattern=["ls"], decision="allow")\n', 'utf8')
  // Cursor rule with globs and alwaysApply together (must still be cursor).
  await writeFile(join(root, '.cursor', 'rules', 'api.mdc'),
    '---\ndescription: API conventions\nglobs: "src/api/**/*.ts"\nalwaysApply: false\n---\nAPI BODY\n', 'utf8')
  // Ignored extension.
  await writeFile(join(root, '.codebuddy', 'rules', 'notes.txt'), 'not a rule\n', 'utf8')
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dshrm-scan-'))
  await buildFixture(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('findProjectRoot', () => {
  it('finds the nearest ancestor containing .git', async () => {
    expect(await findProjectRoot(join(root, '.codebuddy', 'rules'))).toBe(root)
  })

  it('returns null when no ancestor has .git', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'dshrm-plain-'))
    try {
      expect(await findProjectRoot(plain)).toBe(null)
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })
})

describe('scanAll', () => {
  it('discovers rules from every configured convention', async () => {
    const result = await scanAll(root)
    const names = result.rules.map((r) => r.name).sort()
    expect(names).toContain('discipline')
    expect(names).toContain('ts-standard')
    expect(names).toContain('api')
  })

  it('derives the three states correctly', async () => {
    const result = await scanAll(root)
    const byName = new Map(result.rules.map((r) => [r.name, r]))
    expect(byName.get('discipline')?.type).toBe('always')
    expect(byName.get('ts-standard')?.type).toBe('requested')
    expect(byName.get('rare')?.type).toBe('manual')
    expect(byName.get('intranet')?.type).toBe('always')
  })

  it('keeps a disabled rule in the list but marks it disabled', async () => {
    const result = await scanAll(root)
    const css = result.rules.find((r) => r.name === 'css-standard')
    expect(css).toBeDefined()
    expect(css?.enabled).toBe(false)
  })

  it('rejects a command-permission file by content, and says why', async () => {
    const result = await scanAll(root)
    expect(result.rules.some((r) => r.name === 'permissions')).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'classify.skipped')).toBe(true)
  })

  it('never even reads a file whose extension is not accepted', async () => {
    const result = await scanAll(root)
    // permissions.txt was filtered by extension, so no classifier ran on it.
    // Assert the tree only ever yielded accepted extensions.
    for (const rule of result.rules) {
      expect(/\.(mdc|md)$/i.test(rule.path)).toBe(true)
    }
  })

  it('classifies a Cursor rule as cursor', async () => {
    const result = await scanAll(root)
    expect(result.rules.find((r) => r.name === 'api')?.family).toBe('cursor')
  })

  it('classifies an intranet rule as codebuddy-intranet', async () => {
    const result = await scanAll(root)
    expect(result.rules.find((r) => r.name === 'intranet')?.family).toBe('codebuddy-intranet')
  })

  it('ignores non-rule extensions', async () => {
    const result = await scanAll(root)
    expect(result.rules.some((r) => r.name === 'notes')).toBe(false)
  })

  it('returns nothing when there is no project root', async () => {
    const result = await scanAll(null)
    // Only user-level roots would apply, and the fixture has none.
    expect(result.rules.every((r) => !r.path.startsWith(root))).toBe(true)
  })

  it('orders rules by source rank, then name', async () => {
    const result = await scanAll(root)
    const rank = (key: string) => SOURCES.find((s) => s.key === key)?.rank ?? 999
    for (let i = 1; i < result.rules.length; i++) {
      const prev = result.rules[i - 1]!
      const cur = result.rules[i]!
      const prevRank = rank(prev.sourceKey)
      const curRank = rank(cur.sourceKey)
      if (prevRank === curRank) expect(prev.name.localeCompare(cur.name)).toBeLessThanOrEqual(0)
      else expect(prevRank).toBeLessThanOrEqual(curRank)
    }
  })

  it('deduplicates by absolute path', async () => {
    const result = await scanAll(root)
    const paths = result.rules.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('does not truncate a small tree', async () => {
    const result = await scanAll(root)
    expect(result.truncated).toBe(false)
  })

  it('never writes to the scanned tree', async () => {
    // Sources are declared read-only; assert the flag so a future edit cannot
    // silently make them writable.
    for (const source of SOURCES) expect(source.mutable).toBe(false)
  })
})

describe('displayPath', () => {
  it('returns a project-relative posix path', () => {
    expect(displayPath(join(root, '.codebuddy', 'rules', 'a.mdc'), root)).toBe('.codebuddy/rules/a.mdc')
  })

  it('returns the absolute path outside the project, in posix form', () => {
    // `relative` yields a `..` path, so displayPath keeps the absolute path;
    // on Windows that is already resolved to a drive-qualified path.
    const out = displayPath('/elsewhere/a.mdc', root)
    expect(out.endsWith('elsewhere/a.mdc')).toBe(true)
    expect(out.includes('\\')).toBe(false)
  })

  it('returns the absolute path when there is no project root', () => {
    expect(displayPath('/p/a.mdc', null)).toBe('/p/a.mdc')
  })
})

describe('scan limits', () => {
  it('exposes a bounded depth', () => {
    expect(MAX_SCAN_DEPTH).toBe(6)
  })

  it('stops descending past the depth cap', async () => {
    // Build a chain deeper than the cap under the codebuddy rules directory.
    let dir = join(root, '.codebuddy', 'rules')
    const parts: string[] = []
    for (let i = 0; i < MAX_SCAN_DEPTH + 3; i++) parts.push(`d${i}`)
    for (const part of parts) {
      dir = join(dir, part)
      await mkdir(dir, { recursive: true })
    }
    await writeFile(join(dir, 'deep.mdc'), '---\ndescription: too deep\n---\nDEEP\n', 'utf8')

    const result = await scanAll(root)
    // The file sits beyond the depth cap, so it must not be discovered.
    expect(result.rules.some((r) => r.name === 'deep')).toBe(false)
  })
})
/**
 * Sources added after the original four conventions.
 *
 * Each test builds its own project tree and filters the result down to files
 * under that tree: `scanAll` also resolves the real user tier from the host's
 * home directory, which is not what these assertions are about.
 */
const NL = String.fromCharCode(10)
/** A `---`-fenced rule file, built without escape sequences in this source. */
const fenced = (...rows: string[]): string => ['---', ...rows, '---', 'BODY', ''].join(NL)

describe('scan caps', () => {
  it('exposes the directory and entry budgets', () => {
    expect(MAX_SCAN_DIRECTORIES).toBe(2000)
    expect(MAX_SCAN_ENTRIES).toBe(20000)
  })

  /** A project whose rule files all sit directly in the source directory. */
  async function flatProject(count: number): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dshrm-cap-'))
    await mkdir(join(dir, '.git'), { recursive: true })
    const rules = join(dir, '.codebuddy', 'rules')
    await mkdir(rules, { recursive: true })
    for (let i = 0; i < count; i++) {
      const name = 'r' + String(i).padStart(2, '0')
      await writeFile(join(rules, name + '.mdc'), fenced('description: ' + name), 'utf8')
    }
    return dir
  }

  it('stops at the entry cap when every file sits in one directory', async () => {
    // The flat shape is the one that reaches this cap first. The walk used to
    // test the count only between directories, so this whole listing was read
    // while the scan still reported itself complete.
    const dir = await flatProject(12)
    try {
      const result = await scanAll(dir, { maxEntries: 5 })
      const mine = result.rules.filter((r) => r.path.startsWith(dir))
      expect(mine).toHaveLength(5)
      // Attribute the truncation to this root: the user tier resolves as well,
      // and it must not be what makes this assertion pass.
      const rulesRoot = join(dir, '.codebuddy', 'rules')
      expect(result.diagnostics.some((d) => d.code === 'scan.truncated' && d.detail.includes(rulesRoot))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports no truncation for a flat directory inside its budget', async () => {
    const dir = await flatProject(3)
    try {
      const result = await scanAll(dir, { maxEntries: 5 })
      expect(result.rules.filter((r) => r.path.startsWith(dir))).toHaveLength(3)
      expect(result.diagnostics.some((d) => d.detail.includes(join(dir, '.codebuddy', 'rules')))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('stops at the directory cap before descending further', async () => {
    const dir = await flatProject(1)
    try {
      const rulesRoot = join(dir, '.codebuddy', 'rules')
      await mkdir(join(rulesRoot, 'nested'), { recursive: true })
      await writeFile(join(rulesRoot, 'nested', 'deep.mdc'), fenced('description: nested cap check'), 'utf8')
      const result = await scanAll(dir, { maxDirectories: 1 })
      expect(result.rules.some((r) => r.path.includes('nested'))).toBe(false)
      expect(result.diagnostics.some((d) => d.detail.includes(rulesRoot))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('extended sources', () => {
  const under = (rules: readonly Rule[], dir: string) =>
    rules.filter((r) => r.path.startsWith(join(root, dir)))

  it('discovers a Trae project rule under .trae/rules', async () => {
    await mkdir(join(root, '.trae', 'rules'), { recursive: true })
    await writeFile(join(root, '.trae', 'rules', 'style.md'),
      fenced('description: trae style', 'alwaysApply: true'), 'utf8')

    const result = await scanAll(root)
    const trae = under(result.rules, '.trae')
    expect(trae).toHaveLength(1)
    expect(trae[0]?.sourceKey).toBe('trae')
    expect(trae[0]?.family).toBe('trae')
    expect(trae[0]?.scope).toBe('project')
  })

  it('discovers a Qoder project rule under .qoder/rules', async () => {
    await mkdir(join(root, '.qoder', 'rules'), { recursive: true })
    await writeFile(join(root, '.qoder', 'rules', 'query.md'),
      fenced('description: qoder conventions'), 'utf8')

    const result = await scanAll(root)
    const qoder = under(result.rules, '.qoder')
    expect(qoder.map((r) => r.sourceKey)).toEqual(['qoder'])
    expect(qoder[0]?.family).toBe('qoder')
  })

  it('accepts the documented .txt extension for Roo Code', async () => {
    await mkdir(join(root, '.roo', 'rules'), { recursive: true })
    await writeFile(join(root, '.roo', 'rules', 'plain.txt'),
      fenced('description: roo plain text rules'), 'utf8')
    await writeFile(join(root, '.roo', 'rules', 'ignored.json'), '{}', 'utf8')

    const result = await scanAll(root)
    const roo = under(result.rules, '.roo')
    expect(roo.map((r) => r.name)).toEqual(['plain'])
    expect(roo[0]?.sourceKey).toBe('roo')
    // .json is outside the table's extensions, so it never reaches the parser.
    expect(result.rules.some((r) => r.path.endsWith('ignored.json'))).toBe(false)
  })

  it('applies the Copilot filename suffix on top of the extension filter', async () => {
    await mkdir(join(root, '.github', 'instructions'), { recursive: true })
    // Both files would classify as rules; only the suffixed one is read.
    await writeFile(join(root, '.github', 'instructions', 'a.instructions.md'),
      fenced('description: repository instructions'), 'utf8')
    await writeFile(join(root, '.github', 'instructions', 'b.md'),
      fenced('description: not a copilot instruction'), 'utf8')

    const result = await scanAll(root)
    const copilot = under(result.rules, '.github')
    expect(copilot.map((r) => r.name)).toEqual(['a.instructions'])
    expect(copilot[0]?.sourceKey).toBe('copilot')
    expect(copilot[0]?.family).toBe('copilot')
    expect(result.rules.some((r) => r.path.endsWith('b.md'))).toBe(false)
  })

  it('skips a new source whose project directory is absent', async () => {
    const result = await scanAll(root)
    // No .continue directory exists in the fixture, so nothing is attributed
    // to that key and no root is reported for it.
    expect(result.rules.some((r) => r.sourceKey === 'continue')).toBe(false)
    expect(result.roots.some((r) => r.source.key === 'continue')).toBe(false)
  })

  it('keeps the new sources ordered after the original four', async () => {
    await mkdir(join(root, '.trae', 'rules'), { recursive: true })
    await mkdir(join(root, '.continue', 'rules'), { recursive: true })
    await writeFile(join(root, '.trae', 'rules', 'early.md'),
      fenced('description: early'), 'utf8')
    await writeFile(join(root, '.continue', 'rules', 'late.md'),
      fenced('description: late'), 'utf8')

    const result = await scanAll(root)
    const rank = (key: string) => SOURCES.find((s) => s.key === key)?.rank ?? 999
    const early = result.rules.findIndex((r) => r.name === 'early')
    const late = result.rules.findIndex((r) => r.name === 'late')
    const discipline = result.rules.findIndex((r) => r.name === 'discipline')
    expect(discipline).toBeGreaterThanOrEqual(0)
    expect(discipline).toBeLessThan(early)
    expect(early).toBeLessThan(late)
    expect(rank('trae')).toBeLessThan(rank('continue'))
  })

  it('declares no new source as flat or trigger-strict', () => {
    // Ranks 500-600: the eleven additions that stay recursive and non-strict.
    // Antigravity (650) is trigger-strict and the .agents entry (400) is flat.
    const added = SOURCES.filter((s) => s.rank >= 500 && s.rank <= 600)
    expect(added).toHaveLength(11)
    for (const source of added) {
      expect(source.flat).toBeUndefined()
      expect(source.requiresTrigger).toBeUndefined()
      expect(source.mutable).toBe(false)
    }
  })
})

describe('the findings the host projects for the panel', () => {
  it('carries the file and the line a finding came from', () => {
    // A rule-level code arrives twice: on its rule row, and again in the
    // walk-level list, where the file it belongs to is not otherwise knowable.
    const rows = toPanelDiagnostics(
      [{ code: 'fm.emptyList', detail: '列表字段为空：globs', line: 4, path: '/repo/a.md' }],
      'project:claude',
      'scan',
    )
    expect(rows).toEqual([{
      code: 'fm.emptyList',
      detail: '列表字段为空：globs',
      kind: 'scan',
      line: 4,
      path: '/repo/a.md',
      key: 'project:claude',
    }])
  })

  it('omits the fields a finding does not have', () => {
    // A cap that was reached has no line and no file of its own, and the panel
    // must not be handed undefined stand-ins it would have to filter.
    const rows = toPanelDiagnostics(
      [{ code: 'scan.truncated', detail: '目录或条目数超过上限，已停止扫描：/repo/.cline/rules' }],
      undefined,
      'scan',
    )
    expect(rows).toEqual([{
      code: 'scan.truncated',
      detail: '目录或条目数超过上限，已停止扫描：/repo/.cline/rules',
      kind: 'scan',
    }])
    expect('line' in (rows[0] ?? {})).toBe(false)
    expect('path' in (rows[0] ?? {})).toBe(false)
    expect('key' in (rows[0] ?? {})).toBe(false)
  })
})

describe('the directory each source reads from the environment', () => {
  it('prefers the variable the vendor documents', () => {
    const env = {
      COPILOT_HOME: 'X:/copilot',
      KIRO_HOME: 'X:/kiro',
      CLINE_DIR: 'X:/cline',
      DSH_AGENTS_HOME: 'X:/agents',
    }
    expect(copilotHome(env)).toBe('X:/copilot')
    expect(kiroHome(env)).toBe('X:/kiro')
    expect(clineHome(env)).toBe('X:/cline')
    expect(agentsHome(env)).toBe('X:/agents')
  })

  it('falls back to the home directory, and treats an empty value as unset', () => {
    expect(copilotHome({})).toBe(join(homedir(), '.copilot'))
    expect(kiroHome({})).toBe(join(homedir(), '.kiro'))
    expect(clineHome({})).toBe(join(homedir(), '.cline'))
    expect(agentsHome({})).toBe(join(homedir(), '.agents'))
    // An empty string is what an unset-but-declared variable looks like, and
    // resolving it would put the scan at the drive root.
    expect(copilotHome({ COPILOT_HOME: '' })).toBe(join(homedir(), '.copilot'))
    expect(kiroHome({ KIRO_HOME: '' })).toBe(join(homedir(), '.kiro'))
    expect(clineHome({ CLINE_DIR: '' })).toBe(join(homedir(), '.cline'))
  })
})

/**
 * The two ways a scan reports a file it could not read.
 *
 * Neither is reachable from a fixture alone: on this platform a directory that
 * merely lacks a permission bit still reads, and the roots themselves are
 * pre-checked with `stat` before the walk (a declared root that is not a
 * directory never becomes a root at all). So each case below replaces one
 * function on the very object the scan module reads — `node:fs`'s own
 * `promises` — and refuses exactly one path for the duration of one scan.
 * That this works was measured, not assumed: `scan.ts` imports
 * `{ promises as fs } from 'node:fs'`, which resolves to the same object as
 * `node:fs/promises`, so a property replaced here is the one it calls.
 *
 * The last case is the control: the same fixture, with nothing replaced, has
 * to yield the rule whose absence the failing cases assert. Without it an
 * empty fixture would pass those assertions for the wrong reason.
 */
describe('the failures the walk reports', () => {
  /**
   * One project with a rule behind each path a case may refuse: a rule file in
   * the codebuddy directory, a nested rule under it, and a healthy Cursor rule
   * that must survive whatever happens next door.
   */
  async function project(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dshrm-fail-'))
    await mkdir(join(dir, '.git'), { recursive: true })
    await mkdir(join(dir, '.codebuddy', 'rules', 'nested'), { recursive: true })
    await mkdir(join(dir, '.cursor', 'rules'), { recursive: true })
    await writeFile(join(dir, '.codebuddy', 'rules', 'blocked.mdc'),
      fenced('description: beside the failing directory'), 'utf8')
    await writeFile(join(dir, '.codebuddy', 'rules', 'nested', 'deep.mdc'),
      fenced('description: under the failing directory'), 'utf8')
    await writeFile(join(dir, '.cursor', 'rules', 'survivor.mdc'),
      fenced('description: healthy source'), 'utf8')
    return dir
  }

  afterEach(() => {
    // Each case installs a replacement; leaving one behind would leak into
    // every later spec in this file.
    vi.restoreAllMocks()
  })

  it('reports scan.unreadable when readdir refuses a directory, and keeps walking', async () => {
    const dir = await project()
    const blocked = join(dir, '.codebuddy', 'rules')
    const realReaddir = fsPromises.readdir
    const readdir = vi.spyOn(fsPromises, 'readdir')
    readdir.mockImplementation((async (path: string, options?: unknown) => {
      if (String(path) === blocked) throw new Error('EACCES: permission denied')
      return realReaddir(path, options as never)
    }) as unknown as typeof fsPromises.readdir)

    try {
      const result = await scanAll(dir)
      const unreadable = result.diagnostics.filter((d) => d.code === 'scan.unreadable')
      expect(unreadable.some((d) => d.detail.includes(blocked))).toBe(true)
      // Nothing under the refused directory was yielded — not even the nested
      // rule that a queue-based walk might have picked up before the failure.
      const mine = result.rules.filter((r) => r.path.startsWith(dir))
      expect(mine.some((r) => r.name === 'blocked')).toBe(false)
      expect(mine.some((r) => r.name === 'deep')).toBe(false)
      // The sibling source under the same project root still produced its rule,
      // and the refusal is not a cap: the scan did not declare itself truncated.
      expect(mine.map((r) => r.name)).toEqual(['survivor'])
      expect(result.truncated).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports read.failed for one file and drops only that file', async () => {
    const dir = await project()
    const locked = join(dir, '.codebuddy', 'rules', 'blocked.mdc')
    const realReadFile = fsPromises.readFile
    const readFile = vi.spyOn(fsPromises, 'readFile')
    readFile.mockImplementation((async (path: string, options?: unknown) => {
      if (String(path) === locked) throw new Error('EACCES: permission denied')
      return realReadFile(path, options as never)
    }) as unknown as typeof fsPromises.readFile)

    try {
      const result = await scanAll(dir)
      const failed = result.diagnostics.filter((d) => d.code === 'read.failed' && d.path === locked)
      expect(failed).toHaveLength(1)
      expect(failed[0]?.detail).toContain(locked)
      // The refused file is named by the diagnostic and appears in no rule row;
      // its sibling in the same directory was read and parsed as usual.
      const mine = result.rules.filter((r) => r.path.startsWith(dir))
      expect(mine.some((r) => r.name === 'blocked')).toBe(false)
      expect(mine.map((r) => r.name).sort()).toEqual(['deep', 'survivor'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps a directory that fails while its own parent still reads', async () => {
    // The walk continues per directory, not per root: refusing a nested
    // directory must not cost the parent directory its own rules.
    const dir = await project()
    const blocked = join(dir, '.codebuddy', 'rules', 'nested')
    const realReaddir = fsPromises.readdir
    const readdir = vi.spyOn(fsPromises, 'readdir')
    readdir.mockImplementation((async (path: string, options?: unknown) => {
      if (String(path) === blocked) throw new Error('EACCES: permission denied')
      return realReaddir(path, options as never)
    }) as unknown as typeof fsPromises.readdir)

    try {
      const result = await scanAll(dir)
      expect(result.diagnostics.some((d) => d.code === 'scan.unreadable' && d.detail.includes(blocked))).toBe(true)
      const mine = result.rules.filter((r) => r.path.startsWith(dir))
      expect(mine.map((r) => r.name).sort()).toEqual(['blocked', 'survivor'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('finds every rule in the same fixture when nothing is refused', async () => {
    const dir = await project()
    try {
      const result = await scanAll(dir)
      const mine = result.rules.filter((r) => r.path.startsWith(dir))
      expect(mine.map((r) => r.name).sort()).toEqual(['blocked', 'deep', 'survivor'])
      // The fixture on its own produces no unreadable or failed-read finding,
      // so those codes in the cases above are caused by the replacement.
      const refused = result.diagnostics.filter((d) =>
        (d.code === 'scan.unreadable' || d.code === 'read.failed') && d.detail.includes(dir))
      expect(refused).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
