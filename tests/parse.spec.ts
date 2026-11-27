import { describe, expect, it } from 'vitest'
import { deriveRule, parseRule, splitFrontmatter } from '../src/parse.ts'
import type { Diagnostic } from '../src/types.ts'

const CTX = { path: '/p/.codebuddy/rules/x.mdc', family: 'codebuddy' as const, scope: 'project' as const, sourceKey: 'codebuddy' }

describe('splitFrontmatter', () => {
  it('splits a fenced block from the body', () => {
    const fm = splitFrontmatter('---\ndescription: hi\n---\nbody text\n')
    expect(fm.values['description']).toBe('hi')
    expect(fm.body).toBe('body text\n')
  })

  it('accepts a fence with nothing between the markers', () => {
    // A rule file may declare an empty frontmatter (CodeBuddy documents that
    // shape); two markers with no inner line are still a fence, not prose that
    // happens to start with dashes.
    const fm = splitFrontmatter('---\n---\nb\n')
    expect(fm.fenced).toBe(true)
    expect(fm.values).toEqual({})
    expect(fm.body).toBe('b\n')
  })

  it('returns empty values when there is no fence', () => {
    const fm = splitFrontmatter('# Just a heading\n')
    expect(fm.values).toEqual({})
    expect(fm.body).toBe('# Just a heading\n')
  })

  it('tolerates a UTF-8 BOM', () => {
    const fm = splitFrontmatter('\uFEFF---\ndescription: hi\n---\nbody\n')
    expect(fm.values['description']).toBe('hi')
  })

  it('tolerates CRLF line endings', () => {
    const fm = splitFrontmatter('---\r\ndescription: hi\r\n---\r\nbody\r\n')
    expect(fm.values['description']).toBe('hi')
    expect(fm.body).toBe('body\r\n')
  })

  it('ignores unknown keys without failing', () => {
    const fm = splitFrontmatter('---\ndescription: hi\nwhatever: 1\n---\nb\n')
    expect(fm.values['description']).toBe('hi')
    expect(fm.values['whatever']).toBeUndefined()
  })

  it('strips surrounding quotes from a scalar', () => {
    const fm = splitFrontmatter('---\ndescription: "quoted"\n---\nb\n')
    expect(fm.values['description']).toBe('quoted')
  })

  it('reads a flow list', () => {
    const fm = splitFrontmatter('---\nglobs: ["a/**", "b/*.ts"]\n---\nb\n')
    expect(fm.values['globs']).toEqual(['a/**', 'b/*.ts'])
  })

  it('reads a comma-separated list', () => {
    const fm = splitFrontmatter('---\npaths: src/**, lib/*.ts\n---\nb\n')
    expect(fm.values['paths']).toEqual(['src/**', 'lib/*.ts'])
  })

  it('reads a block list', () => {
    const fm = splitFrontmatter('---\npaths:\n  - src/**\n  - lib/*.ts\n---\nb\n')
    expect(fm.values['paths']).toEqual(['src/**', 'lib/*.ts'])
  })

  it('reports a malformed line as a diagnostic', () => {
    const fm = splitFrontmatter('---\nthis line has no colon\n---\nb\n')
    expect(fm.diagnostics.some((d) => d.code === 'fm.malformed')).toBe(true)
  })

  it('names the empty list field and its line', () => {
    // "the list field is empty" is not actionable: a file may declare two of
    // them, and the line was measured all along but never named.
    const fm = splitFrontmatter('---\ndescription: d\nglobs:\n---\nb\n')
    const empty = fm.diagnostics.find((d) => d.code === 'fm.emptyList')
    // The file's own line numbers, so the number can be opened directly: the
    // opening fence is line 1, `description` line 2, `globs` line 3.
    expect(empty?.detail).toContain('globs')
    expect(empty?.line).toBe(3)
  })
})

describe('deriveRule — the three-state formula', () => {
  const derive = (text: string) => parseRule(text, CTX).rule

  it('alwaysApply=true wins over everything', () => {
    const rule = derive('---\ndescription: x\nalwaysApply: true\n---\nbody\n')
    expect(rule.type).toBe('always')
  })

  it('a non-empty description yields requested when alwaysApply is false', () => {
    const rule = derive('---\ndescription: when editing TS\nalwaysApply: false\n---\nbody\n')
    expect(rule.type).toBe('requested')
  })

  it('neither field yields manual', () => {
    const rule = derive('---\nalwaysApply: false\n---\nbody\n')
    expect(rule.type).toBe('manual')
  })

  it('an empty description yields manual, not requested', () => {
    const rule = derive('---\ndescription:\nalwaysApply: false\n---\nbody\n')
    expect(rule.type).toBe('manual')
  })

  it('declared type wins over the derived state (intranet form)', () => {
    // No alwaysApply, but type says always.
    const rule = derive('---\ntype: always\n---\nbody\n')
    expect(rule.type).toBe('always')
  })

  it('accepts type: requested and type: manual', () => {
    expect(derive('---\ntype: requested\ndescription: d\n---\nb\n').type).toBe('requested')
    expect(derive('---\ntype: manual\n---\nb\n').type).toBe('manual')
  })

  it('maps Augment Code type values onto the shared states', () => {
    // Augment spells the always-on and model-selected states differently; both
    // are accepted so an .augment rule classifies instead of being dropped.
    expect(derive('---\ntype: always_apply\ndescription: d\n---\nb\n').type).toBe('always')
    expect(derive('---\ntype: agent_requested\ndescription: d\n---\nb\n').type).toBe('requested')
    // The third value is spelled the same way by both vocabularies.
    expect(derive('---\ntype: manual\n---\nb\n').type).toBe('manual')
  })

  it('reads Kiro inclusion as the trigger of the same three states', () => {
    expect(derive('---\ninclusion: always\ndescription: d\n---\nb\n').type).toBe('always')
    expect(derive('---\ninclusion: manual\n---\nb\n').type).toBe('manual')
    // "fileMatch (formerly auto)" scopes a rule to matching paths.
    expect(derive('---\ninclusion: fileMatch\ndescription: d\n---\nb\n').type).toBe('requested')
  })

  it('reads an empty rule file through the source\'s own answer', () => {
    // The same plain file means different things per convention, and the answer
    // travels from the source table instead of being guessed here.
    const plain = '---\n---\nbody\n'
    expect(parseRule(plain, { ...CTX, emptyRuleType: 'always' }).rule.type).toBe('always')
    expect(parseRule(plain, { ...CTX, emptyRuleType: 'manual' }).rule.type).toBe('manual')
    // No answer (or `none`) keeps the derived state, which is where such a file
    // used to land; in a real scan the classify gate rejects it first.
    expect(parseRule(plain, CTX).rule.type).toBe('manual')
    expect(parseRule(plain, { ...CTX, emptyRuleType: 'none' }).rule.type).toBe('manual')
  })

  it('reads a user-tier rule through the tier answer, not the file', () => {
    // Augment Code documents that a rule under ~/.augment/rules/ is always on
    // "regardless of frontmatter", while the same file shape in a workspace
    // supports all three states. The tier is what decides, so the answer lands
    // before any field is read.
    const manual = '---\ntype: manual\n---\nb\n'
    const user = { ...CTX, scope: 'user' as const, userRuleType: 'always' as const }
    expect(parseRule(manual, CTX).rule.type).toBe('manual')
    expect(parseRule(manual, user).rule.type).toBe('always')
    // Ignoring a field the file declares has to be said out loud, or the panel
    // shows a state that contradicts the file with no explanation.
    expect(parseRule(manual, user).diagnostics.map((d) => d.code)).toContain('type.tierOverridden')
    // The project tier is untouched by the same source-level declaration.
    expect(parseRule(manual, { ...CTX, userRuleType: 'always' }).rule.type).toBe('manual')
    // A file that declares nothing still goes through the empty-file answer.
    expect(parseRule('---\n---\nb\n', user).rule.type).toBe('always')
  })

  it('keeps a file scoped by paths on demand instead of manual', () => {
    // Claude Code loads a rule without `paths` at launch and one with it when a
    // matching file is touched; Continue's globs pull a rule in the same way.
    // Reading those as manual inverted the upstream meaning.
    expect(derive('---\npaths: [src/**/*.ts]\n---\nbody\n').type).toBe('requested')
    expect(derive('---\nglobs: "**/*.ts"\n---\nbody\n').type).toBe('requested')
    // A file with neither still falls through to manual.
    expect(derive('---\nalwaysApply: false\n---\nbody\n').type).toBe('manual')
  })

  it('maps Devin\'s trigger: agent onto the agent-decided state', () => {
    // "the trigger values always_on, manual, model_decision, agent, and glob all
    // apply"; agent is the agent-decided mode, so it is on-demand - the same as
    // model_decision - and not an unrecognized value.
    const rule = derive('---\ntrigger: agent\n---\nbody\n')
    expect(rule.type).toBe('requested')
    expect(rule.diagnostics.some((d) => d.code === 'trigger.unknown')).toBe(false)
  })

  it('reports an empty list field that was declared inline', () => {
    // "Empty paths array: paths: [] means the rule never activates. Use this to
    // temporarily disable a rule." The three states cannot say that, so the
    // declaration is reported beside the derived state rather than lost.
    const fm = splitFrontmatter('---\npaths: []\n---\nbody\n')
    const empty = fm.diagnostics.find((d) => d.code === 'list.empty')
    expect(empty?.detail).toContain('paths')
    expect(empty?.line).toBe(2)
  })

  it('reads a Cline block list, comments and quotes included', () => {
    // Cline's own example annotates every pattern: - "src/**"  # All files
    // under src/. Leaving the comment glued to the value made the glob dead.
    const rule = derive('---\npaths:\n  - "src/**"           # All files under src/\n  - "*.config.js"      # Config files in root\n---\nbody\n')
    expect(rule.patterns).toEqual(['src/**', '*.config.js'])
  })

  it('reads the singular spellings of a path scope', () => {
    // Qoder documents `paths` as equivalent to `trigger: glob` + `glob`,
    // Antigravity accepts a singular `glob:`, Kiro scopes a fileMatch rule with
    // `fileMatchPattern`, and JetBrains writes `pattern:`. One concept, several
    // spellings, and only the plural two were read.
    expect(derive('---\ntrigger: glob\nglob:\n  - "src/**/*.ts"\n---\nb\n').patterns).toContain('src/**/*.ts')
    expect(derive('---\ninclusion: fileMatch\nfileMatchPattern: "components/**/*.tsx"\ndescription: d\n---\nb\n').patterns).toContain('components/**/*.tsx')
    expect(derive('---\ntype: always on\npattern: src/main/**/*.java\n---\nb\n').patterns).toContain('src/main/**/*.java')
    expect(derive('---\ntrigger: glob\nglob: "*.ts, *.tsx"\n---\nb\n').patterns).toEqual(['*.ts', '*.tsx'])
  })

  it('keeps the fields it has no state for instead of dropping them', () => {
    // scene (Trae), excludeAgent (Copilot), regex (Continue) and the metadata
    // CodeBuddy writes. An editor has to round-trip them, and a rule scoped only
    // by regex still applies when the file content matches.
    expect(splitFrontmatter('---\nscene: git_message\nname: n\n---\nb\n').values['scene']).toBe('git_message')
    expect(derive('---\nregex: "deprecated\\s+API"\nalwaysApply: false\n---\nb\n').type).toBe('requested')
    expect(splitFrontmatter('---\nexcludeAgent: "code-review"\napplyTo: "**/*.ts"\n---\nb\n').values['excludeAgent']).toBe('code-review')
    expect(splitFrontmatter('---\nupdatedAt: 2026-01-13T12:03:50.791Z\nprovider: codebuddy\n---\nb\n').values['updatedAt']).toBe('2026-01-13T12:03:50.791Z')
  })

  it('reads a JetBrains rule file as the always-on rule its type names', () => {
    // The AI Assistant documentation links to this exact file:
    // `type: always on` beside `pattern: src/main/**/*.java`.
    const rule = derive('---\ntype: always on\npattern: src/main/**/*.java\n---\nb\n')
    expect(rule.type).toBe('always')
    expect(rule.diagnostics.some((d) => d.code === 'type.unknown')).toBe(false)
  })

  it('flags a genuinely unknown type and falls back to the formula', () => {
    const rule = derive('---\ntype: nonsense\ndescription: d\n---\nb\n')
    expect(rule.type).toBe('requested')
    expect(rule.diagnostics.some((d) => d.code === 'type.unknown')).toBe(true)
  })

  it('enabled defaults to true and false disables', () => {
    expect(derive('---\ndescription: d\n---\nb\n').enabled).toBe(true)
    expect(derive('---\ndescription: d\nenabled: false\n---\nb\n').enabled).toBe(false)
  })

  it('collects path patterns from both spellings', () => {
    const rule = derive('---\nglobs: "**/*.ts"\npaths: ["src/**"]\n---\nb\n')
    expect(rule.patterns).toContain('**/*.ts')
    expect(rule.patterns).toContain('src/**')
  })

  it('falls back to the file basename when name is absent', () => {
    const rule = derive('---\ndescription: d\n---\nb\n')
    expect(rule.name).toBe('x')
  })

  it('flags a requested rule with no description', () => {
    const rule = deriveRule({
      path: '/p/x.mdc', family: 'codebuddy', sourceKey: 'codebuddy', scope: 'project',
      values: { type: 'requested' }, body: 'b',
      diagnostics: [],
    })
    expect(rule.diagnostics.some((d) => d.code === 'requested.noDescription')).toBe(true)
  })

  it('estimates both description and body tokens', () => {
    const rule = derive('---\ndescription: 测试\nalwaysApply: true\n---\n正文\n')
    expect(rule.descriptionTokens).toBe(2)
    expect(rule.bodyTokens).toBe(2)
  })
})

describe('splitFrontmatter — values the parser must read literally', () => {
  it('reads a list key that carries no inline value', () => {
    // `globs:` with nothing after the colon is a declared empty list, so the
    // key still has to be read even though the value group is missing.
    const fm = splitFrontmatter('---\nglobs:\ndescription: d\n---\nb\n')
    expect(fm.values['globs']).toEqual([])
    expect(fm.values['description']).toBe('d')
    expect(fm.diagnostics.some((d) => d.code === 'fm.emptyList' && d.detail.includes('globs'))).toBe(true)
  })

  it('keeps a hash inside a quoted value', () => {
    // A closed-vocabulary field takes the YAML comment rule, and a `#` inside
    // quotes is data rather than the start of a comment, so both quote styles
    // have to be recognised before the value is cut.
    const fm = splitFrontmatter("---\ntype: 'manual # not a comment'\n---\nb\n")
    expect(fm.values['type']).toBe('manual # not a comment')
  })

  it('ends a block list at the first line that is not an item', () => {
    // The line after the items is another key, not a list entry: the loop has
    // to stop there, keep the items it already read, and let the key be parsed
    // on the next turn of the outer loop.
    const fm = splitFrontmatter('---\npaths:\n  - src/**\n  - lib/*.ts\ndescription: after the list\n---\nb\n')
    expect(fm.values['paths']).toEqual(['src/**', 'lib/*.ts'])
    expect(fm.values['description']).toBe('after the list')
    expect(fm.diagnostics.some((d) => d.code === 'fm.malformed')).toBe(false)
  })
})

describe('deriveRule — the declarations that fall through', () => {
  it('reports an unknown trigger and still derives a state from the file', () => {
    // A non-strict source never rejects on `trigger`: the file is a rule, the
    // unknown value is reported, and the older rungs decide the state.
    const diagnostics: Diagnostic[] = []
    const rule = deriveRule({
      path: '/p/.codebuddy/rules/x.mdc', family: 'codebuddy', sourceKey: 'codebuddy', scope: 'project',
      values: { trigger: 'whenever', alwaysApply: 'true' }, body: 'b', diagnostics,
    })
    expect(rule.type).toBe('always')
    expect(diagnostics.some((d) => d.code === 'trigger.unknown' && d.detail.includes('whenever'))).toBe(true)
  })

  it('takes the declared name instead of the file name', () => {
    const rule = deriveRule({
      path: '/p/.codebuddy/rules/x.mdc', family: 'codebuddy', sourceKey: 'codebuddy', scope: 'project',
      values: { name: 'shell-habits', description: 'd' }, body: 'b', diagnostics: [],
    })
    expect(rule.name).toBe('shell-habits')
  })

  it('reports a strict source that reaches parsing without a trigger', () => {
    // `scanAll` rejects this file before parsing, but `deriveRule` is exported
    // and the guard is what keeps a direct caller from deriving a state that
    // the strict source would never have accepted.
    const diagnostics: Diagnostic[] = []
    const rule = deriveRule({
      path: '/p/.agents/rules/x.md', family: 'agents', sourceKey: 'agents', scope: 'project', strict: true,
      values: { description: 'd' }, body: 'b', diagnostics,
    })
    expect(rule.type).toBe('requested')
    expect(diagnostics.some((d) => d.code === 'trigger.missing')).toBe(true)
  })
})

describe('deriveRule — a list field that arrives as a scalar', () => {
  it('wraps a scalar list field into a one-element pattern list', () => {
    // The frontmatter reader always hands a list key to the derivation as an
    // array, so a bare string can only come from a caller that builds `values`
    // itself. It has to be read as one pattern rather than ignored, because a
    // rule whose only declaration is `paths` is still a requested rule.
    const rule = deriveRule({
      path: '/p/.codebuddy/rules/x.mdc', family: 'codebuddy', sourceKey: 'codebuddy', scope: 'project',
      values: { paths: 'src/**/*.ts' }, body: 'b', diagnostics: [],
    })
    expect(rule.patterns).toEqual(['src/**/*.ts'])
    expect(rule.type).toBe('requested')
  })
})

describe('deriveRule — an empty list field', () => {
  it('treats an empty scalar list field as no pattern at all', () => {
    // The empty string is the second shape `asArray` has to read: a declared
    // but empty list contributes nothing, so the state has to come from the
    // other declarations in the file.
    const rule = deriveRule({
      path: '/p/.codebuddy/rules/x.mdc', family: 'codebuddy', sourceKey: 'codebuddy', scope: 'project',
      values: { paths: '', description: 'd' }, body: 'b', diagnostics: [],
    })
    expect(rule.patterns).toEqual([])
    expect(rule.type).toBe('requested')
  })
})

