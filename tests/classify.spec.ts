import { describe, expect, it } from 'vitest'
import { classify } from '../src/classify.ts'
import { splitFrontmatter } from '../src/parse.ts'

const verdict = (text: string, sourceKey: string) =>
  classify({ frontmatter: splitFrontmatter(text), sourceKey })

const verdict2 = (text: string, sourceKey: string, emptyRuleType?: string) =>
  classify({ frontmatter: splitFrontmatter(text), sourceKey, emptyRuleType: emptyRuleType as never })

describe('classify — is this a rule at all?', () => {
  it('accepts a CodeBuddy public rule', () => {
    expect(verdict('---\ndescription: x\nalwaysApply: false\n---\nb\n', 'codebuddy').isRule).toBe(true)
  })

  it('accepts an enabled-only rule', () => {
    expect(verdict('---\nenabled: true\n---\nb\n', 'codebuddy').isRule).toBe(true)
  })

  // Negative cases: the whole point of the gate. `rules` means four different
  // things across agents, so anything unrecognized must be skipped, not guessed.
  it('rejects a Codex command-permission file', () => {
    const codex = 'prefix_rule(pattern=["powershell.exe", "-Command", "ls"], decision="allow")\n'
    expect(verdict(codex, 'codebuddy').isRule).toBe(false)
  })

  it('rejects ordinary markdown with no frontmatter', () => {
    expect(verdict('# 随手记\n\n今天天气不错\n', 'codebuddy').isRule).toBe(false)
  })

  it('rejects a cc-safety-net-shaped JSON policy', () => {
    expect(verdict('{"version":1,"rules":[],"command_tools":["ops_bash"]}\n', 'codebuddy').isRule).toBe(false)
  })

  it('rejects an unknown type value rather than assuming a state', () => {
    // The known set is the union of the spellings the conventions document; a
    // value outside it still means the file is not one of their rules.
    const v = verdict('---\ntype: whatever\n---\nb\n', 'codebuddy')
    expect(v.isRule).toBe(false)
    expect(v.reason).toContain('whatever')
  })

  it('accepts the type spelling that a vendor publishes', () => {
    // JetBrains links to a rule file carrying `type: always on`. Spacing is
    // theirs, so the value is matched as written instead of being rejected.
    expect(verdict('---\ntype: always on\npattern: src/main/**/*.java\n---\nb\n', 'aiassistant').isRule).toBe(true)
    expect(verdict('---\ntype: always\n---\nb\n', 'codebuddy').isRule).toBe(true)
  })

  it('counts a regex-scoped rule and a scene-only rule as rules', () => {
    // Continue scopes a rule by file content with `regex`, and Trae documents a
    // file whose only field is `scene: git_message`. Neither had a field the
    // gate knew, so both were dropped as ordinary markdown.
    expect(verdict('---\nregex: "deprecated\\s+API"\n---\nb\n', 'continue').isRule).toBe(true)
    expect(verdict('---\nscene: git_message\n---\nb\n', 'trae').isRule).toBe(true)
  })

  // Two more conventions spell their state in frontmatter, so the gate has to
  // recognize both vocabularies or their files are dropped as non-rules.
  it('accepts Augment Code type values instead of calling them unknown', () => {
    expect(verdict('---\ntype: always_apply\ndescription: d\n---\nb\n', 'augment').isRule).toBe(true)
    expect(verdict('---\ntype: agent_requested\ndescription: d\n---\nb\n', 'augment').isRule).toBe(true)
  })

  it('treats Kiro inclusion as a rule field', () => {
    // Without `inclusion` in RULE_FIELDS a Kiro steering file with no
    // description would look like ordinary markdown and be skipped.
    expect(verdict('---\ninclusion: manual\n---\nb\n', 'kiro').isRule).toBe(true)
  })

  it('accepts the empty file of a convention whose plain files are rules', () => {
    // Cline: "Rules without frontmatter are always active." CodeBuddy's own
    // documented always-applied example declares an empty block. Without the
    // source's answer the gate dropped both files before parsing.
    expect(verdict2('---\n---\nb\n', 'cline', 'always').isRule).toBe(true)
    expect(verdict2('# 随手记\n', 'codebuddy', 'always').isRule).toBe(true)
    // The answer is per source: the same plain text is still not a rule for a
    // convention that requires a field.
    expect(verdict2('# 随手记\n', 'cline').isRule).toBe(false)
  })

  it('rejects a configuration file even where plain files are rules', () => {
    // Codex writes permission lists rather than prose, and users drop them into
    // directories named rules as well; the source's empty-file answer cannot
    // turn a call expression into a rule.
    expect(verdict2('prefix_rule(pattern=["ls"], decision="allow")\n', 'codebuddy', 'always').isRule).toBe(false)
    expect(verdict2('# 随手记\n', 'codebuddy', 'always').isRule).toBe(true)
  })

  it('accepts a file whose only field is the one that convention requires', () => {
    // Continue's documented minimum example declares just a `name`; Copilot's
    // `.instructions.md` requires an `applyTo`. Both were invisible to the gate
    // because neither field counted as a rule field.
    expect(verdict2('---\nname: Pirate rule\n---\nb\n', 'continue').isRule).toBe(true)
    expect(verdict2('---\napplyTo: "**/*.ts"\n---\nb\n', 'copilot').isRule).toBe(true)
  })

  it('does not let some other field satisfy a strict source', () => {
    // Kiro declares its mode in `inclusion`, which is a rule field for the gate
    // above but is not a trigger: a strict source keeps requiring `trigger`.
    const fm = splitFrontmatter('---\ninclusion: always\n---\nb\n')
    const v = classify({ frontmatter: fm, sourceKey: 'agents', strict: true })
    expect(v.isRule).toBe(false)
    expect(v.reason).toContain('trigger')
  })
})

describe('classify — which convention?', () => {
  // Family comes from the source directory, because Cursor's documented
  // example carries description + globs + alwaysApply together and any
  // frontmatter-only ordering misclassifies it.
  it('classifies a Cursor rule as cursor even though it has alwaysApply', () => {
    const cursor = '---\ndescription: x\nglobs: "**/*.ts"\nalwaysApply: false\n---\nb\n'
    expect(verdict(cursor, 'cursor').family).toBe('cursor')
  })

  it('classifies a Cursor rule with globs only', () => {
    expect(verdict('---\nglobs: "**/*.ts"\n---\nb\n', 'cursor').family).toBe('cursor')
  })

  it('classifies a Claude Code rule by paths', () => {
    expect(verdict('---\npaths:\n  - "src/**/*.ts"\n---\nb\n', 'claude').family).toBe('claude')
  })

  it('refines a CodeBuddy rule with type into the intranet family', () => {
    expect(verdict('---\ntype: always\n---\nb\n', 'codebuddy').family).toBe('codebuddy-intranet')
  })

  it('keeps a CodeBuddy rule with alwaysApply in the public family', () => {
    expect(verdict('---\nalwaysApply: true\n---\nb\n', 'codebuddy').family).toBe('codebuddy')
  })

  it('gives every added source its own family', () => {
    // A missing case would silently group a source under CodeBuddy's badge.
    for (const key of ['trae-cn', 'qoder-cn', 'lingma', 'aiassistant', 'antigravity']) {
      expect(verdict('---\ndescription: d\n---\nb\n', key).family, key).toBe(key)
    }
  })

  it('defaults an unknown source key to the codebuddy family without rejecting', () => {
    const v = verdict('---\ndescription: d\n---\nb\n', 'something-new')
    expect(v.isRule).toBe(true)
    expect(v.family).toBe('codebuddy')
  })
})

describe('classify — strict sources require a trigger', () => {
  const strict = (text: string, sourceKey = 'agents') =>
    classify({ frontmatter: splitFrontmatter(text), sourceKey, strict: true })

  it('accepts a .agents rule that declares a known trigger', () => {
    expect(strict('---\ntrigger: always_on\n---\nb\n').isRule).toBe(true)
    expect(strict('---\ntrigger: Always_On\n---\nb\n').isRule).toBe(true)   // case-insensitive
  })

  it('rejects a .agents file with no trigger even when it carries other rule fields', () => {
    const v = strict('---\ndescription: x\nalwaysApply: true\nglobs: "**/*.ts"\n---\nb\n')
    expect(v.isRule).toBe(false)
    expect(v.reason).toContain('trigger')
  })

  it('rejects an unrecognized trigger and names it', () => {
    const v = strict('---\ntrigger: whenever\n---\nb\n')
    expect(v.isRule).toBe(false)
    expect(v.reason).toContain('whenever')
  })

  it('accepts the very same file when the source is not strict', () => {
    const fm = splitFrontmatter('---\ndescription: x\nalwaysApply: true\n---\nb\n')
    expect(classify({ frontmatter: fm, sourceKey: 'codebuddy' }).isRule).toBe(true)
  })

  it('reports the agents family for the .agents source key', () => {
    expect(strict('---\ntrigger: manual\n---\nb\n').family).toBe('agents')
  })
})
