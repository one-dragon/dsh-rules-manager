/**
 * 交付前终检：工程完整性 + 文档主张可核验
 */
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { SOURCES, agentsHome, clineHome, copilotHome, kiroHome } from '../src/scan.ts'
import { resolveWorkspace } from '../src/workspace.ts'

// Derived, never hard-coded: the check must run in any clone, including CI.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let fails = 0
const check = (label: string, cond: unknown, detail: string | number = ''): void => {
  if (cond) console.log(`  OK   ${label}`)
  else { console.log(`  BAD  ${label}${detail ? '  → ' + detail : ''}`); fails++ }
}

console.log('════ 1. 文件完整性 ════')
const REQUIRED = [
  'package.json', 'cordis.patch.yml', 'tsconfig.json', 'tsdown.config.ts', 'vitest.config.ts',
  '.gitignore', '.editorconfig', '.gitattributes', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'LICENSE',
  'locale/en.json', 'locale/zh.json', 'assets/icon.svg',
  'src/index.ts', 'src/types.ts', 'src/panel.ts', 'src/parse.ts', 'src/token-count.ts', 'src/budget.ts',
  'src/globs.ts', 'src/classify.ts', 'src/scan.ts', 'src/render.ts', 'src/state.ts',
  'src/inject.ts', 'src/attach.ts', 'src/workspace.ts', 'src/rule-layout.ts',
  'src/tool-read-rules.ts', 'src/config.ts', 'src/client/index.tsx', 'src/client/styles.ts', 'src/client/group.ts',
  'tests/parse.spec.ts', 'tests/classify.spec.ts', 'tests/globs.spec.ts', 'tests/budget.spec.ts',
  'tests/token-count.spec.ts', 'tests/render.spec.ts', 'tests/scan.spec.ts', 'tests/inject.spec.ts',
  'tests/tool-read-rules.spec.ts', 'tests/state.spec.ts', 'tests/config.spec.ts', 'tests/scenarios.spec.ts', 'tests/entry.spec.ts', 'tests/styles.spec.ts',
  'tests/agents-standard.spec.ts', 'tests/client.spec.tsx',
  'tests/attach.spec.ts', 'tests/cost.spec.ts', 'tests/panel-ui.spec.tsx', 'tests/rules-sources.spec.ts',
  'tests/selection.spec.ts', 'tests/workspace.spec.ts', 'tests/routes.spec.ts',
  'tests/gaps.spec.ts', 'tests/panel-interactions.spec.tsx',
  'tests/integration/real-project.mts',
  'scripts/panel-shot.mts',
  'docs/testing.md', 'docs/plugin-testing.md', 'docs/DETAIL.md', 'docs/DETAIL.zh.md', 'docs/panel.png', 'docs/panel-dark.png',
  'docs/work/file-scoped-attachment/spec.md', 'docs/work/file-scoped-attachment/issues/01-file-scoped-attachment.md',
  '.github/workflows/ci.yml',
  'tests/e2e/smoke.mts', 'tests/e2e/fixture/.codebuddy/rules/resident.mdc',
  'tests/bench/bench.mts', 'tests/e2e/live-model.mts',
  'tests/snapshot/session.snapshot.mts', 'tests/snapshot/session.snapshot.json',
  'tests/browser/panel.browser.mts', 'tests/browser/harness.html', 'tests/browser/panel.snapshot.html',
  'tests/e2e/fixture/.codebuddy/rules/ondemand.mdc', 'tests/e2e/fixture/src/app.ts',
]
const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(ROOT, f)))
check(`${REQUIRED.length} 个必需文件齐全`, missing.length === 0, missing.join(', '))

console.log('\n════ 2. 构建产物 ════')
// Typed as tuples: the loop body does arithmetic on the size bound, and an
// untyped array literal would widen it to string | number.
const ARTIFACTS: readonly (readonly [string, number])[] = [
  ['lib/index.js', 20000], ['lib/client.js', 3000], ['lib/index.d.ts', 300],
]
for (const [f, min] of ARTIFACTS) {
  const p = path.join(ROOT, f)
  const ok = fs.existsSync(p) && fs.statSync(p).size >= min
  check(`${f} 存在且 ≥${min}B`, ok, fs.existsSync(p) ? fs.statSync(p).size + 'B' : '缺失')
}

console.log('\n════ 3. package.json 契约（对照官方规范）════')
const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
check('dsh.manifestVersion === 1（数字）', pj.dsh?.manifestVersion === 1)
check('dsh.bundle.patch 指向存在的文件', fs.existsSync(path.join(ROOT, pj.dsh.bundle.patch)))
check('dsh.client.platform === "web"', pj.dsh?.client?.platform === 'web')
check('exports 含 "." 且带 types', typeof pj.exports['.'] === 'object' && pj.exports['.'].types)
check('exports 含 ./client', pj.exports['./client'] !== undefined)
check('exports 含 ./package.json（官方要求）', pj.exports['./package.json'] !== undefined)
check('exports 含 ./icon', pj.exports['./icon'] !== undefined)
check('exports 含 locale 通配', Object.keys(pj.exports).some((k) => k.includes('locale')))
check('files 含 lib', pj.files.includes('lib'))
check('files 含 cordis.patch.yml', pj.files.includes('cordis.patch.yml'))
check('icon 字段存在且文件存在', pj.icon && fs.existsSync(path.join(ROOT, pj.icon)))
check('keywords 含 dsh-plugin', pj.keywords.includes('dsh-plugin'))
check('engines.dsh 已声明', typeof pj.engines?.dsh === 'string')
check('scripts 含 test:e2e', typeof pj.scripts?.['test:e2e'] === 'string')
check('scripts 含 test:bench', typeof pj.scripts?.['test:bench'] === 'string')
check('scripts 含 test:e2e:live', typeof pj.scripts?.['test:e2e:live'] === 'string')
check('scripts 含 test:snapshot', typeof pj.scripts?.['test:snapshot'] === 'string')
check('scripts 含 test:browser', typeof pj.scripts?.['test:browser'] === 'string')
check('scripts 含 test:coverage', typeof pj.scripts?.['test:coverage'] === 'string')
check('scripts 含 panel:shot（README 那张图是可复现的产物）', typeof pj.scripts?.['panel:shot'] === 'string')
const liveLane = fs.readFileSync(path.join(ROOT, 'tests/e2e/live-model.mts'), 'utf8')
check('真机层可指向自建网关', /LIVE_BASE_URL/.test(liveLane) && /LIVE_MODEL/.test(liveLane))
check('engines.node 已声明', typeof pj.engines?.node === 'string')
check('picomatch 在 dependencies（不依赖宿主）', pj.dependencies?.picomatch !== undefined)
check('客户端 peer 标 optional', pj.peerDependenciesMeta?.['@deepseek-ai/dsh-client-ui-slots']?.optional === true)
check('scripts 四个齐全', ['build', 'typecheck', 'test', 'check'].every((s) => pj.scripts[s]))
check('license 为 MIT 且 LICENSE 存在', pj.license === 'MIT' && fs.existsSync(path.join(ROOT, 'LICENSE')))
check('author 已声明为可解析的字符串', typeof pj.author === 'string' && pj.author.includes('<') && pj.author.includes('@'))

console.log('\n════ 4. README 主张可核验 ════')
const en = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
const zh = fs.readFileSync(path.join(ROOT, 'README.zh-CN.md'), 'utf8')
check('README 互链双语', en.includes('README.zh-CN.md') && zh.includes('README.md'))
check('README 载明 91% 节省', en.includes('91%') && zh.includes('91%'))
check('README 载明实测数字 9934 / 943', en.includes('9,934') && en.includes('943'))
check('README 列出不读的三个来源', en.includes('codex/rules') && en.includes('cc-safety-net') && en.includes('workbuddy'))
check('README 载明四级键解析', en.includes('case-insensitive') && en.includes('basename'))
check('README 载明只读承诺', en.includes('Read-only') || en.includes('read-only'))
check('README 有 Known limitations 段', en.includes('## Known limitations'))
check('README 说明与 AGENTS.md 的关系', en.includes('dsh-agent-instructions'))
check('README 指向测试深度文档', en.includes('docs/plugin-testing.md') && zh.includes('docs/plugin-testing.md'))
check('README 记录 test:e2e 入口', en.includes('npm run test:e2e') && zh.includes('npm run test:e2e'))
check('README 说明 Windows npm 坑', en.includes('exit 126') || en.includes('npm-cli.js'))
check('README 展示面板截图（与 locale 详情页同图）', en.includes('docs/panel.png') && zh.includes('docs/panel.png'))
// 真截图不是示意图：它得存在、够大（880x1773 的界面在 160 KB 上下），而且得是 PNG——
// 手画的 SVG 能通过存在性检查，通不过魔数。
check('面板截图是真实 PNG 且大小合理', ['docs/panel.png', 'docs/panel-dark.png'].every((f) => {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) return false
  const size = fs.statSync(p).size
  const head = fs.readFileSync(p).subarray(0, 4)
  return size > 20000 && size < 600000 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
}))
check('README 提到 safeSlice 上游错误', en.includes('CodeBuddy') && en.includes('safeSlice'))
check('中文 README 与英文结构对齐', (zh.match(/^## /gm) || []).length === (en.match(/^## /gm) || []).length,
  `en=${(en.match(/^## /gm) || []).length} zh=${(zh.match(/^## /gm) || []).length}`)
// The two testing documents are claims about this repository, so the numbers in
// them are checked here rather than trusted: the layer count, the regression-list
// section, and the spec-file count the unit row quotes.
const deepDoc = fs.readFileSync(path.join(ROOT, 'docs/plugin-testing.md'), 'utf8')
const mapDoc = fs.readFileSync(path.join(ROOT, 'docs/testing.md'), 'utf8')
check('测试深度文档写明官方七层与八行就位表的关系', deepDoc.includes('官方七层') && deepDoc.includes('八行'))
check('测试深度文档含故意注入回归看红的清单', deepDoc.includes('6.3 故意注入回归看红的实测清单'))
/** 读一个文件的非空行；详情页规范要求恰好一行图片。 */
function deepDocLines(rel: string): string[] {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter((l) => l.trim().length > 0)
}
const specCount = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.spec.ts') || f.endsWith('.spec.tsx')).length
check(`测试地图的单元层写当前 spec 文件数（${specCount}）`, mapDoc.includes(`${specCount} 个 \`*.spec.ts\``))
// The official policy puts every keyless layer in CI; a repository that ships such
// layers without a workflow is describing a gate nobody runs.
const ciText = fs.existsSync(path.join(ROOT, '.github/workflows/ci.yml')) ? fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8') : ''
check('CI 工作流跑 npm run check', ciText.includes('npm run check'))
check('CI 工作流跑覆盖率门禁', ciText.includes('npm run test:coverage'))
check('CI 工作流不消费凭据', !/DEEPSEEK_API_KEY|secrets\./.test(ciText))
// A prerelease is only installable by name: the `@0.2` range dropped it, so the
// install step failed with ETARGET before the smoke lane could run (2026-11-27).
check('CI 工作流钉住可解析的预发布 CLI', /@deepseek-ai\/dsh@\d+\.\d+\.\d+-rc\.\d+/.test(ciText))
check('详情页文档各恰好一行图片', ['docs/DETAIL.md', 'docs/DETAIL.zh.md'].every((f) => (deepDocLines(f).filter((l) => l.includes('![')).length) === 1))

console.log('\n════ 5. locale 元数据 ════')
// The key set and the values are checked here as well as in the client tests:
// the host reads these two files before any panel code runs, so a value that is
// empty, that is not a string, or that names a Markdown file which does not
// exist fails at discovery time rather than in a rendering path.
const localeMeta = new Map<string, Record<string, unknown>>()
// Same reason as ARTIFACTS: the path is passed to fs, which needs a string.
const LOCALE_FILES: readonly (readonly [string, string])[] = [
  ['locale/en.json', 'Rules'], ['locale/zh.json', '规则'],
]
for (const [f, title] of LOCALE_FILES) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'))
  localeMeta.set(f, (j.meta ?? {}) as Record<string, unknown>)
  check(`${f} 含 meta.title = ${title}`, j.meta?.title === title)
  check(`${f} 含 meta.description`, typeof j.meta?.description === 'string' && j.meta.description.length > 10)
  // The host only reads title, description and detail; a typo in a fourth key
  // would sit there looking deliberate while never being read.
  const extra = Object.keys(j.meta ?? {}).filter((k) => !['title', 'description', 'detail'].includes(k))
  check(`${f} 的 meta 只用已支持的键`, extra.length === 0, extra.join(', '))
  for (const k of ['title', 'description']) {
    const v = j.meta?.[k]
    check(`${f} 的 meta.${k} 是非空字符串`, typeof v === 'string' && v.trim().length > 0)
  }
  if (typeof j.meta?.detail === 'string') {
    check(`${f} 指向的详情文件存在`, fs.existsSync(path.join(ROOT, j.meta.detail)))
  }
}
const localeKeys = [...localeMeta.entries()].map(([f, m]) => [f, Object.keys(m).sort().join(',')] as const)
check('两份 locale 元数据的键集一致', localeKeys[0]?.[1] === localeKeys[1]?.[1],
  localeKeys.map(([f, k]) => `${f}=${k}`).join(' / '))

console.log('\n════ 6. 只读承诺（代码级）════')
{
  const scan = fs.readFileSync(path.join(ROOT, 'src/scan.ts'), 'utf8')
  check('四个来源全部声明 mutable: false', (scan.match(/mutable: false/g) || []).length >= 4)
  const writes = ['writeFile', 'mkdir', 'rm(', 'unlink', 'rename']
  const scanWrites = writes.filter((w) => scan.includes(w))
  check('scan.ts 无写入调用', scanWrites.length === 0, scanWrites.join(', '))
}

console.log('\n════ 6b. .agents 来源（Antigravity 约定）════')
{
  const scan = fs.readFileSync(path.join(ROOT, 'src/scan.ts'), 'utf8')
  check("scan.ts 声明 .agents/rules 项目级", /projectDir: '\.agents\/rules'/.test(scan))
  // Slice the source entry first: a fixed-length window over the whole file is
  // brittle, because the entry grows whenever a comment is added.
  const at = scan.indexOf("key: 'agents'")
  const agentsEntry = at < 0 ? '' : scan.slice(at, at + 700)
  check('.agents 来源只收 .md', /extensions: \['\.md'\]/.test(agentsEntry), 'entry: ' + agentsEntry.slice(0, 80))
  check('.agents 来源声明 requiresTrigger: true', /requiresTrigger: true/.test(agentsEntry))
  check('.agents 来源声明 flat: true（只扫直接子级）', /flat: true/.test(agentsEntry))
  // Only the Antigravity convention is flat; every other source stays recursive.
  check('只有 .agents 是平坦来源', (scan.match(/flat: true/g) || []).length === 1,
    'flat: true x' + (scan.match(/flat: true/g) || []).length)
  // Behavioral, not textual: a whole-file grep would also match the env var
  // named in agentsHome's own doc comment, so renaming the variable it actually
  // reads would still pass. Calling the function cannot be fooled that way.
  check('agentsHome 优先 DSH_AGENTS_HOME', agentsHome({ DSH_AGENTS_HOME: '/probe/agents' }) === '/probe/agents',
    'got ' + agentsHome({ DSH_AGENTS_HOME: '/probe/agents' }))
  check('agentsHome 忽略空串并回退', agentsHome({ DSH_AGENTS_HOME: '' }) === path.join(homedir(), '.agents'))
  check('agentsHome 未设时回退 ~/.agents', agentsHome({}) === path.join(homedir(), '.agents'))
  // The host peer is not installed in either node_modules tree, so importing it
  // would resolve at run time on some machines and fail on others.
  // The comment may name the package; only an actual import would resolve it.
  check('未 import @deepseek-ai/dsh-home-paths', !/^import[^\n]*dsh-home-paths/m.test(scan))

  const en = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  const zh = fs.readFileSync(path.join(ROOT, 'README.zh-CN.md'), 'utf8')
  check('README 载明 .agents 来源', en.includes('.agents/rules') && zh.includes('.agents/rules'))
  check('README 载明 trigger 语义', en.includes('always_on') && zh.includes('always_on'))
  check('README 载明缺 trigger 丢弃', en.includes('no `trigger` is dropped') && zh.includes('缺 `trigger` 的') && zh.includes('静默丢弃'))
  check('README 载明 DSH_AGENTS_HOME 解析顺序', en.includes('DSH_AGENTS_HOME') && zh.includes('DSH_AGENTS_HOME'))
  check('README 载明只收 .md', en.includes('`.md` only') && zh.includes('只接受 `.md`'))
}

console.log('\n════ 6b-2. 来源表（每条一条官方文档链接 / 多目录档 / 单文件档）════')
{
  const scan = fs.readFileSync(path.join(ROOT, 'src/scan.ts'), 'utf8')
  const types = fs.readFileSync(path.join(ROOT, 'src/types.ts'), 'utf8')
  const classify = fs.readFileSync(path.join(ROOT, 'src/classify.ts'), 'utf8')
  const parse = fs.readFileSync(path.join(ROOT, 'src/parse.ts'), 'utf8')

  // Structural, not textual: the table is imported, so these hold for the real
  // declarations rather than for a comment that happens to spell them out.
  // 22 conventions; CodeBuddy's intranet build is a frontmatter variant of the
  // same directory, so it adds a README row but no source-table entry.
  check('来源表共 22 条约定', SOURCES.length === 22, 'got ' + SOURCES.length)
  const undocumented = SOURCES.filter((s) => !/^https:\/\//.test(s.docs)).map((s) => s.key)
  check('每条来源都带 https 官方文档链接', undocumented.length === 0, undocumented.join(', '))
  const keys = SOURCES.map((s) => s.key)
  for (const key of ['trae-cn', 'qoder-cn', 'lingma', 'aiassistant', 'antigravity', 'kiro', 'augment']) {
    check('来源表含 ' + key, keys.includes(key))
  }
  const ranks = SOURCES.map((s) => s.rank)
  check('来源表 rank 严格递增', ranks.every((rank, i) => i === 0 || rank > (ranks[i - 1] ?? 0)))
  // Cursor only reads .mdc: "Project rules must use the .mdc extension."
  const cursor = SOURCES.find((s) => s.key === 'cursor')
  check('Cursor 只收 .mdc', JSON.stringify(cursor?.extensions) === JSON.stringify(['.mdc']),
    JSON.stringify(cursor?.extensions))
  // Two directories per tier, one switch: the panel keys switches by source, and
  // the upstream pages describe one combined rule set per tier.
  const cline = SOURCES.find((s) => s.key === 'cline')
  check('Cline 声明第二个全局目录', (cline?.userPaths?.length ?? 0) === 1)
  check('Cline 声明第二个项目目录', (cline?.projectDirs?.length ?? 0) === 1)
  // File tiers: the declaration is the filename, so no directory walk can find them.
  for (const key of ['roo', 'devin', 'copilot']) {
    const source = SOURCES.find((s) => s.key === key)
    check(key + ' 声明项目级单文件档', (source?.projectFiles?.length ?? 0) >= 1)
  }
  check('Devin 声明用户级单文件档', (SOURCES.find((s) => s.key === 'devin')?.userFiles?.length ?? 0) === 1)
  check('Copilot 声明用户级目录与单文件档',
    (SOURCES.find((s) => s.key === 'copilot')?.userFiles?.length ?? 0) === 1)

  check('types.ts 声明 userPaths/projectDirs', /readonly userPaths\?:/.test(types) && /readonly projectDirs\?:/.test(types))
  check('types.ts 声明 userFiles/projectFiles', /readonly userFiles\?:/.test(types) && /readonly projectFiles\?:/.test(types))
  check('ScanRoot 带 kind 区分目录与文件', /readonly kind: 'directory' \| 'file'/.test(scan))
  check('resolveRoots 对文件根用 isFile', /await isFile\(path\)/.test(scan))
  check('单文件根不经过 walk', /root\.kind === 'file'/.test(scan))

  // Behavioral: the override has to be read, not merely mentioned in a comment.
  check('copilotHome 优先 COPILOT_HOME', copilotHome({ COPILOT_HOME: '/probe/copilot' }) === '/probe/copilot',
    'got ' + copilotHome({ COPILOT_HOME: '/probe/copilot' }))
  check('copilotHome 未设时回退 ~/.copilot', copilotHome({}) === path.join(homedir(), '.copilot'))

  // Vocabulary: Kiro spells the state in `inclusion`, Augment in `type` values.
  check('classify 认得 Kiro 的 inclusion 字段', /'inclusion'/.test(classify))
  check('classify 认得 Augment 的 always_apply', /'always_apply'/.test(classify) && /'agent_requested'/.test(classify))
  check('parse 读取 inclusion', /values\['inclusion'\]/.test(parse))
  check('parse 映射 Augment 的 type 值', /always_apply/.test(parse) && /agent_requested/.test(parse))
  // Every source the table adds needs a family case, or the badge and the
  // dropdown would quietly fall back to codebuddy.
  for (const key of ['trae-cn', 'qoder-cn', 'lingma', 'aiassistant', 'antigravity', 'kiro', 'augment']) {
    check('classify 有 ' + key + ' 的 family', classify.includes("case '" + key + "'"))
  }
  // Augment reads .mdc beside .md: "Recursively searches .md and .mdc files".
  const augment = SOURCES.find((s) => s.key === 'augment')
  check('Augment 收 .md 与 .mdc', JSON.stringify(augment?.extensions) === JSON.stringify(['.md', '.mdc']),
    JSON.stringify(augment?.extensions))
  // Windsurf's legacy single files and its user-level always-on file travel
  // through the file tier, which only a declared root can reach.
  const windsurf = SOURCES.find((s) => s.key === 'windsurf')
  check('Windsurf 声明两个 legacy 单文件',
    (windsurf?.projectFiles?.length ?? 0) === 2, JSON.stringify(windsurf?.projectFiles))
  check('Windsurf 声明用户级 global_rules.md', (windsurf?.userFiles?.length ?? 0) === 1)
  // Two relocated directories, read at scan time rather than frozen at import.
  check('clineHome 优先 CLINE_DIR', clineHome({ CLINE_DIR: '/probe/cline' }) === '/probe/cline')
  check('clineHome 未设时回退 ~/.cline', clineHome({}) === path.join(homedir(), '.cline'))
  // Kiro relocates its global directory with KIRO_HOME, like COPILOT_HOME above.
  check('kiroHome 优先 KIRO_HOME', kiroHome({ KIRO_HOME: '/probe/kiro' }) === '/probe/kiro')
  check('kiroHome 未设时回退 ~/.kiro', kiroHome({}) === path.join(homedir(), '.kiro'))
  // AGENTS.md / CLAUDE.md / GEMINI.md are loaded by DSH's built-in
  // dsh-agent-instructions, by directory level. Declaring one here would inject
  // the same text a second time, so no tier may name one - not as a directory,
  // not as a declared file. Sources that document such a file beside their rules
  // directory (Junie, Devin, Antigravity, Kiro) declare only the rules tier.
  const declaredPaths = SOURCES.flatMap((s) => {
    const dirs = [s.projectDir, ...(s.projectDirs ?? [])].filter((p): p is string => typeof p === 'string')
    const files = [
      ...(s.userFiles ?? []).map((f) => (typeof f === 'function' ? f({}) : f)),
      ...(s.projectFiles ?? []),
    ]
    return [...dirs, ...files]
  })
  const agentsRungs = declaredPaths.filter((p) => /(^|\/)(AGENTS|CLAUDE|GEMINI)(\.local)?\.md$/i.test(p))
  check('没有来源声明 AGENTS.md 族档位', agentsRungs.length === 0, agentsRungs.join(', '))
  const instructionOwners = SOURCES.filter((s) => typeof s.userPath === 'string'
    && /(^|\/)(AGENTS|CLAUDE|GEMINI)(\.local)?\.md$/i.test(s.userPath)).map((s) => s.key)
  check('没有来源把 AGENTS.md 族当作 userPath', instructionOwners.length === 0, instructionOwners.join(', '))
  // A file with no frontmatter does not mean one thing across conventions, so
  // the table answers it per source rather than with one shared boolean. Every
  // source declares a value, and the three that answer "nothing here is a
  // rule" are the strict ones: Cursor (a bare .mdc is only reachable through
  // @-mention), .agents and Antigravity (both require trigger).
  check('每个来源都声明了无 frontmatter 时的判定',
    SOURCES.every((s) => s.emptyRuleType !== undefined),
    SOURCES.filter((s) => s.emptyRuleType === undefined).map((s) => s.key).join(', '))
  check('空文件丢弃只留给三个严格来源',
    SOURCES.filter((s) => s.emptyRuleType === 'none').map((s) => s.key).join(',') === 'cursor,agents,antigravity',
    SOURCES.filter((s) => s.emptyRuleType === 'none').map((s) => s.key).join(','))
  check('GitHub Copilot 的无 frontmatter 文件不主动进入提示词',
    SOURCES.find((s) => s.key === 'copilot')?.emptyRuleType === 'manual')
  // The boolean it replaced is gone from every layer, not just the type.
  check('frontmatterOptional 已全部换成显式联合',
    /export type EmptyRuleType = 'always' \| 'requested' \| 'manual' \| 'none'/.test(types)
    && /readonly emptyRuleType\?: EmptyRuleType/.test(types)
    && !/frontmatterOptional/.test(types + scan + parse + classify))
  check('文件根一律按 always 读取', /root\.kind === 'file' \? 'always'/.test(scan))
  // Devin and the legacy Windsurf CLI both list "agent" among the trigger
  // values and document no default, so it maps onto the state the model picks.
  check('parse.ts 认识 trigger: agent',
    /agent: 'requested'/.test(parse) && /'agent'/.test(classify))
  // A rule that declares only a path selector attaches to files; it is not
  // left for the model to pick up.
  check('只声明 paths/globs 的规则落 requested', /patterns\.length > 0/.test(parse))
  // Cline documents paths: [] as "the rule never activates"; the panel has to
  // say something rather than show a silent zero.
  check('空列表字段发射 list.empty 诊断',
    /'list\.empty'/.test(parse)
    && /'diag\.list\.empty'/.test(fs.readFileSync(path.join(ROOT, 'src/client/index.tsx'), 'utf8')))
  // A fence with nothing between the markers is still a fence: CodeBuddy's
  // always-applied example carries only a comment there.
  check('空 frontmatter 围栏被识别', /\(\?:\(\[\\s\\S\]\*\?\)\\r\?\\n\)\?---/.test(parse))
  // Content that is nothing but call expressions is a configuration file, not
  // a rule - whatever the source would otherwise admit.
  check('调用表达式内容对任何来源都拒收', /配置语句而不是规则文本/.test(classify))
  // The block list is Cline's documented spelling and its own example annotates
  // every pattern; peeling the quotes first left the comment inside the glob.
  check('块列表项先剥行内注释再脱引号', /unquote\(stripInlineComment\(/.test(parse))
  // Qoder documents `glob` as equivalent to `paths`, Antigravity accepts a
  // singular `glob`, Kiro scopes a fileMatch rule with `fileMatchPattern` alone
  // and JetBrains writes `pattern`: one concept, four spellings.
  check('parse.ts 读单数 glob / pattern / fileMatchPattern',
    /values\['glob'\]/.test(parse) && /values\['pattern'\]/.test(parse) && /values\['fileMatchPattern'\]/.test(parse))
  // Trae documents a rule whose only field is scene: git_message; Continue
  // scopes by file content with regex; Copilot filters with excludeAgent.
  check('parse.ts 保留 scene / excludeAgent / regex',
    /'scene'/.test(parse) && /'excludeAgent'/.test(parse) && /'regex'/.test(parse))
  check('classify 把 scene / excludeAgent / regex 当作规则字段',
    /const RULE_FIELDS = \[[^\]]*'scene'/.test(classify) && /'excludeAgent'/.test(classify) && /'regex'/.test(classify))
  check('regex 作用域落 requested', /regex !== ''/.test(parse))
  // JetBrains' published example file declares `type: always on`; the spacing is
  // theirs, so the value is matched as written instead of being called unknown.
  check('认得 JetBrains 的 type: always on', /'always on'/.test(parse) && /'always on'/.test(classify))
  // The CLI page prints the user tier ("User-Level | ~/.qoder/rules/**/*.md"),
  // the IDE page prints only the project one; declaring it removes a documented
  // tier that a previous revision had left unset.
  check('Qoder 声明官方文档化的用户级目录',
    SOURCES.find((s) => s.key === 'qoder')?.userPath === path.join(homedir(), '.qoder', 'rules'),
    String(SOURCES.find((s) => s.key === 'qoder')?.userPath))
}


console.log('\n════ 6c. 客户端半边必须能被宿主挂载（缺陷 7 的回归）════')
{
  /**
   * Load the real bundle and return its exports.
   *
   * Semantic, not textual: a regex for `exports.apply =` is satisfied by
   * `exports.apply = 0`, which mounts nothing. The bundle is CJS wrapped for
   * DSH's loader, so the loader is stubbed and the factory invoked directly.
   */
  const loadClientBundle = (): Record<string, unknown> => {
    const code = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
    let captured: { factory?: (require: (id: string) => unknown) => unknown } | null = null
    const sandbox = { __ModuleLoader__: { load: (definition: unknown) => { captured = definition as never } } }
    // The bundle only registers its factory at this point.
    new Function('window', code)(sandbox)
    if (captured === null) throw new Error('bundle never called __ModuleLoader__.load')
    const factory = (captured as { factory: (r: (id: string) => unknown) => unknown }).factory
    // React is a host-provided external; the module body only binds it, so a
    // stub that throws when actually rendered is enough to inspect the exports.
    const stub = new Proxy({}, { get: (_t, prop) => (prop === '__esModule' ? true : () => undefined) })
    return factory((id: string) => stub) as Record<string, unknown>
  }

  /** A fake cordis context recording slot registrations. */
  const fakeContext = (registrations: Array<Record<string, unknown>>) => ({
    slots: {
      register: (definition: Record<string, unknown>) => { registrations.push(definition); return () => {} },
      inject: (_name: string, callback: () => void) => { callback() },
    },
    get: () => undefined,
    effect: (callback: () => unknown) => { callback() },
  })

  // The semantic checks below read the SHIPPED bundle, so a bundle older than
  // its sources would validate code that is not the code in `src` — a src edit
  // without a rebuild is itself a delivery defect, and one an all-text guard
  // cannot see.
  // A small tolerance: a fresh `git clone` writes every file within the same
  // instant, so a strict comparison could flag an untouched checkout. A real
  // forgotten rebuild is minutes behind, well past this window.
  const MTIME_TOLERANCE_MS = 2000
  const bundleTime = fs.statSync(path.join(ROOT, 'lib/client.js')).mtimeMs
  const stale = ['src/client/index.tsx', 'src/client/styles.ts', 'src/panel.ts']
    .filter((rel) => fs.statSync(path.join(ROOT, rel)).mtimeMs > bundleTime + MTIME_TOLERANCE_MS)
  check('lib/client.js 不旧于其源文件（需要时先 npm run build）', stale.length === 0, stale.join(', '))

  let exports: Record<string, unknown> | null = null
  try {
    exports = loadClientBundle()
    check('lib/client.js 可被宿主 loader 挂载', true)
  } catch (error) {
    check('lib/client.js 可被宿主 loader 挂载', false, error instanceof Error ? error.message : String(error))
  }

  if (exports !== null) {
    // The loader's own guard: isDynamicCordisPlugin requires typeof apply.
    check('产物 apply 是可调用函数', typeof exports['apply'] === 'function', typeof exports['apply'])
    // Exactly ['slots']: a hard-injected optional service unmounts the plugin.
    const injectValue = exports['inject']
    check("产物 inject 恰为 ['slots']",
      Array.isArray(injectValue) && injectValue.length === 1 && injectValue[0] === 'slots',
      JSON.stringify(injectValue))

    const registrations: Array<Record<string, unknown>> = []
    try {
      const dispose = (exports['apply'] as (ctx: unknown) => unknown)(fakeContext(registrations))
      check('apply 返回 disposer', typeof dispose === 'function')
    } catch (error) {
      check('apply 返回 disposer', false, error instanceof Error ? error.message : String(error))
    }

    const find = (name: string) => registrations.find((r) => r['name'] === name)
    const section = find('settings.section')
    const icon = find('settings.section.icon')
    const side = find('sidebar.panellist')
    const main = find('main')
    check('注册全部四个 slot', registrations.length === 4, 'count=' + registrations.length)
    check('图标 id 与 section id 一致', section?.['id'] !== undefined && icon?.['id'] === section['id'])
    // The load-bearing coupling: a sidebar click passes its id as the panel id
    // (LayoutController.selectPanel -> renderSlot('main', {}, {entryKey})), so a
    // decoupled main key leaves the panel unreachable.
    check('main.key === sidebar.panellist.id',
      main?.['key'] !== undefined && main['key'] === side?.['id'],
      'main.key=' + String(main?.['key']) + ' sidebar.id=' + String(side?.['id']))
    check('main 声明为 keyed（带 key 无 id）', main?.['key'] !== undefined && main?.['id'] === undefined)
  }

  // Text checks follow: they assert wording, not behavior, and are labelled so.
  const src = fs.readFileSync(path.join(ROOT, 'src/client/index.tsx'), 'utf8')
  check('[文本检查] locale 不进 inject（改用 ctx.get 探测）', /ctx\.get\?\.\('locale'\)/.test(src))
  check('[文本检查] locale 走官方 bind 且读 active 快照', /locale\.bind\(NS\)/.test(src) && /getSnapshot\?\.\(\)\?\.active/.test(src))

  // The host half is checked semantically too: it is loaded and driven with a
  // fake ctx, so the assertions are about what it registers, not what it says.
  const hostSrc = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')
  check('[文本检查] 宿主 inject 不含 connection/webServer', !/export const inject = \[[^\]]*(connection|webServer)/.test(hostSrc))
  check('[文本检查] 客户端从路由取数', /fetchRules\(/.test(src))
  check('[文本检查] 取数失败有空状态文案', /loadFailed/.test(src) && /empty:/.test(src))

  // One constant, both halves: a route the host does not register, or a panel
  // fetching a different path, is the exact failure this guards.
  check('两端共用同一路由常量', /export const RULES_ROUTE/.test(fs.readFileSync(path.join(ROOT, 'src/panel.ts'), 'utf8')))
  const routeMatch = /export const RULES_ROUTE = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src/panel.ts'), 'utf8'))
  const routePath = routeMatch?.[1] ?? ''
  // connection.fetch validates with endpointFromPath(API_PATH, path), which
  // rejects any path not beginning '/api/' — a bare path throws at registration.
  check('路由带 /api 前缀（connection.fetch 的硬校验）', routePath.startsWith('/api/'), routePath)
  check('宿主产物含该路由串', fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8').includes(routePath))
  check('客户端产物含该路由串', fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8').includes(routePath))
  check('[文本检查] 宿主用 connection.fetch 注册（非裸 webServer）', /connection[\s\S]{0,200}?fetch[\s\S]{0,200}?register/.test(hostSrc) && !/\.webServer\.register\(/.test(hostSrc))
  // The measured 404: a one-shot read registers nothing when Connection mounts
  // later, so late binding is a correctness requirement, not a style choice.
  check('[文本检查] 宿主用 ctx.inject 晚绑定（非一次性 ctx.get）', /ctx\.inject\(\['connection'\]/.test(hostSrc))
}

console.log('\n════ 6d. 面板数据层契约（task-11 的回归）════')
{
  const panel = fs.readFileSync(path.join(ROOT, 'src/panel.ts'), 'utf8')
  // The panel groups by source and scope, so these fields are data, not style.
  for (const field of ['sourceKey', 'sourceLabel', 'scope', 'family', 'patterns', 'attached', 'diagnostics', 'active', 'disabledBy']) {
    check('RuleRow 含 ' + field, new RegExp('readonly ' + field + ':').test(panel))
  }
  check('RuleSourceRow 含 activeRuleCount', /readonly activeRuleCount: number/.test(panel))
  check('RulesPayload 含 sources 段', /readonly sources: readonly RuleSourceRow\[\]/.test(panel))
  // The entry location is published with every answer and validated on the way
  // in, because a value no branch matches used to hide the panel entirely.
  check('RulesPayload 含 entryLocation', /readonly entryLocation: RulesEntryLocation/.test(panel))
  check('规则入口位置取值有白名单校验', /function isRulesEntryLocation/.test(panel))
  check('宿主注册了入口路由', /path: ENTRY_ROUTE/.test(fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')))
  // The client half is text-checked too: the location only matters if the panel
  // both reads the route and acts on the answer.
  const clientSrc = fs.readFileSync(path.join(ROOT, 'src/client/index.tsx'), 'utf8')
  check('[文本检查] 客户端按入口位置取舍插槽', /ENTRY_HIDES\[location\]/.test(clientSrc))
  check('[文本检查] 客户端读取入口路由', /resolveUrl\(ENTRY_ROUTE\)/.test(clientSrc))
  check('[文本检查] 客户端三态控件按 aria-pressed 表达选中', /aria-pressed=\{entryLocation === value\}/.test(clientSrc))
  // The 2026-11-27 redesign: three bare words in a tray were the whole control,
  // so nothing on screen said what they decided and the segments had no shape.
  check('[文本检查] 入口控件在屏幕上写出组名', /dshrm-entry-l" aria-hidden="true"/.test(clientSrc))
  check('[文本检查] 每个入口位置各有一个图形', /function EntryGlyph/.test(clientSrc) && /<EntryGlyph location=\{value\} \/>/.test(clientSrc))
  {
    const entryCss = fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8')
    check('[文本检查] 入口控件的组名与图标有样式',
      ['dshrm-entry-l', 'dshrm-entry-seg', 'dshrm-entry-ico'].every((cls) => entryCss.includes('.' + cls)))
    // In DSH the brand colour is the foreground colour, so a branded selected
    // word carries no weight: selection has to be fill, weight and an edge.
    check('[文本检查] 入口选中态不靠品牌色',
      /\.dshrm-entry-btn\.on\{[^}]*label-primary/.test(entryCss) && !/\.dshrm-entry-btn\.on\{[^}]*brand-primary/.test(entryCss))
  }
  check('RulesPayload 含 scannedAt', /readonly scannedAt: number/.test(panel))
  // stateDir must stay unpinned by default, or the env override can never work.
  const cfg = fs.readFileSync(path.join(ROOT, 'src/config.ts'), 'utf8')
  check('[文本检查] stateDir 默认留空（不钉死目录）', /stateDir: z\.string\(\)\.default\(''\)/.test(cfg))
  // Measured before the bounds: `perRuleMax: -1` was accepted and truncated
  // every rule at `-1 chars`, `NaN` skipped truncation entirely, and
  // `maxScanDepth: -3` returned zero rules with no diagnostic at all. Every
  // numeric pin is therefore bounded, and a bare `.default(` - which is what
  // an unbounded field looks like - must not come back.
  check('[文本检查] Config 数值一律有界且为整数',
    /\.step\(1\)\.min\(100\)\.max\(2_000_000\)\.default\(PER_RULE_MAX\)/.test(cfg)
    && /maxScanDepth: z\.number\(\)\.step\(1\)\.min\(0\)\.max\(100\)/.test(cfg)
    && !/z\.number\(\)\.default\(/.test(cfg))
  check('[文本检查] 写盘失败回答 500 并带上原因',
    /catch \(cause\)[\s\S]{0,240}?ok: false, error: message \}, 500/.test(
      fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')))
  check('RuleSourceRow 带真实绝对路径字段', /readonly path: string/.test(panel))
  // Optional because half the diagnostics are about a file or a directory rather
  // than a line; the panel shows it only when the scanner actually knew one.
  check('RuleDiagnosticRow 带可选行号', /readonly line\?: number/.test(panel))

  const host = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')
  check('[文本检查] 宿主只在有行号时传递行号', /d\.line === undefined/.test(host))
  // A rule switched off must stay listed, so the panel can re-enable it — while
  // the prompt block keeps only rules that are in effect.
  check('[文本检查] 停用规则仍发布（allRules 而非过滤后）', /entry\.allRules\.map/.test(host))
  check('[文本检查] 注入仍只含生效规则', /result\.rules\.filter/.test(host))
  check('[文本检查] 路由声明 GET 与 POST', /methods: \['GET', 'POST'\]/.test(host))
  check('[文本检查] 写操作走 state.json', /writeState\(/.test(host))
  // The read-only promise: no external rule file may ever be written.
  check('[文本检查] 宿主不写外部规则文件', !/rules\/[^\n]*writeFile|writeFile\([^)]*rules/.test(host))
  check('[文本检查] scope 取自扫描根而非路径比对', /scope: root\.scope/.test(fs.readFileSync(path.join(ROOT, 'src/scan.ts'), 'utf8')))
  check('[文本检查] 读时按最新 state 过滤（写入即时可见）', /entry\.allRules[\s\S]{0,200}?isSourceEnabled/.test(host))
  // sources must come from resolveRoots, not from re-joined paths.
  check('[文本检查] sources 复用扫描得到的 roots', /result\.roots\.map/.test(host))
  // One layout module owns the shared text: the catalog line and the requestable
  // section are generated by three code paths (the injected block, the host cost
  // model, the browser's own estimate), and a private copy in any of them drifts
  // silently while every test stays green.
  const layout = fs.readFileSync(path.join(ROOT, 'src/rule-layout.ts'), 'utf8')
  const renderSrc = fs.readFileSync(path.join(ROOT, 'src/render.ts'), 'utf8')
  const costSrc = fs.readFileSync(path.join(ROOT, 'src/cost.ts'), 'utf8')
  const panelGroup = fs.readFileSync(path.join(ROOT, 'src/client/group.ts'), 'utf8')
  check('[文本检查] 目录行文本只有一处实现',
    /export function catalogLine/.test(layout)
    && !/escapeXml\(rule\.path\)/.test(renderSrc)
    && !/escapeXml\(rule\.path\)/.test(costSrc)
    && !/escapeXml\(rule\.path\)/.test(panelGroup))
  check('[文本检查] 可请求段模板只有一处实现',
    /export function requestableSection/.test(layout)
    && !/These are \$\{scopeLabel\} rules/.test(renderSrc)
    && !/These are \$\{scopeLabel\} rules/.test(costSrc))
  check('[文本检查] 截断注记只有一处实现',
    /export function truncationMarker/.test(layout)
    && !/rule truncated at \$\{/.test(renderSrc)
    && !/rule truncated at \$\{/.test(fs.readFileSync(path.join(ROOT, 'src/budget.ts'), 'utf8')))
  // Both truncation sites must cut through the surrogate guard. A plain `slice`
  // at either one can end the kept text mid-pair, which renders as a replacement
  // character in the prompt; the tests sweep every cut position.
  const budgetSrc = fs.readFileSync(path.join(ROOT, 'src/budget.ts'), 'utf8')
  check('[文本检查] 两处截断都走 safeSlice',
    /export function safeSlice/.test(budgetSrc)
    && /content = safeSlice\(content, perItem\)/.test(budgetSrc)
    && /safeSlice\(block, left\)/.test(budgetSrc)
    && !/content\.slice\(0, perItem\)/.test(budgetSrc)
    && !/block\.slice\(0, left\)/.test(budgetSrc))
  // The scan pipeline was assembled twice, once per caller, and the two copies
  // differed only in variable names.
  check('[文本检查] 扫描结果只在一处组装成条目',
    (host.match(/const rules = result\.rules\.filter/g) ?? []).length === 1
    && (host.match(/const index: Record<string/g) ?? []).length === 1)
  // A touch list is bound to the directory it was collected under, so a session
  // that moves to another tree must start over rather than keep the old rules
  // resident against a workspace it has left.
  check('[文本检查] 会话换目录时清空触碰表',
    /resetTouchesIfMoved/.test(host)
    && /sessionDir\.has\(agent\)/.test(host)
    && (host.match(/resetTouchesIfMoved\(agent, cwd\)/g) ?? []).length >= 2)
}

console.log('\n════ 6e. 面板界面（task-12 的回归）════')
{
  const group = fs.readFileSync(path.join(ROOT, 'src/client/group.ts'), 'utf8')
  // The four buckets and the cost model are the panel's substance.
  for (const fn of ['statusOf', 'ruleCost', 'totalResidentTokens', 'filterRules', 'applyTabs',
    'statusCounts', 'groupBySource', 'sortByCost', 'disabledReasonKey', 'noteKeyOf', 'optimistic']) {
    check('group.ts 导出 ' + fn, new RegExp('export function ' + fn + '\\(').test(group))
  }
  const client = fs.readFileSync(path.join(ROOT, 'src/client/index.tsx'), 'utf8')
  // Every requirement the user named must be wired, not just available.
  check('[文本检查] 注册作用域页签', /scopeTabs/.test(client) && /setScope/.test(client))
  check('[文本检查] 注册状态页签（含已停用）', /statusTabs/.test(client) && /'tab\.off'/.test(client))
  check('[文本检查] 来源分组渲染真实路径', /group\.path/.test(client) && /dshrm-group-path/.test(client))
  check('[文本检查] 按开销排序后分组', /groupBySource\(sortByCost\(/.test(client))
  check('[文本检查] 行级开关调用 setRule', /action: 'setRule'/.test(client))
  check('[文本检查] 来源级开关调用 setSource', /action: 'setSource'/.test(client))
  check('[文本检查] 写入失败回滚到已确认载荷', /setPayload\(before\)/.test(client))
  // Precise: the *rendered* list must come from every grouped rule, and the
  // bucket comes from statusOf (which maps an inactive rule to 'off'). A
  // `filter(...active)` elsewhere is fine — the stat bar counts with one.
  check('[文本检查] 停用行仍渲染（渲染的是全部 group.rules）', /group\.rules\.map\(/.test(client) && /statusOf\(rule\)/.test(client))
  // The redesigned chrome must exist: stat bar, tabs, source cards, switches.
  for (const cls of ['dshrm-stats', 'dshrm-stat-n', 'dshrm-tabs', 'dshrm-select', 'dshrm-group-path', 'dshrm-badge', 'dshrm-track']) {
    check('[文本检查] 样式含 ' + cls, fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8').includes('.' + cls))
  }
  // The brand-mark rules are order- and default-sensitive. `has-brand` and the
  // `.s-*` plates are both two-class selectors, so the artwork only gets the
  // transparent plate when it comes second; and the monochrome glyphs carry no
  // fill of their own, so without a currentColor default they render black on a
  // dark surface (measured 1.34 contrast against the dark panel).
  {
    const css = fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8')
    const plates = css.indexOf('.dshrm-badge.s-codebuddy')
    const brand = css.indexOf('.dshrm-badge.has-brand')
    check('[文本检查] has-brand 排在 .s-* 底板之后（否则底板不被覆盖）',
      plates !== -1 && brand !== -1 && plates < brand)
    check('[文本检查] 品牌标默认用 currentColor 着色',
      /\.dshrm-brand\{[^}]*fill:currentColor/.test(css))
    // A source with no artwork and no chip decision would ship as a silent
    // blank, and the icon table cannot notice a key no source ever renders.
    // These two lists have to agree with the table in both directions.
    const icons = fs.readFileSync(path.join(ROOT, 'src/client/brand-icons.ts'), 'utf8')
    const typesText = fs.readFileSync(path.join(ROOT, 'src/types.ts'), 'utf8')
    const unionStart = typesText.indexOf('export type RuleFamily =')
    const union = typesText.slice(unionStart, typesText.indexOf('/**', unionStart))
    // An icon key the classifier can never produce ships to every client and
    // draws nothing; the union is the set of families a card can actually carry.
    const iconKeys = [...icons.matchAll(/^  '([a-z-]+)': \{/gm)].map((m) => m[1])
    // The badge paints every glyph with fill: currentColor, so a shape that carries
    // a stroke and no fill of its own is painted solid and covers what is under it.
    // That shipped three times (Qoder's ring, Qoder CN's copy, Cursor's plate ring),
    // so the two shapes that legitimately carry both attributes are pinned by name.
    const stroked = [...icons.matchAll(/<(?:path|circle|rect|polygon|ellipse|line)\b[^>]*stroke=[^>]*>/g)]
      .map((m) => m[0])
    check('[文本检查] 描边形状自己声明 fill（否则会被填实）',
      stroked.length > 0 && stroked.every((s) => /fill=/.test(s)))
    check('[文本检查] Qoder 与 Cursor 的描边形状保留 fill="none"',
      /fill="none" stroke="currentColor" stroke-/.test(icons)
      && /fill="none" stroke="#edecec"/.test(icons))
    check('[文本检查] Trae CN 有自己的一条标',
      /^  'trae-cn': \{$/m.test(icons))
    check('[文本检查] 每个图标键都是分类器能产出的 family（没有死键）',
      iconKeys.length > 0 && iconKeys.every((k) => union.includes("'" + k + "'")))
  }
  // The explanation table from design §12.6 must exist in both languages, so
  // each key is counted rather than merely found: en.json and zh.json are two
  // tables in one file, and a key that only ever landed in English would still
  // pass a plain substring test.
  for (const key of ['note.always', 'note.requested', 'note.manual', 'note.off', 'note.attached',
    'offReason.frontmatter', 'offReason.state', 'offReason.source', 'tokenNote']) {
    const entries = client.split("'" + key + "':").length - 1
    check('文案含 ' + key + '（中英各一）', entries >= 2)
  }
  // The diagnostics view has exactly one source of truth. A second boolean
  // drifted out of step with the dropdown, and once the filtered list was empty
  // the two controls that could undo it disappeared, leaving no way back. Both
  // controls must therefore also be rendered while the view is on.
  check('[文本检查] 诊断筛选只有 sourceFilter 一个真相来源',
    /const diagOnly = sourceFilter === 'diag'/.test(client) && !/setDiagOnly/.test(client))
  check('[文本检查] 诊断视图开启时两个出口都保留',
    /diagnostics > 0 \|\| diagOnly/.test(client))
  // Read-only promise still holds: the panel's writes go through the state file.
  check('[文本检查] 面板不写外部规则文件', !/writeFile|unlink/.test(client))
  // The seven fixes from the 2026-11-24 review, guarded so they cannot silently
  // regress: each one is a behavior the user reported by hand.
  check('[文本检查] 两组页签有屏幕可见的名字', /dshrm-tabgroup/.test(client) && /aria-hidden/.test(client))
  check('[文本检查] 全局页签不渲染工作区下拉', /scope !== 'user'/.test(client))
  check('[文本检查] 刷新按钮有进行中状态', /refreshing/.test(client) && /withRefresh/.test(client))
  check('[文本检查] 诊断行渲染行号与字段名', /dshrm-diag-line/.test(client) && /diagLine/.test(client))
  check('[文本检查] 未知诊断码退化为裸码', /function diagHelp/.test(client))
  for (const cls of ['dshrm-tabgroup', 'dshrm-stat-btn', 'dshrm-diag-line', 'dshrm-diag-help',
    'dshrm-link', 'dshrm-modal', 'dshrm-modal-card', 'dshrm-cost-table', 'dshrm-cost-hint',
    'dshrm-type.is-attached']) {
    check('[文本检查] 样式含 ' + cls, fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8').includes('.' + cls))
  }
  // The second review round (2026-11-24): the diagnostics cell stopped looking
  // like a widget of its own, "All" left the scope tabs, the Refresh button
  // finally sent a forced read, and the resident total grew a receipt.
  {
    const css = fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8')
    check('[文本检查] 诊断格不自带内边距（否则比其它三格矮一截）',
      /\.dshrm-stat-btn\{[^}]*padding:0/.test(css))
    check('[文本检查] 诊断格不再有 hover 底板与点状下划线',
      !/\.dshrm-stat-btn:hover/.test(css) && !/underline dotted/.test(css))
  }
  check('[文本检查] 作用域页签不再有「全部」', !/\['all', t\('scope\.all'\)\]/.test(client))
  check('[文本检查] 面板默认落在项目作用域', /useState<ScopeTab>\('project'\)/.test(client))
  // The defect: the tick was bumped before the state ever changed, so the effect
  // could never see a difference, never sent ?refresh=1, and every click blanked
  // the panel into the loading state instead.
  check('[文本检查] 强制读取由已服务的 tick 判定',
    /const \[refreshTick, setRefreshTick\] = useState\(0\)/.test(client)
    && /isForcedRead\(tick, servedRefresh\.current\)/.test(client)
    && /export function isForcedRead/.test(client)
    && !/refreshNonce/.test(client))
  check('[文本检查] 成本明细入口与对话框', /TokenBreakdown/.test(client) && /className="dshrm-link"/.test(client) && /dshrm-modal/.test(client))
  check('[文本检查] 明细区分常驻与按需并给出解释', /costResident/.test(client) && /costOnDemand/.test(client) && /costHint/.test(client))
  // The second audit round (2026-11-24). Each of these is a defect the panel
  // could not show and the tests could not see, so they are pinned here.
  {
    const panel = fs.readFileSync(path.join(ROOT, 'src/panel.ts'), 'utf8')
    const host = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')
    const group = fs.readFileSync(path.join(ROOT, 'src/client/group.ts'), 'utf8')
    const parse = fs.readFileSync(path.join(ROOT, 'src/parse.ts'), 'utf8')
    const scan = fs.readFileSync(path.join(ROOT, 'src/scan.ts'), 'utf8')
    const types = fs.readFileSync(path.join(ROOT, 'src/types.ts'), 'utf8')
    const render = fs.readFileSync(path.join(ROOT, 'src/render.ts'), 'utf8')
    const tokens = fs.readFileSync(path.join(ROOT, 'src/token-count.ts'), 'utf8')
    // F1: the walk's own diagnostics are not about any single rule, so they
    // needed their own channel to the panel; without it a truncated scan was
    // rendered as a complete one.
    check('[文本检查] 载荷携带扫描级诊断与截断标志',
      /readonly diagnostics\?: readonly RuleDiagnosticRow\[\]/.test(panel) && /readonly truncated\?: boolean/.test(panel))
    check('[文本检查] 宿主把扫描诊断送上面板',
      /toPanelDiagnostics\(/.test(host) && /toPanelDiagnostics\(\[\.\.\.entry\.diagnostics/.test(host))
    check('[文本检查] 面板显示扫描提示', /dshrm-scan-note/.test(client) && /scanDiagnostics/.test(client))
    // F2/F3: the panel's cost model has to mirror render.ts, not describe it.
    check('[文本检查] 面板成本模型来自宿主同一套数学',
      /costOfRules\(/.test(group) && /export function costReport\(/.test(group))
    check('[文本检查] 常驻成本含按需清单的固定脚手架',
      /report\.catalog/.test(client) && /'costCatalog'/.test(client))
    // F5: the workspace of a write is read from that write's own request.
    check('[文本检查] 写路径不再读模块级请求槽', !/latestRequest/.test(host))
    // F6: a POST that named a workspace never gets answered by the default one.
    check('[文本检查] 写入后的快照回落到本次请求的工作区', /chosen \?\? requested/.test(host))
    // F7: reopening a source must not clear a rule that is off by itself.
    check('[文本检查] 乐观重开来源保留规则自身的停用态',
      /rule\.disabledBy === 'state'/.test(group) && !/rule\.enabled \? null : 'frontmatter'\s*$/.test(group))
    // F8: rule text reaches the prompt, so it is escaped and length-capped.
    check('[文本检查] 注入 prompt 的描述被转义并限长',
      /export function escapeXml/.test(tokens)
      && /escapeXml\(truncateForCatalog/.test(fs.readFileSync(path.join(ROOT, 'src/rule-layout.ts'), 'utf8')))
    // F9: every diagnostic that knows its key reports the file's own line.
    check('[文本检查] 诊断行号是文件自身的行号',
      /index \+ 2/.test(parse) && /report\('trigger'/.test(parse) && /report\('type'/.test(parse))
    // F10: a skipped file says why it was skipped.
    check('[文本检查] 跳过的文件带上原因', /verdict\.reason/.test(scan))
    // F11: the two switches carry a per-row accessible name and a switch role.
    check('[文本检查] 行级开关有可访问名与 switch 角色',
      /role="switch"/.test(client) && /switchSource/.test(client) && /switchRule/.test(client))
    // F12: an empty tier is not the same as a search that found nothing.
    check('[文本检查] 本档位为空有独立文案', /tierEmpty/.test(client) && /inQuery/.test(client))
    // F15: the Chinese wording stopped calling the same state four things.
    check('[文本检查] 中文停用态措辞统一', !/手动触发|诊断异常|未生效|未启用/.test(client))
    // F16: a finding that belongs to no rule still has to name the file it came
    // from. The count alone was rendered as explanations joined by semicolons,
    // so the one thing the reader needs — which file, which field — was gone.
    check('[文本检查] 扫描级诊断逐条渲染到面板与成本弹窗',
      /ScanDiagnosticRow/.test(client)
      && /dshrm-scan-diag/.test(client)
      && /dshrm-diag-path/.test(client)
      && (client.match(/<ScanDiagnosticRow/g) ?? []).length === 2)
    check('[文本检查] 诊断行带上文件路径',
      /readonly path\?: string/.test(types) && /d\.path === undefined \? \{ \.\.\.d, path \}/.test(scan))
    check('[文本检查] 细节里已有的路径不重复打印',
      /!row\.detail\.includes\(row\.path\)/.test(client))
    // F17: the link opens the dialog that explains the on-demand state, so it
    // reads in that state's colour rather than the generic brand token.
    check('[文本检查] 详情入口用按需态的颜色',
      /\.dshrm-link\{[^}]*state-business-primary/.test(
        fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8')))
    // F19: one convention answers per tier (Augment forces its user rules to
    // always-on), so the tier has to reach the derivation, and the override has
    // to be visible rather than silently contradicting the file.
    check('[文本检查] 用户级档位可以有自己的状态答案',
      /readonly userRuleType\?: EmptyRuleType/.test(types)
      && /input\.scope === 'user' \? input\.userRuleType/.test(parse)
      && /userRuleType: 'always'/.test(scan))
    check('[文本检查] 档位覆盖 frontmatter 时给出诊断',
      /type\.tierOverridden/.test(parse) && /diag\.type\.tierOverridden/.test(client))
    // F18: the entry cap has to stop a flat directory too. The walk tested it
    // only between directories, so a root whose whole listing lived in one
    // directory was enumerated in full while `truncated` stayed false.
    check('[文本检查] 条目上限在文件层检查，单目录也会截断',
      /if \(entries >= maxEntries\) \{[\s\S]{0,240}?scan\.truncated/.test(scan))
    // Two short scope segments had no edge between them and read as a single
    // control; the divider belongs to that strip alone, never to the 5-tab
    // status strip, which wraps on narrow panels.
    const styles = fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8')
    check('[文本检查] 范围页签之间有分隔线',
      /dshrm-tabs-seg/.test(client)
      && /\.dshrm-tabs-seg \.dshrm-tab\+\.dshrm-tab\{border-left:1px solid/.test(styles)
      && /\.dshrm-tabs\.dshrm-tabs-seg\{flex-wrap:nowrap\}/.test(styles))
  }
  for (const cls of ['dshrm-scan-note', 'dshrm-scan-diag', 'dshrm-diag-path', 'dshrm-cost-note', 'dshrm-cost-fixed']) {
    check('[文本检查] 样式含 ' + cls, fs.readFileSync(path.join(ROOT, 'src/client/styles.ts'), 'utf8').includes('.' + cls))
  }
  // File-scoped attachment reads its semantics from the vendors, so the
  // evidence has to stay next to the code that implements it: an edit that
  // drops the URLs, the patch shape or a diagnostic translation is caught here.
  {
    const attach = fs.readFileSync(path.join(ROOT, 'src/attach.ts'), 'utf8')
    const hostSrc = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')
    check('[文本检查] 自动附着的官方依据写在源码里',
      attach.includes('docs.claude.com/en/docs/claude-code/memory')
      && attach.includes('cursor.com/docs/rules')
      && attach.includes('kiro.dev/docs/steering')
      && attach.includes('antigravity.google/docs/rules')
      && /\*\*\* (Add File|Update File|Delete File|Move to): /.test(attach))
    for (const code of ['attach.limit', 'attach.pattern', 'attach.slow']) {
      check('[文本检查] 附着诊断 ' + code + ' 有词典词条',
        client.split("'diag." + code + "':").length - 1 >= 2)
    }
    check('[文本检查] 附着状态由 tools/result 观测且只认成功结果',
      /scoped\.on\('tools\/result'/.test(hostSrc) && /result\.isError === true/.test(hostSrc))
    // Both call the one shared predicate rather than testing the path themselves.
    check('[文本检查] 附着在渲染与成本里都被当作常驻',
      /attachedNow\(rule\.type/.test(fs.readFileSync(path.join(ROOT, 'src/render.ts'), 'utf8'))
      && /attachedNow\(rule\.type/.test(fs.readFileSync(path.join(ROOT, 'src/cost.ts'), 'utf8')))
  }
}

console.log('\n════ 6f. 面板不依赖 pre-step（本轮真机 bug 的回归）════')
{
  const host = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')
  const ws = fs.readFileSync(path.join(ROOT, 'src/workspace.ts'), 'utf8')
  // The defect: the panel only ever saw what agent/pre-step had scanned, so a
  // freshly booted host served an empty panel. The route must be able to scan
  // on its own.
  check('[文本检查] 面板读取可触发按需扫描', /currentEntry/.test(host) && /scanOutsideAgent/.test(host))
  // The structural fact: after the lastScan fast path, the workspace is
  // resolved from the optional services and scanned here.
  check('[文本检查] lastScan 为空时解析工作区并扫描', /const recent = lastScan[\s\S]{0,900}?resolveWorkspace\([\s\S]{0,600}?scanOutsideAgent\(/.test(host))
  check('[文本检查] 按需结果有缓存与 TTL', /ON_DEMAND_TTL_MS/.test(host))
  check('[文本检查] 写操作同时清按需缓存', /onDemandScan = null/.test(host))
  // The refresh escape: an explicit ?refresh=1 must skip both cache slots, or the
  // button keeps returning the same bytes and looks broken.
  check('[文本检查] 显式刷新跳过两个缓存槽',
    /parseRefresh/.test(host) && /refresh \? null : cachedScanFor/.test(host) && /!refresh && recent !== null/.test(host))
  // Optional services must stay out of inject, or a host without them would
  // unload the plugin entirely.
  check('[文本检查] inject 仍只有硬依赖', /export const inject = \['tools', 'workingDirectory'\]/.test(host))
  check('[文本检查] 两个可选服务都用 ctx.get 探测', /ctx\.get\?\.\('workspaceRegistry'\)/.test(host) && /ctx\.get\?\.\('sessions'\)/.test(host))
  for (const fn of ['workspacePaths', 'sessionCwds', 'resolveWorkspace']) {
    check('workspace.ts 导出 ' + fn, new RegExp('export function ' + fn + '\\(').test(ws))
  }
  // Behavioral, not textual: a regex for `values[0]` still matches a version
  // that only accepts a single workspace, so it cannot catch that regression.
  // Calling the resolver can.
  const many = resolveWorkspace({ registry: { list: () => [{ path: 'D:/first' }, { path: 'D:/second' }] } })
  check('多工作区取第一个而非返空', many.path === 'D:/first', 'got ' + String(many.path))
  const none = resolveWorkspace({})
  check('无工作区时不抛且报 none', none.path === null && none.source === 'none')
  const viaRegistry = resolveWorkspace({ registry: { list: () => [{ path: 'D:/boot' }] } })
  check('无 lastScan 时仍能解析工作区（本 bug 的回归）', viaRegistry.path === 'D:/boot' && viaRegistry.source === 'workspace-registry')
  check('workspaceRegistry 抛错不致命', resolveWorkspace({ registry: { list: () => { throw new Error('x') } } }).source === 'none')
  const panel = fs.readFileSync(path.join(ROOT, 'src/panel.ts'), 'utf8')
  check('RulesPayload 带 workspace 来源', /readonly workspace: RuleWorkspaceInfo/.test(panel))
  check('空态区分「没有规则」与「未定工作区」', fs.readFileSync(path.join(ROOT, 'src/client/index.tsx'), 'utf8').includes('noWorkspace'))
  // Switching workspaces from the panel: the route takes ?workspace=, honors it
  // only for a directory this host offered, and answers with the full candidate
  // list the switch renders from.
  check('[文本检查] 面板可切换工作区：查询参数解析', /parseWorkspaceQuery/.test(host) && /searchParams/.test(host))
  check('[文本检查] 切换只接受已提供的候选目录', /candidates\.includes\(requested\)/.test(host))
  check('[文本检查] payload 回传候选列表', /options: candidates/.test(host))
}

console.log('\n════ 7. 无遗留占位/调试 ════')
{
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (/node_modules|lib|\.git/.test(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx|json|md)$/.test(e.name)) files.push(p)
    }
  }
  walk(ROOT)
  const bad: string[] = []
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8')
    // Only flag real leftovers. `placeholder` is a legitimate JSX/HTML attribute,
    // so it is matched only inside a comment.
    if (/TODO|FIXME|XXX|console\.log\(|待补/.test(t)) bad.push(path.relative(ROOT, f))
    else if (/(?:\/\/|\/\*|<!--)[^\n]*placeholder/i.test(t)) bad.push(path.relative(ROOT, f))
  }
  check('无 TODO/FIXME/console.log', bad.length === 0, bad.join(', '))
}

console.log('\n════ 8. 类型逃逸（缺陷 5 的回归：MessageSourceMap 用 merge 而非 as any）════')
{
  let escapes = 0
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (/node_modules|lib|\.git|tests|scripts/.test(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p)
    }
  }
  walk(path.join(ROOT, 'src'))
  const found: string[] = []
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8')
    if (/\bas\s+(never|any)\b/.test(t)) found.push(path.relative(ROOT, f))
    escapes++
  }
  check('src 无 as never / as any', found.length === 0, found.join(', '))
}

console.log('\n════ 9. 声明的配置字段必须真被引用（缺陷 4 的回归：apply 没接 config）════')
{
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  void pj
  const configSrc = fs.readFileSync(path.join(ROOT, 'src/config.ts'), 'utf8')
  const fields = [...configSrc.matchAll(/^\s{2}(\w+):\s*(?:string|number|boolean)$/gm)].map((m) => m[1]!)
  const srcFiles: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name) && e.name !== 'config.ts') srcFiles.push(p)
    }
  }
  walk(path.join(ROOT, 'src'))
  const bodies = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  const unwired = fields.filter((f) => !new RegExp(`config\\.${f}\\b`).test(bodies))
  check(`${fields.length} 个配置字段都已接线`, unwired.length === 0, unwired.join(', '))
}

console.log('\n════ 10. 分层丢弃必须留下证据（缺陷 3 的回归：整层被丢弃时静默消失）════')
{
  const render = fs.readFileSync(path.join(ROOT, 'src/render.ts'), 'utf8')
  check('分区渲染条件含 omitted.length', /kept\.length > 0 \|\| \w+Budget\.omitted\.length > 0/.test(render))
}

console.log('\n════ 10b. 注入位置必须对齐官方（缺陷 6 的回归）════')
{
  const inject = fs.readFileSync(path.join(ROOT, 'src/inject.ts'), 'utf8')
  const entry = fs.readFileSync(path.join(ROOT, 'src/index.ts'), 'utf8')
  // Comments are stripped first: index.ts legitimately mentions the old
  // `process.cwd()` call when explaining the defect. A regex over the raw text
  // would be satisfied by that comment, so `export const P = process.cwd()`
  // slipped through. With comments gone, any occurrence is real code.
  const entryCode = entry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  // Appending to the batch end would place the block after driver context.
  check('inject.ts 插在已认领批次之后', /lastClaimed|claimed\.length|indexOf/.test(inject))
  check('index.ts 未把注入追加到批次末尾', !/messages\.push\(injection\)|toSpliced\(messages\.length/.test(entry))
  // The scan root must come from the session directory, never the host process.
  check('index.ts 不读 process.cwd()', !/process\s*\.\s*cwd\s*\(/.test(entryCode), entryCode.match(/process\s*\.\s*cwd\s*\(/)?.[0] ?? '')
  check('index.ts 读 ctx.workingDirectory.ensure', /workingDirectory\.ensure/.test(entry))
}

console.log('\n════ 11. 发布就绪（npm + GitHub）════')
{
  check('name 是 scoped（npm 名字唯一）', pj.name.startsWith('@'), pj.name)
  check('private 未设置（可发布）', pj.private === undefined)
  check('publishConfig 锁定官方源', pj.publishConfig?.registry === 'https://registry.npmjs.org/')
  check('access=public（scoped 必须）', pj.publishConfig?.access === 'public')
  // A local publish cannot generate provenance: npm builds the payload only
  // under GITHUB_ACTIONS or GITLAB_CI, and otherwise passes `undefined` to
  // Buffer.from, which throws. Enable it in CI with `npm publish --provenance`.
  check('publishConfig 未强制 provenance（本地发布会崩）', pj.publishConfig?.provenance !== true)
  check('repository 已设置', typeof pj.repository?.url === 'string', pj.repository?.url)
  check('homepage 已设置', typeof pj.homepage === 'string')
  check('semver 初始版本', /^\d+\.\d+\.\d+$/.test(pj.version), pj.version)
  // A git install needs the built artifacts, so lib/ must NOT be ignored.
  const ig = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  check('lib/ 未被 gitignore（git 安装需要产物）', !/^lib\/?$/m.test(ig))
  check('lib/index.js 已构建', fs.existsSync(path.join(ROOT, 'lib/index.js')))
  check('lib/client.js 已构建', fs.existsSync(path.join(ROOT, 'lib/client.js')))
  check('lib/index.d.ts 已构建', fs.existsSync(path.join(ROOT, 'lib/index.d.ts')))
}

console.log('\n════ 12. 名称一致性（改名后不能有残留）════')
{
  const FILES = ['package.json', 'cordis.patch.yml', 'tsdown.config.ts', 'src/index.ts']
  const stale: string[] = []
  for (const f of FILES) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8')
    // The old bare name must not appear as an npm name or a loader id.
    if (/"dsh-rules-manager"|'dsh-rules-manager'/.test(t)) stale.push(f)
  }
  check('无残留的旧裸包名', stale.length === 0, stale.join(', '))

  const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  check('cordis.patch.yml 引用 scoped 名', patch.includes('@one-dragon/dsh-rules-manager'))
  check('cordis.patch.yml 的 entry id 为短名', /-\s*id:\s*rules-manager\s*$/m.test(patch))
  // Official spec: "Entry name == package name" for the client module table.
  const tsdown = fs.readFileSync(path.join(ROOT, 'tsdown.config.ts'), 'utf8')
  check('client banner id == npm 包名', tsdown.includes(`id: "${pj.name}"`), pj.name)
}

console.log('\n════ 13. 可移植性（本机路径不得进入仓库）════')
{
  // The first release was written on one machine and leaked its layout into
  // tests and docs. A clone must not need to know where npm or the author's
  // workspace lives.
  // Sources are split so this file cannot match itself.
  const MARKERS: Array<[string, RegExp]> = [
    ['本机 UGIT 工作区', new RegExp('UGIT[\\\\/]fe', 'i')],
    ['本机用户名', new RegExp('yilong' + 'sun', 'i')],
    ['本机 nvm 安装路径', new RegExp('nvm[\\\\/]node' + 'js', 'i')],
    ['非占位的用户主目录写法', new RegExp('C:[\\\\/]Users[\\\\/](?!me\\b|you\\b|user\\b|test\\b|someone\\b)', 'i')],
  ]
  const files: string[] = ['README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'package.json', 'cordis.patch.yml']
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + e.name
      if (e.isDirectory()) walk(rel)
      else if (/\.(ts|tsx|mts|mjs|json|md)$/.test(e.name)) files.push(rel)
    }
  }
  for (const r of ['src', 'scripts', 'tests']) walk(r)
  const hits: string[] = []
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8')
    for (const [label, re] of MARKERS) if (re.test(t)) hits.push(f + ' → ' + label)
  }
  check('源码与文档不含本机专属路径', hits.length === 0, hits.join('; '))
}

console.log('\n════ 14. 换行与空白卫生（对照 EditorConfig 与 gitattributes 规范）════')
{
  // EditorConfig 规范（https://spec.editorconfig.org/）允许声明 end_of_line、
  // indent_style、insert_final_newline 与 trim_trailing_whitespace 四条；仓库既然在
  // .editorconfig 里声明了它们，这一节就核验每个受管文件是否兑现。
  // 构建产物 lib/ 不在扫描范围：那是 build 生成、随时会被覆盖的文件。
  const CR = new RegExp('\\r')
  const TAB = new RegExp('^' + '\\t')
  const TRAILING = new RegExp('[ \\t]+$')
  const targets: string[] = [
    '.editorconfig', '.gitattributes', '.gitignore', 'package.json', 'package-lock.json',
    'tsconfig.json', 'tsdown.config.ts', 'vitest.config.ts', 'cordis.patch.yml',
    'AGENTS.md', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'LICENSE',
  ]
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + e.name
      if (e.isDirectory()) walk(rel)
      else if (/\.(ts|tsx|mts|mjs|json|md|yml|svg)$/.test(e.name)) targets.push(rel)
    }
  }
  for (const r of ['src', 'scripts', 'tests', 'docs', 'locale', 'assets']) walk(r)
  const cr: string[] = []
  const tabs: string[] = []
  const trailing: string[] = []
  const unterminated: string[] = []
  for (const f of targets) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8')
    if (CR.test(t)) cr.push(f)
    if (t.split('\n').some((line) => TAB.test(line))) tabs.push(f)
    if (!f.endsWith('.md') && t.split('\n').some((line) => TRAILING.test(line))) trailing.push(f)
    if (t !== '' && !t.endsWith('\n')) unterminated.push(f)
  }
  check(`${targets.length} 个文件无 CR 字节`, cr.length === 0, cr.join(', '))
  check('无行首 TAB', tabs.length === 0, tabs.join(', '))
  check('无行尾空白（Markdown 除外）', trailing.length === 0, trailing.join(', '))
  check('每个文件以换行结尾', unterminated.length === 0, unterminated.join(', '))
  const ec = fs.readFileSync(path.join(ROOT, '.editorconfig'), 'utf8')
  check('.editorconfig 声明了这四条承诺', ['charset', 'end_of_line', 'indent_style', 'indent_size', 'insert_final_newline', 'trim_trailing_whitespace'].every((k) => ec.includes(k)))
  const ga = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8')
  check('.gitattributes 声明 text=auto', ga.includes('text=auto'))
}

console.log('\n' + '═'.repeat(54))
console.log(fails ? `终检：${fails} 处问题` : '终检：0 处问题 ✅')
console.log('═'.repeat(54))
process.exitCode = fails ? 1 : 0
