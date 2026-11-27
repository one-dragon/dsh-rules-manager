/**
 * 性能基准（官方测试政策第 5 层）。
 *
 * 跑法：node --experimental-strip-types tests/bench/bench.mts
 *
 * 零凭据、零网络、零新依赖：只 import 仓库里的真实模块（src/scan.ts、
 * src/render.ts、src/attach.ts、src/tool-read-rules.ts），被测逻辑一律不在这里
 * 重写，也不用 mock 顶替。
 *
 * 下面每个基准的上限只是**回归护栏，不是性能指标**：它们比实测值宽出一个数量级，
 * 只有在真回归（扫描退化成平方级、匹配式编译炸掉、一次 read_rules 卡住）时才会
 * 变红。三次取样取中位数，抹掉一次性的抖动。
 *
 * 夹具树用 node:os 的 tmpdir 加 fs.mkdtemp 现造，覆盖 src/scan.ts 来源表里六个真实
 * 项目级目录；整棵树在 finally 里删除，跑完不留痕。
 *
 * 输出一律走 process.stdout.write（仓库检查器把调试输出当成遗留痕迹）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanAll } from '../../src/scan.ts'
import { renderRulesBlock } from '../../src/render.ts'
import { attachedRules } from '../../src/attach.ts'
import { createReadRulesTool } from '../../src/tool-read-rules.ts'
import type { Rule } from '../../src/types.ts'
import type { RequestableRule } from '../../src/tool-read-rules.ts'

const NL = String.fromCharCode(10)
const fsp = fs.promises

let checks = 0
let passed = 0
const out = (line: string): void => { process.stdout.write(line + NL) }
const check = (label: string, cond: boolean, detail = ''): void => {
  checks++
  if (cond) { passed++; out('  OK   ' + label) }
  else out('  BAD  ' + label + (detail !== '' ? '  → ' + detail : ''))
}
const ms = (value: number): string => value.toFixed(1) + ' ms'
const line = (name: string, scale: string, median: number, limit: number): string =>
  '基准 ' + name + ' | 规模 ' + scale + ' | 中位 ' + ms(median) + ' | 上限 ' + ms(limit)

/** 排序取样后取中位数；取样数为奇数，落在正中那个。 */
const medianOf = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** 跑 runs 次，逐次计时，返回中位毫秒。被测调用由 body 提供。 */
const measure = async (runs: number, body: () => void | Promise<void>): Promise<number> => {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    await body()
    samples.push(performance.now() - started)
  }
  return medianOf(samples)
}

/**
 * 夹具配方：目录、扩展名、文件数与 frontmatter 生成方式，全部对齐 src/scan.ts 的
 * SOURCES 表（.cursor/rules 只认 .mdc；.github/instructions 只认
 * *.instructions.md 后缀；.agents/rules 是 requiresTrigger + flat；其余目录
 * 的 .md/.mdc 由各自 emptyRuleType 决定，空 frontmatter 也算规则）。
 */
interface SourcePlan {
  readonly dir: string
  readonly ext: string
  readonly files: number
  readonly frontmatter: (i: number) => string
}

const SOURCE_PLANS: readonly SourcePlan[] = [
  {
    dir: '.cursor/rules', ext: '.mdc', files: 70,
    frontmatter: (i) => '---' + NL + 'description: Cursor 规则 ' + i + ' 的适用范围' + NL
      + 'globs: "src/mod' + i + '/**/*.ts"' + NL + '---' + NL,
  },
  { dir: '.claude/rules', ext: '.md', files: 70, frontmatter: () => '' },
  {
    dir: '.github/instructions', ext: '.instructions.md', files: 70,
    frontmatter: (i) => '---' + NL + 'applyTo: "src/mod' + i + '/**"' + NL + '---' + NL,
  },
  { dir: '.codebuddy/rules', ext: '.mdc', files: 70, frontmatter: () => '' },
  { dir: '.kiro/steering', ext: '.md', files: 60, frontmatter: () => '' },
  {
    dir: '.agents/rules', ext: '.md', files: 60,
    frontmatter: (i) => '---' + NL + 'name: agents-rule-' + i + NL + 'trigger: always_on' + NL + '---' + NL,
  },
]

const FILLER = 'Keep module boundaries explicit, prefer named exports, and cover the branch you changed.'

/** 正文：多数落在 1–3 KB，每第 20 个文件涨到 20 KB，制造体量差异。 */
const bodyFor = (label: string, index: number): string => {
  const target = index % 20 === 0 ? 20000 : 1200 + ((index * 211) % 1800)
  let body = '# ' + label + ' ' + index + NL + NL
  let n = 0
  while (body.length < target) {
    body += '- ' + FILLER + ' (' + n + ')' + NL
    n++
  }
  return body
}

/** 按 SOURCES 表里的项目级目录造树，返回文件总数。 */
const buildFixture = async (root: string): Promise<number> => {
  let total = 0
  for (const plan of SOURCE_PLANS) {
    const dir = path.join(root, plan.dir)
    await fsp.mkdir(dir, { recursive: true })
    for (let i = 0; i < plan.files; i++) {
      const name = 'rule-' + String(i).padStart(3, '0') + plan.ext
      await fsp.writeFile(path.join(dir, name), plan.frontmatter(i) + bodyFor(plan.dir, i), 'utf8')
      total++
    }
  }
  return total
}

/** 一条 attach 用的按需规则；字段与 src/types.ts 的 Rule 对齐。 */
const requestedRule = (root: string, i: number): Rule => ({
  path: path.join(root, '.cursor', 'rules', 'attach-' + i + '.mdc'),
  name: 'attach-' + i,
  type: 'requested',
  enabled: true,
  description: '第 ' + i + ' 条按需规则的适用范围',
  body: '# 按需规则 ' + i + NL,
  family: 'cursor',
  sourceKey: 'cursor',
  scope: 'project',
  patterns: ['src/mod' + i + '/**/*.ts'],
  descriptionTokens: 8,
  bodyTokens: 4,
  diagnostics: [],
})

const main = async (): Promise<void> => {
  out('性能基准（真实模块、离线、临时夹具）')
  out('')

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dshrm-bench-'))
  try {
    const fileCount = await buildFixture(root)

    // 用户层的三个可定位根指到夹具内的空目录，避免本机主目录影响扫描耗时与计数；
    // 其余厂商的 userPath 直接来自 homedir()，无法改写，因此计数只认夹具内的规则。
    const noUserTier = path.join(root, 'no-user-tier')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_AGENTS_HOME: noUserTier,
      COPILOT_HOME: noUserTier,
      KIRO_HOME: noUserTier,
      CLINE_DIR: noUserTier,
    }

    let scanned: readonly Rule[] = []
    const scanMs = await measure(3, async () => {
      scanned = (await scanAll(root, {}, env)).rules
    })
    const projectRules = scanned.filter((rule) => rule.path.startsWith(root))
    out(line('scanAll', fileCount + ' 个规则文件（夹具内 ' + projectRules.length + ' 条 / 全量 ' + scanned.length + ' 条）', scanMs, 8000))
    check('scanAll 扫出夹具里的 ' + fileCount + ' 条规则', projectRules.length === fileCount, '实际 ' + projectRules.length)
    check('scanAll 中位耗时在上限内', scanMs < 8000)

    let rendered = ''
    const renderMs = await measure(3, () => {
      rendered = renderRulesBlock(scanned, { projectRoot: root })
    })
    out(line('renderRulesBlock', scanned.length + ' 条规则 → ' + rendered.length + ' 字符', renderMs, 300))
    check('renderRulesBlock 产出非空注入块', rendered.length > 0)
    check('renderRulesBlock 中位耗时在上限内', renderMs < 300)

    const touchCount = 200
    const rulesForMatch: Rule[] = []
    const touched: string[] = []
    for (let i = 0; i < touchCount; i++) {
      rulesForMatch.push(requestedRule(root, i))
      touched.push(path.join(root, 'src', 'mod' + i, 'file-' + i + '.ts'))
    }
    let attachedCount = -1
    const attachMs = await measure(3, () => {
      attachedCount = attachedRules({ rules: rulesForMatch, touched, cwd: root, projectRoot: root }).attached.size
    })
    out(line('attachedRules', rulesForMatch.length + ' 条按需规则 × ' + touched.length + ' 个 touched 文件 → ' + attachedCount + ' 条命中', attachMs, 500))
    check('attachedRules 每条规则都命中自己的文件', attachedCount === touchCount, '实际 ' + attachedCount)
    check('attachedRules 中位耗时在上限内', attachMs < 500)

    const index: Record<string, RequestableRule> = {}
    const keys: string[] = []
    for (let i = 0; i < 200; i++) {
      const key = path.join(root, 'catalog', 'tool-rule-' + i + '.mdc')
      index[key] = { path: key, name: 'tool-rule-' + i, body: bodyFor('read_rules', i) }
      keys.push(key)
    }
    const asked = keys.slice(0, 50)
    const tool = createReadRulesTool(() => index) as unknown as {
      execute(args: unknown, exec: unknown): Promise<{ resolvedCount: number; notFoundCount: number; ambiguousCount: number }>
    }
    let resolvedCount = -1
    const toolMs = await measure(3, async () => {
      const value = await tool.execute({ ruleNames: asked }, { agent: undefined })
      resolvedCount = value.resolvedCount
    })
    out(line('read_rules', '索引 200 条 / 一次请求 ' + asked.length + ' 条 → 解析 ' + resolvedCount + ' 条', toolMs, 50))
    check('read_rules 解析出全部请求键', resolvedCount === asked.length, '实际 ' + resolvedCount)
    check('read_rules 中位耗时在上限内', toolMs < 50)

    out('')
    out('夹具根：' + path.basename(root) + '（node:os tmpdir 下）')
    out('夹具删除：finally 里 rm -r')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  out('')
  out('checks: ' + checks + ' 项，通过 ' + passed + ' 项')
  if (passed !== checks) process.exitCode = 1
}

await main()
