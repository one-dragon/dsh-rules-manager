import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SOURCES, scanAll } from '../src/scan.ts'
import type { RuleFamily } from '../src/types.ts'

const NL = String.fromCharCode(10)
/** A `---`-fenced rule file, built without escape sequences in this source. */
const fenced = (...rows: string[]): string => ['---', ...rows, '---', 'BODY', ''].join(NL)

/**
 * The sources added after the original four conventions, with the facts each
 * one was verified against. Keeping the expectations in one table means a
 * source cannot silently lose its label, rank, or filter while the scanning
 * tests below still pass.
 */
interface ExpectedSource {
  readonly key: string
  readonly label: string
  readonly rank: number
  /** Project-relative directory; undefined when the tier is not declared. */
  readonly projectDir?: string
  readonly extensions: readonly string[]
  /** Documented user-level directory; undefined when upstream names none. */
  readonly userPath?: string
  /** Every extra user-level directory beyond `userPath`. */
  readonly userPaths?: readonly string[]
  /** Every extra project-relative directory beyond `projectDir`. */
  readonly projectDirs?: readonly string[]
  /** User-level single files, with any environment-resolved path evaluated. */
  readonly userFiles?: readonly string[]
  /** Project-relative single files. */
  readonly projectFiles?: readonly string[]
  readonly suffixes?: readonly string[]
  readonly requiresTrigger?: boolean
  /** What a file that declares nothing at all means for this convention. */
  readonly emptyRuleType?: string
  /** The user tier's own answer, when the convention gives a different one. */
  readonly userRuleType?: string
}

/**
 * A declared path, evaluated when it defers to the environment.
 *
 * The source table stores a function where the root comes from a variable
 * (COPILOT_HOME), so an expectation written as a literal has to go through the
 * same evaluation before it can be compared.
 */
function resolvedPath(
  entry: string | ((env: NodeJS.ProcessEnv) => string) | undefined,
  env: NodeJS.ProcessEnv = {},
): string | undefined {
  return entry === undefined ? undefined : typeof entry === 'function' ? entry(env) : entry
}

const EXPECTED: readonly ExpectedSource[] = [
  {
    key: 'trae', label: 'Trae', rank: 500, projectDir: '.trae/rules',
    extensions: ['.md'], userPath: join(homedir(), '.trae', 'user_rules'),
    emptyRuleType: 'always',
  },
  {
    key: 'qoder', label: 'Qoder', rank: 510, projectDir: '.qoder/rules', extensions: ['.md'],
    // "User-Level | ~/.qoder/rules/**/*.md" on the CLI page, which the IDE page
    // does not print; the CN build documents its own path.
    userPath: join(homedir(), '.qoder', 'rules'),
    // "When no loading-related frontmatter is configured, rules are always
    // active by default; trigger takes precedence over alwaysApply".
    emptyRuleType: 'always',
  },
  {
    key: 'cline', label: 'Cline', rank: 520, projectDir: '.clinerules',
    extensions: ['.md'], userPath: join(homedir(), '.cline', 'rules'),
    // "Cline also searches ~/.cline/rules and ~/Cline/Rules for global rules"
    // and "Workspace rules go in .clinerules/ or .cline/rules/": two
    // directories per tier, so both are declared.
    userPaths: [join(homedir(), 'Cline', 'Rules')],
    projectDirs: ['.cline/rules'],
    // "Rules without frontmatter are always active."
    emptyRuleType: 'always',
  },
  {
    key: 'roo', label: 'Roo Code', rank: 530, projectDir: '.roo/rules',
    extensions: ['.md', '.txt'], userPath: join(homedir(), '.roo', 'rules'),
    // "Fallback Method: Single File (.roorules)".
    projectFiles: ['.roorules'],
    emptyRuleType: 'always',
  },
  {
    key: 'devin', label: 'Devin / Windsurf', rank: 540, projectDir: '.devin/rules',
    extensions: ['.md'], userPath: join(homedir(), '.devin', 'rules'),
    // ".devin/global_rules.md is a single always-on file. Place the same files
    // in your home directory (~/.devin/rules/*.md, ~/.devin/global_rules.md)".
    userFiles: [join(homedir(), '.devin', 'global_rules.md')],
    projectFiles: ['.devin/global_rules.md'],
    // The always-on file is the documented shape; a directory entry that
    // declares nothing is read the same way (MEDIUM upstream).
    emptyRuleType: 'always',
  },
  {
    key: 'windsurf', label: 'Windsurf (legacy)', rank: 550, projectDir: '.windsurf/rules',
    extensions: ['.md'],
    // "The legacy .windsurf/rules/*.md, .windsurf/global_rules.md, and
    // .windsurfrules files are imported by default", plus the user-level
    // always-on single file documented on the localized official page
    // (https://docs.windsurf.com/zh/windsurf/cascade/memories).
    userFiles: [join(homedir(), '.codeium', 'windsurf', 'memories', 'global_rules.md')],
    projectFiles: ['.windsurf/global_rules.md', '.windsurfrules'],
    emptyRuleType: 'always',
  },
  {
    key: 'copilot', label: 'GitHub Copilot', rank: 560, projectDir: '.github/instructions',
    extensions: ['.md'], suffixes: ['.instructions.md'],
    // Copilot CLI: "$HOME/.copilot/instructions/**/*.instructions.md" plus the
    // single "$HOME/.copilot/copilot-instructions.md", both relocatable with
    // COPILOT_HOME; the repository adds ".github/copilot-instructions.md".
    userPath: join(homedir(), '.copilot', 'instructions'),
    userFiles: [join(homedir(), '.copilot', 'copilot-instructions.md')],
    projectFiles: ['.github/copilot-instructions.md'],
    // `applyTo` is what scopes an instruction file; one without it is inert.
    emptyRuleType: 'manual',
  },
  {
    key: 'junie', label: 'Junie (JetBrains)', rank: 570, projectDir: '.junie/rules',
    // "the .junie/guidelines.md file or .junie/guidelines/ folder - legacy
    // (still supported)": a second project directory beside .junie/rules.
    projectDirs: ['.junie/guidelines'],
    extensions: ['.md'], emptyRuleType: 'always',
  },
  {
    key: 'amazonq', label: 'Amazon Q', rank: 580, projectDir: '.amazonq/rules',
    extensions: ['.md'], emptyRuleType: 'always',
  },
  {
    key: 'tabnine', label: 'Tabnine', rank: 590, projectDir: '.tabnine/guidelines',
    extensions: ['.md'], emptyRuleType: 'always',
  },
  {
    key: 'continue', label: 'Continue', rank: 600, projectDir: '.continue/rules', extensions: ['.md'],
    // `alwaysApply` undefined and no globs means the rule is included.
    emptyRuleType: 'always',
  },
  // Two entries share a directory with an earlier one and declare only the tier
  // that is theirs alone: .trae/rules and .qoder/rules are single directories,
  // so a second key pointing at them would report the same files twice.
  {
    key: 'trae-cn', label: 'Trae CN', rank: 610,
    extensions: ['.md'], userPath: join(homedir(), '.trae-cn', 'user_rules'),
    emptyRuleType: 'always',
  },
  {
    key: 'qoder-cn', label: 'Qoder CN', rank: 620,
    extensions: ['.md'], userPath: join(homedir(), '.qoder-cn', 'rules'),
    emptyRuleType: 'always',
  },
  {
    key: 'lingma', label: 'Lingma', rank: 630, projectDir: '.lingma/rules',
    extensions: ['.md'], emptyRuleType: 'always',
  },
  {
    key: 'aiassistant', label: 'JetBrains AI Assistant', rank: 640, projectDir: '.aiassistant/rules',
    extensions: ['.md'], emptyRuleType: 'always',
  },
  {
    key: 'antigravity', label: 'Antigravity', rank: 650,
    extensions: ['.md'], userPath: join(homedir(), '.gemini', 'config', 'rules'),
    requiresTrigger: true,
    // "Modular global rules (YAML frontmatter required)": a file without one is
    // not a rule of this convention.
    emptyRuleType: 'none',
  },
  {
    key: 'augment', label: 'Augment Code', rank: 670, projectDir: '.augment/rules',
    extensions: ['.md', '.mdc'], userPath: join(homedir(), '.augment', 'rules'),
    // "User rules in ~/.augment/rules/ are always treated as always_apply and do
    // not support other frontmatter types", so an undeclared file is always-on.
    userFiles: [join(homedir(), '.augment', 'user-guidelines.md')],
    projectFiles: ['.augment-guidelines'],
    emptyRuleType: 'always',
    // "User rules in ~/.augment/rules/ are always treated as always_apply and do
    // not support other frontmatter types", against workspace rules that
    // "support all three types (Always, Manual, Auto)".
    userRuleType: 'always',
  },
  {
    key: 'kiro', label: 'Kiro', rank: 660, projectDir: '.kiro/steering',
    extensions: ['.md'], userPath: join(homedir(), '.kiro', 'steering'),
    // Steering files with no frontmatter are always included, and the page
    // documents no required field, so the directory is read whole.
    emptyRuleType: 'always',
  },
]

/**
 * The official page each entry was verified against.
 *
 * The table is deliberately explicit rather than derived from \`docs\`, so a
 * link cannot be quietly swapped to another product: the host has to match the
 * key it is filed under.
 */
const DOC_HOSTS: Readonly<Record<string, string>> = {
  codebuddy: 'codebuddy.ai', cursor: 'cursor.com', claude: 'docs.claude.com',
  agents: 'antigravity.google', trae: 'docs.trae.ai', qoder: 'docs.qoder.com',
  cline: 'docs.cline.bot', roo: 'docs.roocode.com', devin: 'docs.devin.ai',
  windsurf: 'docs.devin.ai', copilot: 'docs.github.com', junie: 'junie.jetbrains.com',
  amazonq: 'docs.aws.amazon.com', tabnine: 'docs.tabnine.com', continue: 'docs.continue.dev',
  'trae-cn': 'docs.trae.com.cn', 'qoder-cn': 'docs.qoder.cn',
  lingma: 'help.aliyun.com', aiassistant: 'jetbrains.com', antigravity: 'antigravity.google',
  kiro: 'kiro.dev', augment: 'docs.augmentcode.com',
}

/**
 * Every name in the `RuleFamily` union, spelled out.
 *
 * Typing the object as a full `Record` makes `tsc --noEmit` fail if a family
 * is dropped from the union; the test below checks the other direction at run
 * time, that every source key has a family.
 */
const FAMILY_NAMES: Readonly<Record<RuleFamily, true>> = {
  codebuddy: true, 'codebuddy-intranet': true, cursor: true, claude: true, agents: true,
  trae: true, qoder: true, cline: true, roo: true, devin: true, windsurf: true,
  copilot: true, junie: true, amazonq: true, tabnine: true, continue: true,
  'trae-cn': true, 'qoder-cn': true, lingma: true, aiassistant: true, antigravity: true, kiro: true,
  augment: true,
}

describe('source table', () => {
  it('lists four original sources plus eighteen additions', () => {
    expect(SOURCES).toHaveLength(22)
  })

  it('documents every entry with the official page it was verified against', () => {
    for (const source of SOURCES) {
      expect(source.docs, source.key).toMatch(/^https:\/\//)
      expect(source.docs, source.key).not.toMatch(/\s/)
      const host = DOC_HOSTS[source.key]
      expect(host, 'a host expectation for ' + source.key).toBeDefined()
      expect(source.docs, source.key).toContain(host ?? '\u0000')
    }
    expect(Object.keys(DOC_HOSTS).sort()).toEqual(SOURCES.map((s) => s.key).sort())
  })

  it('gives every source a unique key and label', () => {
    const keys = SOURCES.map((s) => s.key)
    const labels = SOURCES.map((s) => s.label)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('orders the table by strictly increasing rank', () => {
    for (let i = 1; i < SOURCES.length; i++) {
      expect(SOURCES[i - 1]!.rank).toBeLessThan(SOURCES[i]!.rank)
    }
  })

  it('declares a family for every source key', () => {
    const known = new Set(Object.keys(FAMILY_NAMES))
    for (const source of SOURCES) expect(known.has(source.key)).toBe(true)
  })
})

describe('added sources', () => {
  it.each(EXPECTED)('declares $key as $label', (expected) => {
    const source = SOURCES.find((s) => s.key === expected.key)
    expect(source).toBeDefined()
    expect(source?.label).toBe(expected.label)
    expect(source?.rank).toBe(expected.rank)
    expect(source?.projectDir).toBe(expected.projectDir)
    expect(source?.extensions).toEqual(expected.extensions)
    expect(source?.suffixes).toEqual(expected.suffixes)
    expect(source?.mutable).toBe(false)
    expect(source?.flat).toBeUndefined()
    expect(source?.requiresTrigger).toBe(expected.requiresTrigger)
    expect(source?.emptyRuleType).toBe(expected.emptyRuleType)
    expect(source?.userRuleType).toBe(expected.userRuleType)
    expect(source?.userPaths).toEqual(expected.userPaths)
    expect(source?.projectDirs).toEqual(expected.projectDirs)
    expect(source?.projectFiles).toEqual(expected.projectFiles)
    // An undeclared list and an empty one mean the same thing here; the table
    // writes the absent case for readability.
    const files = (source?.userFiles ?? []).map((entry) => resolvedPath(entry))
    expect(files.length === 0 ? undefined : files).toEqual(expected.userFiles)
  })

  it.each(EXPECTED)('declares the documented user tier of $key', (expected) => {
    const source = SOURCES.find((s) => s.key === expected.key)
    // Undefined means upstream documents no user-level directory, so no path
    // is guessed here.
    expect(resolvedPath(source?.userPath)).toBe(expected.userPath)
  })

  it('puts every added source after the original four', () => {
    expect(SOURCES.filter((s) => s.rank < 500).map((s) => s.key))
      .toEqual(['codebuddy', 'cursor', 'claude', 'agents'])
    expect(SOURCES.filter((s) => s.rank >= 500)).toHaveLength(EXPECTED.length)
    // The six newest conventions sort after every earlier addition, so the
    // established catalog order never shifts under an existing user.
    expect(SOURCES.filter((s) => s.rank > 600).map((s) => s.key))
      .toEqual(['trae-cn', 'qoder-cn', 'lingma', 'aiassistant', 'antigravity', 'kiro', 'augment'])
  })
})

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dshrm-sources-'))
  await mkdir(join(root, '.git'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Rules discovered inside one project-relative directory of this fixture. */
async function rulesUnder(dir: string) {
  const result = await scanAll(root)
  return result.rules.filter((r) => r.path.startsWith(join(root, dir)))
}

describe('scanning an added source', () => {
  it('reads a Trae rule from .trae/rules', async () => {
    await mkdir(join(root, '.trae', 'rules'), { recursive: true })
    await writeFile(join(root, '.trae', 'rules', 'trae.md'),
      fenced('description: trae conventions'), 'utf8')

    const found = await rulesUnder('.trae')
    expect(found).toHaveLength(1)
    expect(found[0]?.sourceKey).toBe('trae')
    expect(found[0]?.scope).toBe('project')
    expect(found[0]?.family).toBe('trae')
    expect(found[0]?.type).toBe('requested')
  })

  it('reads a Qoder rule from .qoder/rules', async () => {
    await mkdir(join(root, '.qoder', 'rules'), { recursive: true })
    await writeFile(join(root, '.qoder', 'rules', 'qoder.md'),
      fenced('description: qoder conventions'), 'utf8')

    const found = await rulesUnder('.qoder')
    expect(found).toHaveLength(1)
    expect(found[0]?.sourceKey).toBe('qoder')
    expect(found[0]?.family).toBe('qoder')
    expect(found[0]?.scope).toBe('project')
  })

  it('filters Copilot instructions by suffix, not by extension alone', async () => {
    await mkdir(join(root, '.github', 'instructions'), { recursive: true })
    await writeFile(join(root, '.github', 'instructions', 'a.instructions.md'),
      fenced('description: repository instructions'), 'utf8')
    await writeFile(join(root, '.github', 'instructions', 'b.md'),
      fenced('description: plain note'), 'utf8')
    await writeFile(join(root, '.github', 'instructions', 'c.instructions.txt'),
      fenced('description: wrong extension'), 'utf8')

    const found = await rulesUnder('.github')
    expect(found.map((r) => r.name)).toEqual(['a.instructions'])
    expect(found[0]?.sourceKey).toBe('copilot')
    expect(found[0]?.family).toBe('copilot')
  })

  it('reads .txt rules for Roo Code and ignores other extensions', async () => {
    await mkdir(join(root, '.roo', 'rules'), { recursive: true })
    await writeFile(join(root, '.roo', 'rules', 'roo.txt'),
      fenced('description: roo plain text'), 'utf8')
    await writeFile(join(root, '.roo', 'rules', 'roo.json'), '{}', 'utf8')

    const found = await rulesUnder('.roo')
    expect(found.map((r) => r.name)).toEqual(['roo'])
    expect(found[0]?.sourceKey).toBe('roo')
    expect(found[0]?.family).toBe('roo')
  })

  it('derives a state for plain-markdown conventions with no frontmatter', async () => {
    // Roo Code, Junie, Amazon Q and Tabnine document no frontmatter vocabulary:
    // every file in the directory applies to every request. Before the source
    // table carried emptyRuleType, each of these files was rejected by the
    // classify gate and the source scanned a directory to find nothing.
    await mkdir(join(root, '.roo', 'rules'), { recursive: true })
    await writeFile(join(root, '.roo', 'rules', 'roo.md'), 'plain roo guidance' + NL, 'utf8')
    await mkdir(join(root, '.junie', 'rules'), { recursive: true })
    await writeFile(join(root, '.junie', 'rules', 'junie.md'), 'plain junie guidance' + NL, 'utf8')
    await mkdir(join(root, '.tabnine', 'guidelines'), { recursive: true })
    await writeFile(join(root, '.tabnine', 'guidelines', 'tabnine.md'), 'plain tabnine guidance' + NL, 'utf8')

    const result = await scanAll(root)
    const plain = result.rules.filter((r) => r.path.startsWith(root))
    expect(plain.map((r) => r.sourceKey).sort()).toEqual(['junie', 'roo', 'tabnine'])
    for (const rule of plain) {
      expect(rule.type).toBe('always')
      expect(rule.description).toBe('')
      expect(rule.diagnostics).toEqual([])
      expect(rule.family).toBe(rule.sourceKey)
    }
    expect(result.diagnostics.filter((d) => d.code === 'classify.skipped')).toEqual([])
  })

  it('still drops a file that declares nothing where the convention needs a field', async () => {
    // The leniency is per source, not global: Cursor's own page says a file
    // without frontmatter is ignored by the rules system, so a bare `.mdc` in
    // its directory keeps the old behaviour and is reported as a skip.
    await mkdir(join(root, '.cursor', 'rules'), { recursive: true })
    await writeFile(join(root, '.cursor', 'rules', 'note.mdc'), 'just a note' + NL, 'utf8')

    const result = await scanAll(root)
    expect(result.rules.some((r) => r.path.endsWith('note.mdc'))).toBe(false)
    // The reason is the point of the row: "skipped" alone never said whether the
    // file had no rule fields or was a strict source missing its trigger.
    const details = result.diagnostics.filter((d) => d.code === 'classify.skipped').map((d) => d.detail)
    expect(details).toHaveLength(1)
    expect(details[0]).toContain('没有可识别的规则字段')
    expect(details[0]).toContain('note.mdc')
  })

  it('answers the empty-file question for every convention', () => {
    // The answer is per source: an empty file is always-on where the convention
    // documents no vocabulary or says a file with no frontmatter is active,
    // inert for Copilot's instruction file, and not a rule at all where
    // upstream requires a declared field (Cursor's .mdc plus the two strict
    // directories). Leaving it undefined is the failure this guards: the
    // classify gate would silently drop every plain file in that source.
    for (const source of SOURCES) expect(source.emptyRuleType, source.key).toBeDefined()
    expect(SOURCES.filter((s) => s.emptyRuleType === 'none').map((s) => s.key))
      .toEqual(['cursor', 'agents', 'antigravity'])
    expect(SOURCES.filter((s) => s.emptyRuleType === 'manual').map((s) => s.key)).toEqual(['copilot'])
    expect(SOURCES.filter((s) => s.emptyRuleType === 'always')).toHaveLength(18)
  })

  it('reads both directories Cline documents for one project tier', async () => {
    // ".clinerules/ or .cline/rules/ at your project root ... Cline processes
    // rule files inside either directory, combining them into a unified set."
    await mkdir(join(root, '.clinerules'), { recursive: true })
    await writeFile(join(root, '.clinerules', 'legacy.md'),
      fenced('description: legacy layout'), 'utf8')
    await mkdir(join(root, '.cline', 'rules'), { recursive: true })
    await writeFile(join(root, '.cline', 'rules', 'current.md'),
      fenced('description: current layout'), 'utf8')

    const result = await scanAll(root)
    const mine = result.rules.filter((r) => r.sourceKey === 'cline')
    expect(mine.map((r) => r.name).sort()).toEqual(['current', 'legacy'])
    // Both are one convention, so both roots carry the same key and the panel's
    // one switch covers them; they differ only by path.
    const roots = result.roots.filter((r) => r.source.key === 'cline')
    expect(roots.map((r) => r.path).sort()).toEqual([
      join(root, '.cline', 'rules'),
      join(root, '.clinerules'),
    ])
    expect(roots.every((r) => r.kind === 'directory')).toBe(true)
  })

  it('reads a declared single file as its own root', async () => {
    // Roo Code's fallback is a file, not a directory: "If .roo/rules/ doesn't
    // exist or is empty, Roo Code looks for a single .roorules file in the
    // workspace root." A directory walker can never see it.
    await writeFile(join(root, '.roorules'), 'plain roo fallback' + NL, 'utf8')

    const result = await scanAll(root)
    const found = result.rules.filter((r) => r.sourceKey === 'roo')
    expect(found).toHaveLength(1)
    expect(found[0]?.path).toBe(join(root, '.roorules'))
    // Roo documents no frontmatter vocabulary, so the file applies to every
    // request without declaring anything.
    expect(found[0]?.type).toBe('always')
    expect(result.truncated).toBe(false)
  })

  it('reads the repository Copilot file that the suffix filter would drop', async () => {
    // ".github/copilot-instructions.md" does not end in ".instructions.md", so
    // the directory's suffix filter would skip it; the declared file root is
    // what makes it readable.
    await mkdir(join(root, '.github'), { recursive: true })
    // Plain markdown, as the file is documented: a repository instruction file
    // carries no frontmatter, so the classify gate must not reject it.
    await writeFile(join(root, '.github', 'copilot-instructions.md'),
      'Repository wide guidance.' + NL, 'utf8')

    const result = await scanAll(root)
    const found = result.rules.filter((r) => r.sourceKey === 'copilot')
    expect(found.map((r) => r.path)).toEqual([join(root, '.github', 'copilot-instructions.md')])
    expect(found[0]?.scope).toBe('project')
    expect(found[0]?.type).toBe('always')
    expect(result.diagnostics.filter((d) => d.code === 'classify.skipped')).toEqual([])
  })

  it('reads the single always-on rule file Devin documents', async () => {
    await mkdir(join(root, '.devin', 'rules'), { recursive: true })
    await writeFile(join(root, '.devin', 'rules', 'scoped.md'),
      fenced('description: scoped guidance'), 'utf8')
    // "a single always-on file", written without frontmatter.
    await writeFile(join(root, '.devin', 'global_rules.md'),
      'Always on guidance.' + NL, 'utf8')

    const result = await scanAll(root)
    const found = result.rules.filter((r) => r.sourceKey === 'devin')
    expect(found.map((r) => r.name).sort()).toEqual(['global_rules', 'scoped'])
    expect(result.roots.filter((r) => r.source.key === 'devin').map((r) => r.kind).sort())
      .toEqual(['directory', 'file'])
    // The always-on file has no frontmatter to derive a state from.
    expect(found.find((r) => r.name === 'global_rules')?.type).toBe('always')
  })

  it('reads a Kiro steering file, frontmatter or not', async () => {
    // "Workspace steering files reside in your project root folder under
    // .kiro/steering/". A steering file with no frontmatter is always included
    // ("AGENTS.md files do not support inclusion modes and are always included"),
    // so the directory is read whole.
    await mkdir(join(root, '.kiro', 'steering'), { recursive: true })
    await writeFile(join(root, '.kiro', 'steering', 'product.md'),
      '# Product\n\nAlways be concise.\n', 'utf8')
    await writeFile(join(root, '.kiro', 'steering', 'api.md'),
      fenced('inclusion: manual', 'description: api conventions'), 'utf8')

    const result = await scanAll(root)
    const found = result.rules.filter((r) => r.sourceKey === 'kiro')
    expect(found.map((r) => r.name).sort()).toEqual(['api', 'product'])
    expect(found.find((r) => r.name === 'product')?.type).toBe('always')
    // "inclusion: manual" is the third state, spelled in Kiro's own field.
    expect(found.find((r) => r.name === 'api')?.type).toBe('manual')
    expect(result.roots.find((r) => r.source.key === 'kiro')?.path).toBe(join(root, '.kiro', 'steering'))
  })

  it('reads Augment rules from the directory and from its single-file alias', async () => {
    // ".augment/rules" holds .md and .mdc alike, and the repository-level alias
    // ".augment-guidelines" is one file.
    await mkdir(join(root, '.augment', 'rules'), { recursive: true })
    await writeFile(join(root, '.augment', 'rules', 'a.mdc'),
      fenced('type: agent_requested', 'description: mdc rule'), 'utf8')
    await writeFile(join(root, '.augment', 'rules', 'b.md'), 'plain augment guidance' + NL, 'utf8')
    await writeFile(join(root, '.augment-guidelines'), 'repository guidelines' + NL, 'utf8')

    const result = await scanAll(root)
    const found = result.rules.filter((r) => r.sourceKey === 'augment')
    expect(found.map((r) => r.name).sort()).toEqual(['a', 'b', '.augment-guidelines'].sort())
    // "User rules ... are always treated as always_apply": an undeclared file
    // is always-on, and agent_requested is the requested state.
    expect(found.find((r) => r.name === 'b')?.type).toBe('always')
    expect(found.find((r) => r.name === 'a')?.type).toBe('requested')
  })

  it('reads the Windsurf legacy single files beside the directory', async () => {
    // ".windsurf/global_rules.md and .windsurfrules files are imported by
    // default" — files, so no directory listing can find them.
    await mkdir(join(root, '.windsurf', 'rules'), { recursive: true })
    // The directory's files do declare frontmatter; it is the two single files
    // that are always-on and carry none.
    await writeFile(join(root, '.windsurf', 'rules', 'scoped.md'),
      fenced('trigger: always_on', 'description: scoped rule'), 'utf8')
    await writeFile(join(root, '.windsurf', 'global_rules.md'), 'global' + NL, 'utf8')
    await writeFile(join(root, '.windsurfrules'), 'legacy root file' + NL, 'utf8')

    const result = await scanAll(root)
    const found = result.rules.filter((r) => r.sourceKey === 'windsurf')
    expect(found.map((r) => r.name).sort()).toEqual(['global_rules', 'scoped', '.windsurfrules'].sort())
    expect(found.every((r) => r.family === 'windsurf')).toBe(true)
    // "global_rules.md ... Always enabled" with no frontmatter.
    expect(found.find((r) => r.name === 'global_rules')?.type).toBe('always')
    expect(result.diagnostics.filter((d) => d.code === 'classify.skipped')).toEqual([])
  })

  it('reads both Junie directories, including the legacy guidelines folder', async () => {
    await mkdir(join(root, '.junie', 'rules'), { recursive: true })
    await writeFile(join(root, '.junie', 'rules', 'current.md'), 'current' + NL, 'utf8')
    await mkdir(join(root, '.junie', 'guidelines'), { recursive: true })
    await writeFile(join(root, '.junie', 'guidelines', 'legacy.md'), 'legacy' + NL, 'utf8')

    const result = await scanAll(root)
    const found = result.rules.filter((r) => r.sourceKey === 'junie')
    expect(found.map((r) => r.name).sort()).toEqual(['current', 'legacy'])
    expect(result.roots.filter((r) => r.source.key === 'junie').map((r) => r.path).sort())
      .toEqual([join(root, '.junie', 'guidelines'), join(root, '.junie', 'rules')])
  })

  it('declares no directory at all when every tier of a source is a file', async () => {
    // Copilot declares a directory for the project tier, so the guard is that a
    // file root never invents a directory: with nothing on disk the source
    // contributes no root at all.
    const result = await scanAll(root)
    expect(result.roots.some((r) => r.source.key === 'copilot')).toBe(false)
  })

  it('does not read a source whose project directory is missing', async () => {
    const result = await scanAll(root)
    expect(result.roots.some((r) => r.source.key === 'tabnine')).toBe(false)
    expect(result.rules.some((r) => r.sourceKey === 'tabnine')).toBe(false)
  })
})
