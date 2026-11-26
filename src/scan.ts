/**
 * Discover rule files across agent conventions.
 *
 * Layout follows the reference skills-manager: a declarative source table, a
 * user tier under the home directory, and a project tier under the nearest
 * ancestor containing `.git`. Bounds mirror its constants so one misconfigured
 * root cannot exhaust memory. Sources are always read-only.
 */
import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { classify } from './classify.ts'
import { parseRule, splitFrontmatter } from './parse.ts'
import type { Diagnostic, Rule, RuleSource } from './types.ts'

/** Recursion depth cap for a source root. */
export const MAX_SCAN_DEPTH = 6
/** Directory cap per root. */
export const MAX_SCAN_DIRECTORIES = 2000
/** Entry cap per root. */
export const MAX_SCAN_ENTRIES = 20000

/**
 * Supported sources.
 *
 * Only conventions whose files are agent instruction rules appear here.
 * Deliberately absent: Codex's `~/.codex/rules` (shell permission lists),
 * cc-safety-net's JSON policies, and WorkBuddy's identity files — all share
 * the word "rules" but are a different domain (§13.1). WorkBuddy needs no
 * entry of its own: its IDE rules are `.codebuddy/rules`, already covered by
 * the `codebuddy` source below.
 *
 * Every entry is read-only and recursive unless a flag says otherwise. Each one
 * carries the official page it was verified against in `docs`, and the comment
 * above it quotes the sentence that fixes the path, so a later update can
 * re-read upstream instead of re-deriving the layout from memory.
 *
 * A source whose user tier is not documented upstream leaves `userPath` unset
 * rather than guessing an absolute path that would scan an unrelated directory.
 * When two conventions share one directory the tier is declared once: the
 * second entry omits it rather than scanning the same files under two keys.
 */
export const SOURCES: readonly RuleSource[] = [
  {
    // https://codebuddy.ai/docs/cli/codebuddy-dir - the documented tree lists
    // `rules/` beside `agents/` and `skills/` under `~/.codebuddy` (user level)
    // and under the repository's own `.codebuddy/` (project level).
    key: 'codebuddy', label: 'CodeBuddy',
    docs: 'https://codebuddy.ai/docs/cli/codebuddy-dir',
    userPath: join(homedir(), '.codebuddy', 'rules'),
    projectDir: '.codebuddy/rules',
    extensions: ['.mdc', '.md'], mutable: false, rank: 100, emptyRuleType: 'always',
  },
  {
    // https://cursor.com/docs/rules - "Project rules must use the .mdc
    // extension. A plain .md file in .cursor/rules is ignored by the rules
    // system because it has no frontmatter", with plain markdown pointed at
    // AGENTS.md instead (a single-file convention this table does not model).
    // The user tier is documented at https://cursor.com/help/customization/rules
    // ("User rule files in ~/.cursor/rules ... stay on the machine").
    key: 'cursor', label: 'Cursor',
    docs: 'https://cursor.com/docs/rules.md',
    userPath: join(homedir(), '.cursor', 'rules'),
    projectDir: '.cursor/rules',
    extensions: ['.mdc'], mutable: false, rank: 200, emptyRuleType: 'none',
  },
  {
    // https://docs.claude.com/en/docs/claude-code/memory - "Organize rules with
    // .claude/rules/", and "User-scope memory files, such as ~/.claude/CLAUDE.md
    // and ~/.claude/rules/, are files you wrote yourself".
    key: 'claude', label: 'Claude Code',
    docs: 'https://docs.claude.com/en/docs/claude-code/memory',
    userPath: join(homedir(), '.claude', 'rules'),
    projectDir: '.claude/rules',
    extensions: ['.md'], mutable: false, rank: 300, emptyRuleType: 'always',
  },
  {
    // https://antigravity.google/docs/rules - "You can place an AGENTS.md or
    // GEMINI.md file-or a .agents/rules/ directory-in your workspace folder and
    // in any parent folder up to the repository root", with ".agents/rules/*.md
    // (and legacy .agent/rules/*.md)" and a flat scan that ignores subfolders
    // unless they are registered in .agents/rules.json.
    // The user tier here is the DSH shared agents root, not Antigravity's own
    // per-user directory: see the `antigravity` entry below for the latter.
    key: 'agents', label: 'Agent standard (.agents)',
    docs: 'https://antigravity.google/docs/rules',
    // Deferred: the shared agents root comes from the environment, so it is
    // read at scan time rather than frozen into this table at import.
    userPath: (env) => join(agentsHome(env), 'rules'),
    projectDir: '.agents/rules',
    // Antigravity defines markdown only, so a CodeBuddy or Cursor .mdc file
    // stays out of this source even when it sits in the same directory.
    extensions: ['.md'], mutable: false, rank: 400, requiresTrigger: true, flat: true, emptyRuleType: 'none',
  },
  {
    // https://docs.trae.ai/ide/rules - "macOS/Linux: ~/.trae/user_rules.
    // Windows: %userprofile%/.trae/user_rules. Project rules: the .trae/rules/
    // directory under the project path", with every rule file (including
    // AGENTS.md and CLAUDE.md) capped at 32K bytes in total.
    key: 'trae', label: 'Trae',
    docs: 'https://docs.trae.ai/ide/rules',
    userPath: join(homedir(), '.trae', 'user_rules'),
    projectDir: '.trae/rules',
    extensions: ['.md'], mutable: false, rank: 500, emptyRuleType: 'always',
  },
  {
    // https://docs.qoder.com/cli/memory - the CLI page prints both tiers:
    // "project-level | <project>/.qoder/rules/**/*.md" and "User-Level |
    // ~/.qoder/rules/**/*.md", with "User-Level rules are read from the User
    // Configuration Directory and apply to all projects". The IDE page
    // documents the project tier only, which is why this entry went without a
    // user path for so long; the CN build documents its own at
    // https://docs.qoder.cn/user-guide/rules (see the `qoder-cn` entry below).
    key: 'qoder', label: 'Qoder',
    docs: 'https://docs.qoder.com/user-guide/rules',
    userPath: join(homedir(), '.qoder', 'rules'),
    projectDir: '.qoder/rules',
    extensions: ['.md'], mutable: false, rank: 510, emptyRuleType: 'always',
  },
  {
    // https://docs.cline.bot/customization/cline-rules - "Workspace rules go in
    // .clinerules/ or .cline/rules/ at your project root. Both layouts are
    // supported by VS Code, Desktop, and the CLI", and "Cline also searches
    // ~/.cline/rules and ~/Cline/Rules for global rules. On Windows, it checks
    // Documents\\Cline\\Rules under the OneDrive directories configured by
    // OneDrive, OneDriveConsumer". Every spelling is a directory, so the older
    // note about a single .clinerules *file* was wrong. Both directories of a
    // tier are declared: the docs describe one combined rule set per tier, not
    // two independent sources. The Windows OneDrive spelling is not declared —
    // its parent comes from the user's own OneDrive configuration, which this
    // table has no environment access to at import time.
    // The CLI reference documents "`CLINE_DIR` | Custom configuration
    // directory (replaces `~/.cline/`)", so the primary global directory is
    // resolved at scan time rather than frozen at import.
    key: 'cline', label: 'Cline',
    docs: 'https://docs.cline.bot/customization/cline-rules.md',
    userPath: (env) => join(clineHome(env), 'rules'),
    userPaths: [join(homedir(), 'Cline', 'Rules')],
    projectDir: '.clinerules',
    projectDirs: ['.cline/rules'],
    extensions: ['.md'], mutable: false, rank: 520, emptyRuleType: 'always',
  },
  {
    // https://docs.roocode.com/features/custom-instructions - "Global Rules
    // Directory ... Linux/macOS: ~/.roo/rules/ and ~/.roo/rules-{modeSlug}/" with
    // the same pair under the workspace, plus the single-file fallbacks
    // .roorules and .roorules-{modeSlug}: "If .roo/rules/ doesn't exist or is
    // empty, Roo Code looks for a single .roorules file in the workspace root."
    // The base directory of each tier and the workspace-level fallback file are
    // declared. The per-mode directories are not — a mode slug is whatever the
    // user installed, so the set cannot be enumerated — and the "only when the
    // directory is empty" ordering is not modeled, so a project carrying both
    // shows both.
    key: 'roo', label: 'Roo Code',
    docs: 'https://docs.roocode.com/features/custom-instructions',
    userPath: join(homedir(), '.roo', 'rules'),
    projectDir: '.roo/rules',
    projectFiles: ['.roorules'],
    extensions: ['.md', '.txt'], mutable: false, rank: 530, emptyRuleType: 'always',
  },
  {
    // https://docs.devin.ai/desktop/devin-local/customizations - "put one rule
    // per file in .devin/rules/*.md", with the same paths under the home
    // directory for every project, and ".devin/global_rules.md is a single
    // always-on file. Place the same files in your home directory
    // (~/.devin/rules/*.md, ~/.devin/global_rules.md)". Both the directory and
    // the always-on file are declared. ~/.config/devin/AGENTS.md is not: it is
    // an AGENTS.md convention rather than a rules file, and this table models a
    // single file only where that file is the whole convention.
    // File roots skip the extension filter, since the declaration is the exact
    // name; the suffix filter only ever narrows a directory listing.
    key: 'devin', label: 'Devin / Windsurf',
    docs: 'https://docs.devin.ai/desktop/devin-local/customizations',
    userPath: join(homedir(), '.devin', 'rules'),
    userFiles: [join(homedir(), '.devin', 'global_rules.md')],
    projectDir: '.devin/rules',
    projectFiles: ['.devin/global_rules.md'],
    extensions: ['.md'], mutable: false, rank: 540, emptyRuleType: 'always',
  },
  {
    // Same page as the devin source, which still carries the earlier name:
    // Same page: "The legacy .windsurf/rules/*.md, .windsurf/global_rules.md,
    // and .windsurfrules files are imported by default", so both single files
    // are declared beside the directory. The user-level always-on file is
    // "~/.codeium/windsurf/memories/global_rules.md | A single file that applies
    // to all workspaces. Always enabled. Limited to 6,000 characters." — quoted
    // from the localized official pages at
    // https://docs.windsurf.com/zh/windsurf/cascade/memories, because the
    // English page now redirects to the Devin documentation and no longer
    // prints the path.
    key: 'windsurf', label: 'Windsurf (legacy)',
    docs: 'https://docs.devin.ai/desktop/devin-local/customizations',
    userFiles: [join(homedir(), '.codeium', 'windsurf', 'memories', 'global_rules.md')],
    projectDir: '.windsurf/rules',
    projectFiles: ['.windsurf/global_rules.md', '.windsurfrules'],
    extensions: ['.md'], mutable: false, rank: 550, emptyRuleType: 'always',
  },
  {
    // https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
    // - "one or more NAME.instructions.md files within or below the
    // .github/instructions directory in the repository", hence the suffix
    // filter, plus the repository-level single file
    // ".github/copilot-instructions.md". Copilot CLI documents the user tier
    // (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions):
    // "$HOME/.copilot/instructions/**/*.instructions.md" and
    // "$HOME/.copilot/copilot-instructions.md", with "If you set the
    // COPILOT_HOME environment variable, Copilot CLI uses that directory instead
    // of $HOME/.copilot for both user-level instruction locations." The earlier
    // note that personal instructions live only in the account was out of date.
    // File roots skip the extension and suffix filters — the exact filename is
    // the declaration, and copilot-instructions.md does not match the suffix.
    key: 'copilot', label: 'GitHub Copilot',
    docs: 'https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions',
    userPath: (env) => join(copilotHome(env), 'instructions'),
    userFiles: [(env) => join(copilotHome(env), 'copilot-instructions.md')],
    projectDir: '.github/instructions',
    projectFiles: ['.github/copilot-instructions.md'],
    extensions: ['.md'], suffixes: ['.instructions.md'], mutable: false, rank: 560, emptyRuleType: 'manual',
  },
  {
    // https://junie.jetbrains.com/docs/guidelines-and-memory.html - Junie looks
    // for a .junie/AGENTS.md first, then AGENTS.md "combined with
    // .junie/playbook.md and every .junie/rules/*.md file", then the legacy
    // .junie/guidelines.md or .junie/guidelines/ folder. Only the directory is
    // read here. The page answers 403 to a direct fetch and has to be read
    // through a text proxy.
    // ".junie/guidelines.md file or .junie/guidelines/ folder - legacy (still
    // supported)" is the third rung; the directory is read as a second project
    // tier. The `.junie/AGENTS.md` and `AGENTS.md` rungs above it are the
    // AGENTS.md convention rather than a rules directory, and are not modeled
    // here; JUNIE_HOME relocates the global directory, which this table does not
    // read at all.
    key: 'junie', label: 'Junie (JetBrains)',
    docs: 'https://junie.jetbrains.com/docs/guidelines-and-memory.html',
    projectDir: '.junie/rules',
    projectDirs: ['.junie/guidelines'],
    extensions: ['.md'], mutable: false, rank: 570, emptyRuleType: 'always',
  },
  {
    // https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/context-project-rules.html
    // - "Project rules are defined in Markdown files in the project's
    // project-root /.amazonq/rules folder." A user-level directory is not
    // documented; the open request for one is aws/amazon-q-developer-cli#3451.
    key: 'amazonq', label: 'Amazon Q',
    docs: 'https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/context-project-rules.html',
    projectDir: '.amazonq/rules',
    extensions: ['.md'], mutable: false, rank: 580, emptyRuleType: 'always',
  },
  {
    // https://docs.tabnine.com/main/getting-started/tabnine-agent/guidelines - "Guidelines are Markdown files stored in your project's
    // /.tabnine/guidelines/ directory", and the same folder is described for the
    // home directory ("This directory will either reside either 1) in your home
    // directory or 2) on a per-project basis"); the literal home path is never
    // printed, so the user tier stays unset. Tabnine CLI's "guidelines" are
    // account-level context plus a tool switch, a different domain.
    key: 'tabnine', label: 'Tabnine',
    docs: 'https://docs.tabnine.com/main/getting-started/tabnine-agent/guidelines.md',
    projectDir: '.tabnine/guidelines',
    extensions: ['.md'], mutable: false, rank: 590, emptyRuleType: 'always',
  },
  {
    // https://docs.continue.dev/customize/rules - "Local Rules (.continue/rules)".
    // No documentation page prints a global rules directory; Continue's own
    // source builds ~/.continue/rules, but an undocumented path is not read
    // here, and its config.yaml-driven rules are not files at all.
    key: 'continue', label: 'Continue',
    docs: 'https://docs.continue.dev/customize/rules',
    projectDir: '.continue/rules',
    extensions: ['.md'], mutable: false, rank: 600, emptyRuleType: 'always',
  },
  {
    // https://docs.trae.com.cn/ide/rules - the CN build keeps its global rules in
    // ~/.trae-cn/user_rules (%userprofile%/.trae-cn/user_rules on Windows).
    // Its project tier is .trae/rules, the directory the `trae` entry above
    // already reads, and .trae/rules/ is a single directory, so declaring it
    // twice would put the same files under two source keys; no projectDir here.
    key: 'trae-cn', label: 'Trae CN',
    docs: 'https://docs.trae.com.cn/ide/rules',
    userPath: join(homedir(), '.trae-cn', 'user_rules'),
    extensions: ['.md'], mutable: false, rank: 610, emptyRuleType: 'always',
  },
  {
    // https://docs.qoder.cn/user-guide/rules - "user level ~/.qoder-cn/rules/,
    // project level .qoder/rules/ under the project root". The project tier is
    // the `qoder` entry's directory, so only the user tier is declared here.
    key: 'qoder-cn', label: 'Qoder CN',
    docs: 'https://docs.qoder.cn/user-guide/rules',
    userPath: join(homedir(), '.qoder-cn', 'rules'),
    extensions: ['.md'], mutable: false, rank: 620, emptyRuleType: 'always',
  },
  {
    // https://help.aliyun.com/zh/lingma/qoder-cn/user-guide/rules - Lingma, the
    // former name of Qoder CN, documents project-only rules: "these rules are
    // stored in the .lingma/rules directory". No user-level directory is
    // documented, so userPath stays unset.
    key: 'lingma', label: 'Lingma',
    docs: 'https://help.aliyun.com/zh/lingma/qoder-cn/user-guide/rules',
    projectDir: '.lingma/rules',
    extensions: ['.md'], mutable: false, rank: 630, emptyRuleType: 'always',
  },
  {
    // https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html -
    // "you can manually create the .aiassistant/rules folder in the project root
    // and add a .md file there". Project rules only, and the page documents no
    // frontmatter vocabulary, so the source is read whole like the other
    // plain-markdown conventions.
    key: 'aiassistant', label: 'JetBrains AI Assistant',
    docs: 'https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html',
    projectDir: '.aiassistant/rules',
    extensions: ['.md'], mutable: false, rank: 640, emptyRuleType: 'always',
  },
  {
    // https://antigravity.google/docs/rules - Antigravity's own per-user
    // directory: "Modular global rules (YAML frontmatter required):
    // ~/.gemini/config/rules/*.md". It is a different location from the DSH
    // shared agents root the `agents` entry resolves, so it gets its own key.
    // The page documents flat scanning for .agents/rules only, so this
    // directory keeps the default recursive walk.
    key: 'antigravity', label: 'Antigravity',
    docs: 'https://antigravity.google/docs/rules',
    userPath: join(homedir(), '.gemini', 'config', 'rules'),
    extensions: ['.md'], mutable: false, rank: 650, requiresTrigger: true, emptyRuleType: 'none',
  },
  {
    // https://kiro.dev/docs/steering/ - "Workspace steering files reside in your
    // project root folder under .kiro/steering/" and "Global steering files
    // reside in your home directory under ~/.kiro/steering/". The inclusion
    // modes are always ("### Always included (default)"), fileMatch, manual, and
    // auto with a name and description — fileMatch and auto are listed as two
    // distinct modes, and the page claims no alias between them; it also notes
    // "AGENTS.md files do not support inclusion modes and are always included",
    // so a steering file with no frontmatter is always-on — which is exactly
    // what emptyRuleType: 'always' derives. ~/.kiro/settings/permissions.yaml,
    // hooks/ and mcp.json sit in the same directory tree but are a different
    // domain and stay unread. KIRO_HOME relocates the global directory
    // (https://kiro.dev/docs/configuration/).
    key: 'kiro', label: 'Kiro',
    docs: 'https://kiro.dev/docs/steering/',
    userPath: (env) => join(kiroHome(env), 'steering'),
    projectDir: '.kiro/steering',
    extensions: ['.md'], mutable: false, rank: 660, emptyRuleType: 'always',
  },
  {
    // https://docs.augmentcode.com/setup-augment/guidelines - "Rules are files
    // that live in the .augment/rules directory", with the scope table "User |
    // ~/.augment/rules/ | Available in all workspaces" and "Workspace |
    // <workspace_root>/.augment/rules/ | Available in current workspace only".
    // The frontmatter table is "| type | Controls when the rule is applied |
    // always_apply, agent_requested, manual | always_apply |", and "User rules
    // in ~/.augment/rules/ are always treated as always_apply and do not support
    // other frontmatter types" — so a rule with no frontmatter is always-on,
    // which is what emptyRuleType: 'always' derives. The CLI page widens the
    // extensions ("Recursively searches .md and .mdc files") and documents the
    // two single-file aliases read here:
    // "~/.augment/user-guidelines.md" (VS Code per-user) and
    // "<workspace_root>/.augment-guidelines".
    key: 'augment', label: 'Augment Code',
    docs: 'https://docs.augmentcode.com/setup-augment/guidelines',
    userPath: join(homedir(), '.augment', 'rules'),
    userFiles: [join(homedir(), '.augment', 'user-guidelines.md')],
    projectDir: '.augment/rules',
    projectFiles: ['.augment-guidelines'],
    extensions: ['.md', '.mdc'], mutable: false, rank: 670, emptyRuleType: 'always',
    // The tier answers before the file does: the same page says user rules are
    // "always treated as always_apply and do not support other frontmatter
    // types", while workspace rules "support all three types (Always, Manual,
    // Auto) via frontmatter configuration".
    userRuleType: 'always',
  },
]

/**
 * The shared agents root.
 *
 * Resolves the DSH_AGENTS_HOME variable when it is set and non-empty, else
 * `~/.agents` - the same order the host's own dsh-agent-instructions
 * documents. Resolved locally rather than through
 * `@deepseek-ai/dsh-home-paths`, which is a host peer this plugin does not
 * depend on and which is installed in neither node_modules tree.
 */
export function agentsHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['DSH_AGENTS_HOME']
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.agents')
}

/**
 * GitHub Copilot CLI's user-level directory.
 *
 * The CLI page states the override for both user-level locations: "If you set
 * the COPILOT_HOME environment variable, Copilot CLI uses that directory
 * instead of $HOME/.copilot". Read at resolution time like {@link agentsHome},
 * so a change after import is honored.
 */
export function copilotHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['COPILOT_HOME']
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.copilot')
}

/**
 * Kiro's global directory.
 *
 * "Override the global directory with KIRO_HOME: Set KIRO_HOME to an absolute
 * path to keep separate Kiro profiles" (https://kiro.dev/docs/configuration/);
 * the steering directory moves with it.
 */
export function kiroHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['KIRO_HOME']
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.kiro')
}

/**
 * Cline's configuration directory.
 *
 * "CLINE_DIR | Custom configuration directory (replaces ~/.cline/)" from the
 * CLI reference. Only the primary global directory moves; `~/Cline/Rules` is
 * a fixed second location Cline searches on its own.
 */
export function clineHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['CLINE_DIR']
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.cline')
}

export interface ScanRoot {
  readonly source: RuleSource
  /**
   * Absolute directory or file path.
   *
   * Most roots are directories. A convention whose whole user tier is one named
   * file (Devin's `~/.devin/global_rules.md`) resolves to that file instead,
   * and {@link kind} says which this is.
   */
  readonly path: string
  readonly scope: 'user' | 'project'
  /**
   * Whether this root is a directory to walk or a single file to read.
   *
   * The panel shows `path` either way, and a switch keyed by the path scopes to
   * exactly what the user pointed at, so the two kinds need no separate UI.
   */
  readonly kind: 'directory' | 'file'
}

export interface ScanResult {
  readonly rules: readonly Rule[]
  readonly diagnostics: readonly Diagnostic[]
  readonly truncated: boolean
  /**
   * The roots actually scanned, in resolution order.
   *
   * The panel shows each source's real directory, and this is the only list
   * that knows it: `resolveRoots` already dropped every root that does not
   * exist, so re-deriving paths elsewhere would invent directories that are
   * not there.
   */
  readonly roots: readonly ScanRoot[]
}

/**
 * Roots that exist on disk, for the given project root.
 *
 * A convention may declare more than one directory per tier (Cline documents
 * `~/.cline/rules` and `~/Cline/Rules`), and a few declare a named single file
 * instead of a directory. Order is the declaration order, so the first
 * directory of a source stays the one a reader that knows a single path sees.
 * Duplicates collapse, so the same path written twice is one root.
 */
export async function resolveRoots(
  projectRoot: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly ScanRoot[]> {
  const out: ScanRoot[] = []
  const seen = new Set<string>()
  const push = async (source: RuleSource, path: string, scope: 'user' | 'project', kind: 'directory' | 'file'): Promise<void> => {
    const identity = kind + ':' + path
    if (seen.has(identity)) return
    const exists = kind === 'directory' ? await isDirectory(path) : await isFile(path)
    if (!exists) return
    seen.add(identity)
    out.push({ source, path, scope, kind })
  }
  for (const source of SOURCES) {
    for (const path of userRootsOf(source, env)) await push(source, path, 'user', 'directory')
    for (const path of userFilesOf(source, env)) await push(source, path, 'user', 'file')
    if (projectRoot !== null) {
      for (const dir of projectDirsOf(source)) await push(source, join(projectRoot, dir), 'project', 'directory')
      for (const file of source.projectFiles ?? []) await push(source, join(projectRoot, file), 'project', 'file')
    }
  }
  return out
}

/** Every user-level directory a source declares, primary first. */
function userRootsOf(source: RuleSource, env: NodeJS.ProcessEnv): readonly string[] {
  const declared = [source.userPath, ...(source.userPaths ?? [])]
  const out: string[] = []
  for (const entry of declared) {
    if (entry === undefined) continue
    out.push(typeof entry === 'function' ? entry(env) : entry)
  }
  return out
}

/** Every project-relative directory a source declares, primary first. */
function projectDirsOf(source: RuleSource): readonly string[] {
  return source.projectDir === undefined ? (source.projectDirs ?? []) : [source.projectDir, ...(source.projectDirs ?? [])]
}

/** Every user-level single file a source declares. */
function userFilesOf(source: RuleSource, env: NodeJS.ProcessEnv): readonly string[] {
  const out: string[] = []
  for (const entry of source.userFiles ?? []) {
    out.push(typeof entry === 'function' ? entry(env) : entry)
  }
  return out
}

export interface ScanOptions {
  /** Recursion depth cap per source root; defaults to {@link MAX_SCAN_DEPTH}. */
  readonly maxDepth?: number
  /** Directory cap per root; defaults to {@link MAX_SCAN_DIRECTORIES}. */
  readonly maxDirectories?: number
  /** Entry cap per root; defaults to {@link MAX_SCAN_ENTRIES}. */
  readonly maxEntries?: number
}

/**
 * Scan every resolvable root.
 *
 * Directories are walked breadth-first with hard caps; hitting a cap sets
 * `truncated` and returns what was found rather than failing the whole scan.
 */
export async function scanAll(
  projectRoot: string | null,
  options: ScanOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScanResult> {
  const rules: Rule[] = []
  const diagnostics: Diagnostic[] = []
  let truncated = false
  const seen = new Set<string>()
  const roots = await resolveRoots(projectRoot, env)

  for (const root of roots) {
    // A file root is its own candidate list: there is nothing to walk, and the
    // declared name is the whole filter.
    const found = root.kind === 'file'
      ? { files: [root.path], diagnostics: [] as readonly Diagnostic[], truncated: false }
      : await walk(root, options)
    truncated = truncated || found.truncated
    diagnostics.push(...found.diagnostics)
    for (const file of found.files) {
      const parsed = await parseFile(file, root)
      // Collect diagnostics even for rejected files, so a skip reason reaches
      // the panel instead of vanishing.
      diagnostics.push(...parsed.diagnostics)
      if (parsed.rule === null) continue
      // Dedupe by absolute path, matching Cursor's documented rule identity.
      if (seen.has(parsed.rule.path)) continue
      seen.add(parsed.rule.path)
      rules.push(parsed.rule)
    }
  }
  // Lower rank wins, then name, so the catalog order is stable run to run.
  rules.sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name))
  return { rules, diagnostics, truncated, roots }
}

function rankOf(rule: Rule): number {
  return SOURCES.find((source) => source.key === rule.sourceKey)?.rank ?? 999
}

interface WalkResult {
  readonly files: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
  readonly truncated: boolean
}

async function walk(root: ScanRoot, options: ScanOptions = {}): Promise<WalkResult> {
  const maxDirectories = options.maxDirectories ?? MAX_SCAN_DIRECTORIES
  const maxEntries = options.maxEntries ?? MAX_SCAN_ENTRIES
  // A flat source reads only the root's own entries; every other source keeps
  // the recursive walk. Depth 0 is the root directory itself.
  const maxDepth = root.source.flat === true ? 0 : (options.maxDepth ?? MAX_SCAN_DEPTH)
  const files: string[] = []
  const diagnostics: Diagnostic[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: resolve(root.path), depth: 0 }]
  let directories = 0
  let entries = 0

  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (directories >= maxDirectories || entries >= maxEntries) {
      diagnostics.push({ code: 'scan.truncated', detail: `目录或条目数超过上限，已停止扫描：${root.path}` })
      return { files, diagnostics, truncated: true }
    }
    const current = queue[cursor]
    if (current === undefined) continue
    if (current.depth > maxDepth) continue
    directories++

    let items: Dirent[]
    try {
      items = await fs.readdir(current.path, { withFileTypes: true })
    } catch {
      diagnostics.push({ code: 'scan.unreadable', detail: `无法读取目录：${current.path}` })
      continue
    }
    for (const item of items) {
      // The entry budget is checked per entry, not only between directories: a
      // root whose files all sit in one directory is the shape that reaches the
      // cap first, and that shape never returns to the top of the loop.
      if (entries >= maxEntries) {
        diagnostics.push({ code: 'scan.truncated', detail: `目录或条目数超过上限，已停止扫描：${root.path}` })
        return { files, diagnostics, truncated: true }
      }
      entries++
      if (item.name.startsWith('.')) continue
      const full = join(current.path, item.name)
      if (item.isDirectory()) {
        queue.push({ path: full, depth: current.depth + 1 })
        continue
      }
      if (!item.isFile()) continue
      const dot = item.name.lastIndexOf('.')
      const ext = dot < 0 ? '' : item.name.slice(dot).toLowerCase()
      if (!root.source.extensions.includes(ext)) continue
      // A suffix filter narrows the extension, it never widens it: GitHub
      // Copilot reads `*.instructions.md` and ignores `notes.md` in the very
      // same directory.
      const suffixes = root.source.suffixes
      if (suffixes !== undefined && !suffixes.some((s) => item.name.endsWith(s))) continue
      files.push(full)
    }
  }
  return { files, diagnostics, truncated: false }
}

/** Parse one file, applying the classification gate. */
async function parseFile(
  path: string,
  root: ScanRoot,
): Promise<{ rule: Rule | null; diagnostics: readonly Diagnostic[] }> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch {
    return { rule: null, diagnostics: [{ code: 'read.failed', detail: `无法读取文件：${path}`, path }] }
  }
  const fm = splitFrontmatter(text)
  const strict = root.source.requiresTrigger === true
  // A declared single file is read whole. The source table names that exact
  // file as a rule file, so there is no directory listing left for the
  // "is this a rule?" gate to filter, and the conventions that define one say
  // the same thing: Copilot's `.github/copilot-instructions.md` is plain
  // markdown, Devin's `global_rules.md` is "a single always-on file", and
  // Windsurf's `global_rules.md` / `.windsurfrules` are "always enabled". A
  // plain file therefore derives `always`, exactly as a plain-markdown
  // directory source does.
  const emptyRuleType = root.kind === 'file' ? 'always' : root.source.emptyRuleType
  // The tier is known here, and one convention answers per tier.
  const userRuleType = root.scope === 'user' ? root.source.userRuleType : undefined
  const verdict = classify({ frontmatter: fm, sourceKey: root.source.key, strict, emptyRuleType })
  // Unrecognized frontmatter is skipped, never guessed at (§13.5).
  if (!verdict.isRule) {
    return {
      rule: null,
      // The reason `classify` returned is the only thing that separates "no rule
      // fields at all" from "this source requires a trigger"; without it every
      // skip looked identical on the panel.
      diagnostics: [{
        code: 'classify.skipped',
        detail: `${verdict.reason ?? '不是可识别的规则文件'}：${path}`,
        path,
      }],
    }
  }
  const parsed = parseRule(text, {
    path,
    family: verdict.family,
    sourceKey: root.source.key,
    // The root is where scope is known; carrying it here keeps one definition.
    scope: root.scope,
    strict,
    emptyRuleType,
    userRuleType,
  })
  // The rule keeps its own diagnostics; the walk-level list gets the same
  // entries stamped with the file they came from, because that list is what the
  // cost dialog itemises and a path is the only handle it has on them.
  const diagnostics = parsed.diagnostics.map((d) => (d.path === undefined ? { ...d, path } : d))
  if (!parsed.rule.enabled) {
    // Keep disabled rules in the list so the panel can show and re-enable them.
    return { rule: parsed.rule, diagnostics }
  }
  return { rule: parsed.rule, diagnostics }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Nearest ancestor containing `.git`, else null.
 *
 * Matches the host's own project-root rule and the reference implementation's
 * upward walk, so project-scoped rules resolve identically.
 */
export async function findProjectRoot(start: string): Promise<string | null> {
  let current = resolve(start)
  for (;;) {
    try {
      await fs.stat(join(current, '.git'))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

/** Project-relative posix path, for display. */
export function displayPath(absolute: string, projectRoot: string | null): string {
  if (projectRoot === null) return absolute
  const rel = relative(projectRoot, absolute)
  return rel.startsWith('..') ? absolute : rel.split(sep).join('/')
}
