import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentsHome, scanAll, SOURCES } from '../src/scan.ts'
import { parseRule, splitFrontmatter } from '../src/parse.ts'

/**
 * The `.agents` source (Antigravity / `agent-rules-spec`).
 *
 * Its user tier comes from the environment, so every case drives an explicit
 * env object and an explicit fixture home. Nothing here reads or writes the
 * developer's real `~/.agents`, and nothing depends on it existing.
 */

/** An env that points the shared agents root at a fixture directory. */
const envAt = (home: string): NodeJS.ProcessEnv => ({ DSH_AGENTS_HOME: home })

/** An env with no override, so the documented `~/.agents` fallback applies. */
const ENV_FALLBACK: NodeJS.ProcessEnv = {}

const AGENTS = SOURCES.find((source) => source.key === 'agents')

let root: string
const temps: string[] = []

async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

/** A project root carrying a `.git` marker and the given relative files. */
async function project(files: Record<string, string>): Promise<string> {
  const dir = await makeDir('dshrm-agents-')
  await mkdir(join(dir, '.git'), { recursive: true })
  for (const [rel, body] of Object.entries(files)) {
    const target = join(dir, rel)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, body, 'utf8')
  }
  return dir
}

/** A fixture agents home holding the given files at its top level (`rules/`). */
async function home(files: Record<string, string>): Promise<string> {
  const dir = await makeDir('dshrm-agents-home-')
  const rules = join(dir, 'rules')
  await mkdir(rules, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(rules, name), body, 'utf8')
  }
  return dir
}

/** Frontmatter plus body, spelled out so a fixture reads like a real file. */
const ruleFile = (frontmatter: string, body = 'BODY'): string =>
  '---\n' + frontmatter + '\n---\n' + body + '\n'

/** Scan, keeping only `.agents` rules so a machine-local user tier cannot leak in. */
async function scanAgents(projectRoot: string | null, env: NodeJS.ProcessEnv) {
  const { rules, diagnostics, truncated } = await scanAll(projectRoot, {}, env)
  return {
    rules: rules.filter((rule) => rule.sourceKey === 'agents'),
    diagnostics,
    truncated,
  }
}

beforeEach(() => {
  root = ''
})

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

describe('.agents source table entry', () => {
  it('declares both tiers, markdown only, read-only, rank 400, strict', () => {
    expect(AGENTS).toBeDefined()
    expect(AGENTS?.projectDir).toBe('.agents/rules')
    expect(AGENTS?.extensions).toEqual(['.md'])
    expect(AGENTS?.mutable).toBe(false)
    expect(AGENTS?.rank).toBe(400)
    expect(AGENTS?.requiresTrigger).toBe(true)
    expect(AGENTS?.label).toContain('.agents')
  })

  it('defers its user tier, so the override is read at scan time', () => {
    // A string frozen at import would not react to DSH_AGENTS_HOME, which is
    // what the override test below depends on.
    expect(typeof AGENTS?.userPath).toBe('function')
  })

  it('keeps every source read-only', () => {
    for (const source of SOURCES) expect(source.mutable).toBe(false)
  })
})

describe('agentsHome', () => {
  it('prefers DSH_AGENTS_HOME when it is set and non-empty', () => {
    expect(agentsHome({ DSH_AGENTS_HOME: '/custom/agents' })).toBe('/custom/agents')
  })

  it('falls back to ~/.agents when the variable is missing or empty', () => {
    const fallback = join(homedir(), '.agents')
    expect(agentsHome({})).toBe(fallback)
    expect(agentsHome({ DSH_AGENTS_HOME: '' })).toBe(fallback)
  })
})

describe('scanning both .agents tiers', () => {
  it('finds a project rule at <project>/.agents/rules', async () => {
    root = await project({
      '.agents/rules/project-rule.md': ruleFile('trigger: always_on\ndescription: project tier'),
    })
    const { rules, truncated } = await scanAgents(root, ENV_FALLBACK)
    const found = rules.find((rule) => rule.name === 'project-rule')
    expect(found).toBeDefined()
    expect(found?.sourceKey).toBe('agents')
    expect(found?.family).toBe('agents')
    expect(found?.type).toBe('always')
    expect(found?.path).toBe(join(root, '.agents', 'rules', 'project-rule.md'))
    expect(truncated).toBe(false)
  })

  it('finds a user rule at <agentsHome>/rules', async () => {
    const fixtureHome = await home({ 'global-rule.md': ruleFile('trigger: manual') })
    root = await project({})
    const { rules } = await scanAgents(root, envAt(fixtureHome))
    const found = rules.find((rule) => rule.name === 'global-rule')
    expect(found).toBeDefined()
    expect(found?.type).toBe('manual')
    expect(found?.path).toBe(join(fixtureHome, 'rules', 'global-rule.md'))
  })

  it('reports both tiers from one scan', async () => {
    const fixtureHome = await home({ 'from-home.md': ruleFile('trigger: manual') })
    root = await project({ '.agents/rules/from-project.md': ruleFile('trigger: manual') })
    const { rules } = await scanAgents(root, envAt(fixtureHome))
    expect(rules.map((rule) => rule.name).sort()).toEqual(['from-home', 'from-project'])
  })

  it('only reaches the fixture home through the override', async () => {
    // Without DSH_AGENTS_HOME the fallback ~/.agents applies, which holds no
    // fixture rule: that is what proves the override is what made it visible.
    const fixtureHome = await home({ 'global-rule.md': ruleFile('trigger: manual') })
    root = await project({})
    const withOverride = await scanAgents(root, envAt(fixtureHome))
    const withoutOverride = await scanAgents(root, ENV_FALLBACK)
    expect(withOverride.rules.some((rule) => rule.name === 'global-rule')).toBe(true)
    expect(withoutOverride.rules.some((rule) => rule.name === 'global-rule')).toBe(false)
  })

  it('skips the project tier when there is no project root', async () => {
    const fixtureHome = await home({ 'from-home.md': ruleFile('trigger: manual') })
    const { rules } = await scanAgents(null, envAt(fixtureHome))
    expect(rules.map((rule) => rule.name)).toEqual(['from-home'])
  })
})

describe('trigger mapping', () => {
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ['always_on', 'always'],
    ['always', 'always'],
    ['model_decision', 'requested'],
    ['auto', 'requested'],
    ['glob', 'requested'],
    ['manual', 'manual'],
  ]

  it('maps every documented value onto the three internal states', async () => {
    const files: Record<string, string> = {}
    for (const [trigger] of CASES) {
      files['.agents/rules/' + trigger + '.md'] = ruleFile('trigger: ' + trigger + '\ndescription: d-' + trigger)
    }
    root = await project(files)
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    for (const [trigger, expected] of CASES) {
      const found = rules.find((rule) => rule.name === trigger)
      expect(found, trigger).toBeDefined()
      expect(found?.type, trigger).toBe(expected)
    }
  })

  it('matches the value case-insensitively', async () => {
    root = await project({
      '.agents/rules/mixed.md': ruleFile('trigger: Always_On'),
      '.agents/rules/upper.md': ruleFile('trigger: MODEL_DECISION\ndescription: d'),
    })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.find((rule) => rule.name === 'mixed')?.type).toBe('always')
    expect(rules.find((rule) => rule.name === 'upper')?.type).toBe('requested')
  })

  it('drops a file whose trigger is unrecognized', async () => {
    root = await project({ '.agents/rules/bogus.md': ruleFile('trigger: whenever') })
    const { rules, diagnostics } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.some((rule) => rule.name === 'bogus')).toBe(false)
    // scanAll records the skip itself; the classifier's own wording is checked
    // directly in classify.spec.ts, because scanAll does not surface `reason`.
    expect(diagnostics.some((d) => d.code === 'classify.skipped' && d.detail.includes('bogus.md'))).toBe(true)
  })
})

describe('strict mode: a missing trigger drops the file', () => {
  it('drops a .agents file that would otherwise look like a rule', async () => {
    root = await project({
      '.agents/rules/no-trigger.md': ruleFile('description: looks like a rule\nalwaysApply: true'),
    })
    const { rules, diagnostics } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.some((rule) => rule.name === 'no-trigger')).toBe(false)
    expect(diagnostics.some((d) => d.code === 'classify.skipped')).toBe(true)
  })

  it('discards the file silently: no rule, and no throw', async () => {
    root = await project({ '.agents/rules/plain.md': ruleFile('description: plain') })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules).toEqual([])
  })

  it('keeps the same bytes under .codebuddy, where derivation still applies', async () => {
    // Strictness belongs to the source, not to the frontmatter: the very same
    // fields must survive in a convention that derives a state.
    root = await project({
      '.codebuddy/rules/no-trigger.mdc': ruleFile('description: looks like a rule\nalwaysApply: true'),
    })
    const { rules } = await scanAll(root, {}, ENV_FALLBACK)
    const found = rules.find((rule) => rule.name === 'no-trigger')
    expect(found?.sourceKey).toBe('codebuddy')
    expect(found?.type).toBe('always')
  })

  it('does not admit a bare enabled: true, unlike the deriving sources', async () => {
    root = await project({ '.agents/rules/enabled-only.md': ruleFile('enabled: true') })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules).toEqual([])
  })

  it('keeps a rule that pairs a trigger with enabled: false', async () => {
    root = await project({ '.agents/rules/off.md': ruleFile('trigger: manual\nenabled: false') })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    const found = rules.find((rule) => rule.name === 'off')
    expect(found).toBeDefined()
    expect(found?.enabled).toBe(false)
  })

  it('still drops a disabled file that has no trigger', async () => {
    root = await project({ '.agents/rules/off-plain.md': ruleFile('enabled: false') })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules).toEqual([])
  })
})

describe('globs in a .agents rule', () => {
  it('reads a comma-separated list into patterns', async () => {
    root = await project({
      '.agents/rules/comma.md': ruleFile('trigger: glob\ndescription: ts files\nglobs: "*.ts, *.tsx"'),
    })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    const found = rules.find((rule) => rule.name === 'comma')
    expect(found?.type).toBe('requested')
    expect(found?.patterns).toEqual(['*.ts', '*.tsx'])
  })

  it('reads a block list the same way', async () => {
    root = await project({
      '.agents/rules/block.md': ruleFile('trigger: glob\ndescription: ts files\nglobs:\n  - "*.ts"\n  - "*.tsx"'),
    })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.find((rule) => rule.name === 'block')?.patterns).toEqual(['*.ts', '*.tsx'])
  })

  it('reads a flow list the same way', async () => {
    root = await project({
      '.agents/rules/flow.md': ruleFile('trigger: glob\ndescription: ts files\nglobs: ["*.ts", "*.tsx"]'),
    })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.find((rule) => rule.name === 'flow')?.patterns).toEqual(['*.ts', '*.tsx'])
  })
})

describe('.agents extensions', () => {
  it('accepts .md and ignores .mdc', async () => {
    root = await project({
      '.agents/rules/kept.md': ruleFile('trigger: manual'),
      '.agents/rules/skipped.mdc': ruleFile('trigger: manual'),
    })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.map((rule) => rule.name)).toEqual(['kept'])
  })

  it('accepts an uppercase .MD', async () => {
    root = await project({ '.agents/rules/UPPER.MD': ruleFile('trigger: manual') })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.map((rule) => rule.name)).toEqual(['UPPER'])
  })
})

describe('.agents is flat, unlike every other source', () => {
  it('ignores a nested .agents rule', async () => {
    root = await project({
      '.agents/rules/top.md': ruleFile('trigger: manual'),
      '.agents/rules/sub/nested.md': ruleFile('trigger: manual'),
      '.agents/rules/sub/deeper/x.md': ruleFile('trigger: manual'),
    })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    // Antigravity scans only the immediate .md children and ignores nested
    // files unless they are registered in .agents/rules.json.
    expect(rules.map((rule) => rule.name)).toEqual(['top'])
  })

  it('still finds a nested rule under .codebuddy, which stays recursive', async () => {
    root = await project({
      '.codebuddy/rules/top.mdc': ruleFile('description: top'),
      '.codebuddy/rules/sub/x.mdc': ruleFile('description: x'),
      '.codebuddy/rules/sub/deeper/y.mdc': ruleFile('description: y'),
    })
    const { rules } = await scanAll(root, {}, ENV_FALLBACK)
    const names = rules.filter((rule) => rule.path.startsWith(root)).map((rule) => rule.name).sort()
    // The control for the case above: flatness must not have leaked into the
    // shared walker.
    expect(names).toEqual(['top', 'x', 'y'])
  })

  it('keeps the flat source flat while a recursive one is scanned in the same pass', async () => {
    root = await project({
      '.agents/rules/a.md': ruleFile('trigger: manual'),
      '.agents/rules/sub/a-nested.md': ruleFile('trigger: manual'),
      '.cursor/rules/c.mdc': ruleFile('description: c'),
      '.cursor/rules/sub/c-nested.mdc': ruleFile('description: c-nested'),
    })
    const { rules } = await scanAll(root, {}, ENV_FALLBACK)
    const mine = rules.filter((rule) => rule.path.startsWith(root))
    expect(mine.filter((rule) => rule.sourceKey === 'agents').map((rule) => rule.name)).toEqual(['a'])
    expect(mine.filter((rule) => rule.sourceKey === 'cursor').map((rule) => rule.name).sort()).toEqual(['c', 'c-nested'])
  })

  it('declares the flat flag only on the .agents source', () => {
    const flat = SOURCES.filter((source) => source.flat === true).map((source) => source.key)
    expect(flat).toEqual(['agents'])
  })
})

describe('inline comments on closed-vocabulary fields', () => {
  const derive = (text: string) =>
    parseRule(text, { path: '/p/x.mdc', family: 'codebuddy', sourceKey: 'codebuddy', scope: 'project' }).rule

  it('strips a trailing comment from trigger', async () => {
    root = await project({
      '.agents/rules/c1.md': ruleFile('trigger: always_on  # 保持常驻\ndescription: d'),
    })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.find((rule) => rule.name === 'c1')?.type).toBe('always')
  })

  it('strips a trailing comment from type, alwaysApply and enabled', () => {
    expect(derive('---\ntype: manual # note\n---\nb\n').type).toBe('manual')
    expect(derive('---\nalwaysApply: true # note\n---\nb\n').type).toBe('always')
    expect(derive('---\ndescription: d\nenabled: false # off\n---\nb\n').enabled).toBe(false)
  })

  it('never cuts a description that contains a hash', () => {
    // The reason comments are stripped only from closed-vocabulary fields:
    // a description may legitimately contain one.
    expect(derive('---\ndescription: 处理 #1 问题\nalwaysApply: false\n---\nb\n').description).toBe('处理 #1 问题')
    expect(derive('---\ndescription: fix #42 now\nalwaysApply: true\n---\nb\n').description).toBe('fix #42 now')
  })

  it('keeps a hash with no preceding whitespace, and one inside quotes', () => {
    // YAML needs whitespace before the marker; both forms therefore stay whole
    // and are reported as unknown rather than silently truncated.
    expect(derive('---\ndescription: d\ntype: always#note\n---\nb\n').diagnostics.some((d) => d.code === 'type.unknown')).toBe(true)
    expect(derive('---\ndescription: d\ntype: "always # note"\n---\nb\n').diagnostics.some((d) => d.code === 'type.unknown')).toBe(true)
  })
})

describe('list splitting is brace- and quote-aware', () => {
  const patternsOf = (body: string) => splitFrontmatter(body).values['globs']

  it('keeps a brace expansion together', () => {
    // picomatch expands {a,b}, so a blind comma split would break a working
    // pattern into two halves that match nothing.
    expect(patternsOf('---\nglobs: "**/*.{js,ts}"\n---\nb\n')).toEqual(['**/*.{js,ts}'])
    expect(patternsOf('---\nglobs: {a,b}/**\n---\nb\n')).toEqual(['{a,b}/**'])
  })

  it('keeps braces together inside a flow list and strips the inner quotes', () => {
    expect(patternsOf('---\nglobs: ["**/*.{js,ts}"]\n---\nb\n')).toEqual(['**/*.{js,ts}'])
  })

  it('still splits a plain comma string', () => {
    expect(patternsOf('---\nglobs: "*.ts, *.tsx"\n---\nb\n')).toEqual(['*.ts', '*.tsx'])
    expect(patternsOf('---\nglobs: *.ts, *.tsx\n---\nb\n')).toEqual(['*.ts', '*.tsx'])
  })

  it('splits around a brace group but not inside it', () => {
    expect(patternsOf('---\nglobs: "src/*.{ts,tsx}, lib/*.js"\n---\nb\n'))
      .toEqual(['src/*.{ts,tsx}', 'lib/*.js'])
  })

  it('does not split on a comma inside a character class', () => {
    expect(patternsOf('---\nglobs: "[a,b]/**"\n---\nb\n')).toEqual(['[a,b]/**'])
  })

  it('reaches a .agents rule through the same path', async () => {
    root = await project({
      '.agents/rules/braces.md': ruleFile('trigger: glob\ndescription: d\nglobs: "**/*.{js,ts}"'),
    })
    const { rules } = await scanAgents(root, ENV_FALLBACK)
    expect(rules.find((rule) => rule.name === 'braces')?.patterns).toEqual(['**/*.{js,ts}'])
  })
})

describe('.agents alongside the other sources', () => {
  it('scans all four and orders by rank, .agents last', async () => {
    root = await project({
      '.codebuddy/rules/cb.mdc': ruleFile('description: cb\nalwaysApply: true'),
      '.cursor/rules/cur.mdc': ruleFile('description: cur\nglobs: "**/*.ts"'),
      '.claude/rules/cla.md': ruleFile('description: cla\npaths: "src/**"'),
      '.agents/rules/ag.md': ruleFile('trigger: always_on\ndescription: ag'),
    })
    const { rules } = await scanAll(root, {}, ENV_FALLBACK)
    // Only the fixture's own rules: a machine-local user tier must not decide
    // the outcome of this test.
    const mine = rules.filter((rule) => rule.path.startsWith(root))
    expect(mine.map((rule) => rule.name)).toEqual(['cb', 'cur', 'cla', 'ag'])

    const rank = (key: string) => SOURCES.find((source) => source.key === key)?.rank ?? 999
    for (let i = 1; i < mine.length; i++) {
      const prev = mine[i - 1]
      const cur = mine[i]
      expect(prev).toBeDefined()
      expect(cur).toBeDefined()
      if (prev !== undefined && cur !== undefined) {
        expect(rank(prev.sourceKey)).toBeLessThanOrEqual(rank(cur.sourceKey))
      }
    }
  })

  it('keeps a name shared with another source, because identity is the path', async () => {
    root = await project({
      '.codebuddy/rules/shared.mdc': ruleFile('description: from codebuddy\nalwaysApply: false'),
      '.agents/rules/shared.md': ruleFile('trigger: model_decision\ndescription: from agents'),
    })
    const { rules } = await scanAll(root, {}, ENV_FALLBACK)
    const mine = rules.filter((rule) => rule.path.startsWith(root))
    expect(mine.length).toBe(2)
    expect(mine.map((rule) => rule.sourceKey).sort()).toEqual(['agents', 'codebuddy'])
    expect(new Set(mine.map((rule) => rule.path)).size).toBe(2)
  })

  it('does not let a project .agents tier shadow the user tier', async () => {
    const fixtureHome = await home({ 'shared.md': ruleFile('trigger: manual') })
    root = await project({ '.agents/rules/shared.md': ruleFile('trigger: manual') })
    const { rules } = await scanAgents(root, envAt(fixtureHome))
    expect(rules.length).toBe(2)
    expect(new Set(rules.map((rule) => rule.path)).size).toBe(2)
  })
})
