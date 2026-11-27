/** Shared types for dsh-rules-manager. */
import type { Agent } from '@deepseek-ai/dsh-agent'

/**
 * Source recorded on the injected rules message.
 *
 * `MessageSourceMap` is merge-extensible: each producer declares its own
 * `kind` in its own module. This is the same seam the host's own
 * `dsh-agent-instructions` uses for its `'agent-instructions'` kind
 * (`dsh-agent-instructions/src/state.ts`). Declaring it here replaces a cast
 * and makes the source visible to any consumer that switches on `kind`.
 */
export interface RulesContextSource {
  readonly kind: 'rules-context'
  readonly form: 'instructions'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'rules-context': RulesContextSource
  }
}

/**
 * The session working-directory service, as this plugin uses it.
 *
 * The session directory is the one the agent was opened on. `process.cwd()` is
 * the directory of the DSH host process and has nothing to do with the
 * workspace, so climbing from it finds no project marker and every
 * project-scoped rule is missed.
 *
 * Declared structurally instead of imported from
 * `@deepseek-ai/dsh-working-directory`: that package is a host peer this plugin
 * does not depend on, and `ensure` is the only member used. The host registers
 * the real service under the name listed in the entry's `inject`.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional: the browser-transport service, absent in non-web compositions. */
    readonly connection?: {
      readonly fetch?: { register(route: unknown): () => Promise<void> | void }
    }
    workingDirectory: {
      /** The session's absolute directory, restoring the original when it is gone. */
      ensure(agent: Agent, signal?: AbortSignal): Promise<string>
    }
  }
}

/** The three rule states, matching CodeBuddy's RuleType semantics. */
export type RuleType = 'always' | 'requested' | 'manual'

/** Which tier a rule was found in: the user's home, or the session's project. */
export type RuleScope = 'user' | 'project'

/**
 * Which agent's convention a rule file follows.
 *
 * The family name equals the source key for every convention except
 * CodeBuddy's intranet build: it shares `.codebuddy/rules` with the public
 * build and is told apart by frontmatter, so it needs a name of its own.
 * Keep this union in step with the keys of `SOURCES` (src/scan.ts).
 */
export type RuleFamily =
  | 'codebuddy' | 'codebuddy-intranet'
  | 'cursor' | 'claude' | 'agents'
  | 'trae' | 'qoder' | 'cline' | 'roo' | 'devin' | 'windsurf'
  | 'copilot' | 'junie' | 'amazonq' | 'tabnine' | 'continue'
  | 'trae-cn' | 'qoder-cn' | 'lingma' | 'aiassistant' | 'antigravity'
  | 'kiro' | 'augment'

/**
 * The state a rule takes when its file declares nothing at all.
 *
 * The same empty file means different things to different conventions, so the
 * answer belongs to the source rather than to the parser: Cline and CodeBuddy
 * apply it to every request, Cursor's `.mdc` with no state field is only
 * reachable through an @-mention, and a plain file under a convention with a
 * metadata vocabulary is not a rule of that convention. `none` keeps the
 * rejection the classify gate has always applied.
 */
export type EmptyRuleType = 'always' | 'requested' | 'manual' | 'none'

/** Where a rule file was found. */
export interface RuleSource {
  /** Stable key, e.g. `codebuddy`, `cursor`, `.codebuddy` (project). */
  readonly key: string
  /** Display label. */
  readonly label: string
  /**
   * The official page this entry was verified against.
   *
   * One link per source, so updating a convention means re-reading the upstream
   * page the entry comment quotes instead of re-deriving the path from memory.
   * The scan tests require an https URL on every entry.
   */
  readonly docs: string
  /**
   * Absolute user-level directory, if this source has one.
   *
   * A function is evaluated on every root resolution rather than once at
   * import, so a source whose root comes from the environment (the .agents
   * source reads the DSH_AGENTS_HOME variable) honors a change made after this
   * module was loaded. The environment is passed in so a test can drive it.
   */
  readonly userPath?: string | ((env: NodeJS.ProcessEnv) => string)
  /**
   * Additional user-level directories for the same convention.
   *
   * The first directory stays in {@link userPath}, so every reader that knows
   * one path keeps working; this holds the rest. Cline documents two global
   * directories (`~/.cline/rules` and `~/Cline/Rules`) and GitHub Copilot CLI
   * two user-level locations, so a single path cannot describe either one.
   * Roots resolve once per entry, and the convention's one switch covers all of
   * them — which is what the upstream pages describe: one combined rule set per
   * tier.
   */
  readonly userPaths?: readonly (string | ((env: NodeJS.ProcessEnv) => string))[]
  /** Project-relative directory (joined onto the project root). */
  readonly projectDir?: string
  /** Additional project-relative directories, like {@link userPaths}. */
  readonly projectDirs?: readonly string[]
  /**
   * User-level single files, each resolved as its own root.
   *
   * Some conventions define an always-on instruction as one named file rather
   * than a directory (Devin's `~/.devin/global_rules.md`, Copilot CLI's
   * `~/.copilot/copilot-instructions.md`). A file root carries the file's own
   * path, so the panel shows the file and its switch covers it; the directory
   * walker cannot express it because there is no directory to walk.
   */
  readonly userFiles?: readonly (string | ((env: NodeJS.ProcessEnv) => string))[]
  /** Project-relative single files, each resolved as its own root. */
  readonly projectFiles?: readonly string[]
  /** Accepted file extensions. */
  readonly extensions: readonly string[]
  /**
   * Accepted filename suffixes, narrowing {@link extensions}.
   *
   * GitHub Copilot reads only `.github/instructions/*.instructions.md`, so an
   * extension alone is too permissive there: `notes.md` in that directory is
   * not a repository instruction. Both filters apply, in order: a candidate
   * must pass `extensions` and then `suffixes`. Undefined means every file
   * with an accepted extension is read, which is every other convention.
   */
  readonly suffixes?: readonly string[]
  /** Always false: external rule files are never written. */
  readonly mutable: false
  /**
   * Catalog ordering only: a lower rank sorts first (see scanAll).
   *
   * Rank is **not** a conflict resolution. Two rules that share a name are both
   * kept, because identity is the absolute path; ties break on name.
   */
  readonly rank: number
  /**
   * When true, a file with no valid `trigger` is not a rule at all.
   *
   * Antigravity's .agents/rules convention drops such a file rather than
   * deriving a state from whatever else it carries; every other convention
   * keeps the derivation.
   */
  readonly requiresTrigger?: boolean
  /**
   * What a rule file that declares nothing at all means for this convention.
   *
   * Roo Code, Junie, Amazon Q and Tabnine document no frontmatter vocabulary:
   * their directories are read whole, every file applies to every request, and
   * nothing in the file says so. Cline documents the same outcome for a file
   * with no frontmatter, while Cursor keeps an `.mdc` with no state field out
   * of the prompt until it is mentioned. Without a value other than `none` the
   * classify gate rejects such a file as "not a recognizable rule file", so the
   * source would scan a directory and find nothing in it. The value travels
   * from the source table through the caller, exactly like
   * {@link requiresTrigger}.
   */
  readonly emptyRuleType?: EmptyRuleType
  /**
   * What a file in the **user** tier means when it declares nothing.
   *
   * One convention answers differently per tier: Augment documents that
   * "User rules in `~/.augment/rules/` are always treated as `always_apply`
   * and do not support other frontmatter types", while its workspace rules
   * support all three states. Omitting this keeps {@link emptyRuleType} for
   * both tiers.
   */
  readonly userRuleType?: EmptyRuleType
  /**
   * When true, only the root directory itself is read; subdirectories are not
   * descended into.
   *
   * Antigravity scans only the immediate `.md` children of `.agents/rules` and
   * ignores nested files (it registers those explicitly in `.agents/rules.json`
   * instead). Every other supported convention is recursive.
   */
  readonly flat?: boolean
}

/** A parsed rule. */
export interface Rule {
  /** Absolute path; also the dedupe key (per Cursor's own FAQ). */
  readonly path: string
  /** Name from frontmatter, else the file's basename without extension. */
  readonly name: string
  /** Derived state. */
  readonly type: RuleType
  /** Whether the rule is enabled at all (`enabled: false` disables). */
  readonly enabled: boolean
  /** Routing description; empty for `manual`. */
  readonly description: string
  /** Markdown body after frontmatter removal. */
  readonly body: string
  /** Which convention this file follows. */
  readonly family: RuleFamily
  /** Source key it came from. */
  readonly sourceKey: string
  /**
   * Which tier the file was found in.
   *
   * Carried from the scan root rather than re-derived from the path: the root
   * is the only place that actually knows, and a prefix comparison here would
   * be a second, weaker definition of the same fact.
   */
  readonly scope: RuleScope
  /** Path patterns from `paths` (Claude Code) and `globs` (Cursor). */
  readonly patterns: readonly string[]
  /** Approximate token cost of `description`. */
  readonly descriptionTokens: number
  /** Approximate token cost of `body`. */
  readonly bodyTokens: number
  /** Diagnostics collected while parsing. */
  readonly diagnostics: readonly Diagnostic[]
}

/** A non-fatal problem found while parsing or scanning. */
export interface Diagnostic {
  readonly code: string
  readonly detail: string
  /** 1-based line, when the diagnostic points at a line. */
  readonly line?: number
  /**
   * Absolute path of the file this came out of, when one did.
   *
   * A rule-level diagnostic rides on its rule row, where the path is implied;
   * the same diagnostic is also copied into the walk-level list, and there the
   * path is the only thing that says which file it is about — or, when the file
   * was rejected outright, that there *was* a file rather than a broken walk.
   */
  readonly path?: string
}
