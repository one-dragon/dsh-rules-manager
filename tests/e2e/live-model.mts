/**
 * 官方测试政策第 3 层：带真模型 key 的 e2e（Real-API e2e）。
 *
 * 依据 https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/testing.md
 * 的 with-key 政策（"A no-key test proves plumbing; only a with-key run proves the agent
 * works against a real model"），并落实同文件的 "Self-skip keeps secretless CI and keyless
 * contributors unblocked"：没有可用 launcher、或配置的凭据环境变量为空时，本用例打印
 * 一行 SKIPPED 并以退出码 0 结束，保持无凭据机器与 CI 可用。
 *
 * 断言遵守同文件第 3 条硬规矩 "Verify the world, not the self-report"：不去搜模型自己的
 * 输出，而是在会话结束后重新打开一次性 DSH_HOME 里的会话持久化文件，要求其中真的存在
 * 一条 source.kind === 'rules-context' 的用户消息，并与本仓库夹具文件原文对照。
 *
 * 风格与 launcher 解析参照 tests/e2e/smoke.mts；launcher 全部从环境变量推导，不写死任何
 * 机器路径。运行：node --experimental-strip-types tests/e2e/live-model.mts
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const NL = String.fromCharCode(10)
const BS = String.fromCharCode(92)

let fails = 0
let checks = 0
const out = (line: string): void => { process.stdout.write(line + NL) }
const section = (title: string): void => { out(''); out('════ ' + title + ' ════') }
const note = (msg: string): void => { out('  --   ' + msg) }
const check = (label: string, cond: boolean, detail = ''): void => {
  checks++
  if (cond) out('  OK   ' + label)
  else { out('  BAD  ' + label + (detail ? '  → ' + detail : '')); fails++ }
}
const tailLines = (text: string, n: number): string => text.split(NL).filter((l) => l.trim().length > 0).slice(-n).join(NL)

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'e2e', 'fixture')
const FIXTURE_RULE = path.join('.codebuddy', 'rules', 'resident.mdc')
const PROFILE = 'live-model-e2e'
const DEFAULT_KEY_ENV = 'DEEPSEEK_API_KEY'
/** 凭据所在的环境变量**名**（不是值）。LIVE_KEY_ENV 可以把它换成自建网关的变量名。 */
const KEY_ENV = (process.env['LIVE_KEY_ENV'] ?? DEFAULT_KEY_ENV).trim() || DEFAULT_KEY_ENV
/** 自建 OpenAI 兼容网关的 baseURL；设置后本用例用 --patch 覆盖模型路由，不落到默认的官方路由上。 */
const GATEWAY_BASE_URL = (process.env['LIVE_BASE_URL'] ?? '').trim()
/** 网关上的模型 id；与 LIVE_BASE_URL 成对使用。 */
const GATEWAY_MODEL = (process.env['LIVE_MODEL'] ?? '').trim()
const RESIDENT_MARKER = 'RESIDENT_MARKER_ALPHA'
const ONDEMAND_DESCRIPTION = 'ONDEMAND_DESCRIPTION_MARKER'
const ONDEMAND_BODY = 'ONDEMAND_BODY_MARKER_BETA'

// ---------------------------------------------------------------- launcher

interface Launcher { kind: 'exe' | 'command'; label: string; command: string; prefix: string[] }

/** DSH_CLI 若带路径分隔符，则必须真实存在；裸命令名交给 shell 解析。 */
function cliEnvUsable(raw: string): boolean {
  const first = raw.split(' ').filter(Boolean)[0] ?? ''
  if (first.length === 0) return false
  if (first.indexOf('/') >= 0 || first.indexOf(BS) >= 0) return fs.existsSync(first)
  return true
}

/**
 * 两个来源：显式 DSH_CLI；或 DSH 进程导出的 DSH_NODE_EXECUTABLE + DSH_INSTALL_DIR。
 * 后者拼出 Electron 内的 host cli：DSH_INSTALL_DIR/../dsh-desktop-host/lib/cli.js，
 * 以 ELECTRON_RUN_AS_NODE=1 让 Electron 二进制按 node 运行该脚本（asar 路径只有
 * Electron 运行时能解析）。
 */
function resolveLauncher(): Launcher | null {
  const cli = (process.env['DSH_CLI'] ?? '').trim()
  if (cli.length > 0 && cliEnvUsable(cli)) return { kind: 'command', label: 'DSH_CLI', command: cli, prefix: [] }
  const exe = (process.env['DSH_NODE_EXECUTABLE'] ?? '').trim()
  const installDir = (process.env['DSH_INSTALL_DIR'] ?? '').trim()
  if (exe.length > 0 && installDir.length > 0 && fs.existsSync(exe)) {
    const hostCli = path.join(installDir, '..', 'dsh-desktop-host', 'lib', 'cli.js')
    return { kind: 'exe', label: 'DSH_NODE_EXECUTABLE + DSH_INSTALL_DIR', command: exe, prefix: ['--expose-internals', hostCli] }
  }
  return null
}

interface RunOptions { cwd?: string; env: Record<string, string>; timeoutMs: number }

interface RunResult { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stdout: string; stderr: string; spawnError: string }

/**
 * 必须异步 spawn：本用例与 DSH 子进程共享同一个事件循环，同步等待会饿死事件循环。
 * 超时不用 spawn 选项，自己计时后 SIGKILL，才能区分"跑完了"与"被杀了"。
 */
function runLauncher(l: Launcher, args: string[], opts: RunOptions): Promise<RunResult> {
  const env = { ...process.env, ...opts.env }
  const common = { cwd: opts.cwd, env, windowsHide: true }
  return new Promise<RunResult>((resolve) => {
    const first = l.command.split(' ').filter(Boolean)[0] ?? ''
    const line = [l.command].concat(args.map((a) => '"' + a + '"')).join(' ')
    const child = l.kind === 'exe'
      ? spawn(l.command, l.prefix.concat(args), common)
      : (first.endsWith('.sh') || first.endsWith('.bash') ? spawn('bash', ['-c', line], common) : spawn(line, { ...common, shell: true }))
    let stdout = ''
    let stderr = ''
    let spawnError = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, opts.timeoutMs)
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf8') })
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf8') })
    child.on('error', (err: Error) => { spawnError = err.message })
    child.on('close', (status, signal) => {
      clearTimeout(timer)
      resolve({ status, signal, timedOut, stdout, stderr, spawnError })
    })
  })
}

// --------------------------------------------------- 会话持久化（验世界）

/** 递归找会话持久化文件；DSH 写的是 *.jsonl.zstd，故按名字里的 .jsonl 匹配。 */
function findJsonlFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.indexOf('.jsonl') >= 0) found.push(full)
    }
  }
  walk(root, 0)
  return found
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/**
 * 读取一个持久化文件为文本。实测 DSH 写的是 zstd 压缩的多帧追加文件（名字
 * session.v4.jsonl.zstd，魔数 28 b5 2f fd 后跟若干独立帧）：node:zlib 的
 * zstdDecompressSync 只解出第一帧就返回（实测 13124 字节的文件只得到 184 字节），
 * 因此按魔数偏移逐帧解压再拼接。zstd API 需要 Node 的 zlib zstd 支持
 * （Node 22.15+ / 23.8+；本仓库 engines 允许 ^22.19.0 || >=24.0.0，实测运行时 v24.21.0）。
 * 非 .zstd 的明文 jsonl 直接按 utf8 读，兼容未来换成明文持久化的情况。
 */
function decodeSessionFile(file: string): string {
  const buf = fs.readFileSync(file)
  if (file.endsWith('.zstd') === false) return buf.toString('utf8')
  if (typeof zlib.zstdDecompressSync !== 'function') return ''
  const parts: string[] = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    let magic = true
    for (let k = 0; k < 4; k++) {
      if (buf[i + k] !== ZSTD_MAGIC[k]) { magic = false; break }
    }
    if (!magic) continue
    try { parts.push(String(zlib.zstdDecompressSync(buf.subarray(i)))) } catch { /* 不是帧起点，跳过 */ }
  }
  return parts.join('')
}

interface RulesMessage { file: string; form: string; text: string }

/** 从会话持久化的 user/message 行里取 source.kind === 'rules-context' 的消息。 */
function collectRulesMessages(files: string[]): RulesMessage[] {
  const hits: RulesMessage[] = []
  for (const file of files) {
    const text = decodeSessionFile(file)
    if (text.length === 0) continue
    for (const line of text.split(NL)) {
      if (line.trim().length === 0) continue
      let parsed: unknown
      try { parsed = JSON.parse(line) } catch { continue }
      const record = parsed as { type?: unknown; data?: { source?: { kind?: unknown; form?: unknown }; content?: unknown } }
      if (record.type !== 'user/message') continue
      const source = record.data?.source
      if (source === undefined || source.kind !== 'rules-context') continue
      const content = record.data?.content
      let joined = ''
      if (Array.isArray(content)) {
        for (const part of content) {
          const item = part as { type?: unknown; text?: unknown }
          if (item.type === 'text' && typeof item.text === 'string') joined += item.text
        }
      }
      hits.push({ file, form: typeof source.form === 'string' ? source.form : '', text: joined })
    }
  }
  return hits
}

/**
 * 指向自建 OpenAI 兼容网关的 overlay。
 *
 * 覆盖 `llm-pi-ai` 的 providers 与 `agent-default-model` 两行而不是 `insert` 新行：
 * 该适配器的 provider 字典是整体替换，插一条新的 pi-ai 行会因重复注册而报错。
 * 形态取自官方 packages/llm/llm-pi-ai/README.md 的 hand-declared gateway 示例。
 */
function gatewayOverlay(): string {
  const quote = String.fromCharCode(34)
  const model = quote + GATEWAY_MODEL + quote
  return [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      livegateway:',
    '        apiKeyEnv: ' + KEY_ENV,
    '        api: openai-completions',
    '        baseURL: ' + GATEWAY_BASE_URL,
    '        models:',
    '          - id: ' + model,
    '- id: agent-default-model',
    '  config:',
    '    provider: livegateway',
    '    model: ' + model,
  ].join(NL) + NL
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  section('launcher')
  const launcher = resolveLauncher()
  if (launcher === null) {
    out('SKIPPED: 未找到可用 launcher（DSH_CLI 与 DSH_NODE_EXECUTABLE+DSH_INSTALL_DIR 都不可用）')
    return
  }
  note('source: ' + launcher.label)
  note('command: ' + launcher.command + (launcher.prefix.length > 0 ? ' [electron-as-node]' : ''))

  if ((process.env[KEY_ENV] ?? '').trim().length === 0) {
    out('SKIPPED: 未设置 ' + KEY_ENV + '，带真模型的 Real-API e2e 需要模型凭据；无 key 自跳过，保持无凭据 CI 与无 key 贡献者不被阻塞')
    return
  }
  if (GATEWAY_BASE_URL.length > 0 && GATEWAY_MODEL.length === 0) {
    out('SKIPPED: 设置了 LIVE_BASE_URL 但没有 LIVE_MODEL；自建网关必须指明模型 id')
    return
  }
  note(KEY_ENV + ': 已设置（值不打印）')

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rules-live-'))
  const home = path.join(base, 'dshhome')
  const tempHome = path.join(base, 'home')
  const runDir = path.join(base, 'runs', 'live')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(tempHome, { recursive: true })
  // 夹具项目必须是"有项目标记的目录"才会被本插件认成项目根：复制到临时目录再补 .git，
  // 不往仓库的 tests/e2e/fixture 里写任何东西。
  fs.cpSync(FIXTURE_DIR, runDir, { recursive: true })
  fs.mkdirSync(path.join(runDir, '.git'), { recursive: true })
  const installEnv: Record<string, string> = { DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' }
  const sessionEnv: Record<string, string> = { DSH_HOME: home, HOME: tempHome, USERPROFILE: tempHome, ELECTRON_RUN_AS_NODE: '1' }
  try {
    section('profile / plugin 装配（一次性 DSH_HOME）')
    note('temp DSH_HOME: ' + home)
    const created = await runLauncher(launcher, ['--profile', PROFILE, '--from-default-profile', 'headless', '--dump-config'], { env: installEnv, timeoutMs: 300000 })
    check('profile 首次使用创建成功（rc=0）', created.status === 0, 'status=' + String(created.status) + ' stderr=' + tailLines(created.stderr, 3))
    const added = await runLauncher(launcher, ['plugin', '--profile', PROFILE, 'add', REPO_ROOT], { env: installEnv, timeoutMs: 420000 })
    check('plugin add 本仓库成功（rc=0）', added.status === 0, 'status=' + String(added.status) + ' stderr=' + tailLines(added.stderr, 3))
    const pnpmLine = (added.stdout ?? '').split(NL).concat((added.stderr ?? '').split(NL)).find((l) => l.toLowerCase().indexOf('pnpm') >= 0)
    if (pnpmLine !== undefined) note('pnpm: ' + pnpmLine.trim())
    const dumped = await runLauncher(launcher, ['--profile', PROFILE, '--dump-config'], { env: installEnv, timeoutMs: 300000 })
    check('dump-config 里出现 dsh-rules-manager', ((dumped.stdout ?? '') + (dumped.stderr ?? '')).indexOf('dsh-rules-manager') >= 0)

    const overlayPath = GATEWAY_BASE_URL.length === 0 ? null : path.join(base, 'gateway.patch.yml')
    if (overlayPath !== null) {
      fs.writeFileSync(overlayPath, gatewayOverlay())
      note('gateway overlay: ' + overlayPath)
      note('route: ' + GATEWAY_BASE_URL + ' -> ' + GATEWAY_MODEL + ' (apiKeyEnv ' + KEY_ENV + ')')
    } else {
      note('route: profile 默认路由（未设置 LIVE_BASE_URL）')
    }

    section('带真模型的会话（真实任务文本）')
    const ruleFile = path.join(runDir, FIXTURE_RULE)
    const taskText = '请用 read 工具读取 ' + ruleFile + ' 这个文件，然后原样复述其中含 ' + RESIDENT_MARKER + ' 的那一行，不要改写任何字符。'
    note('task: ' + taskText)
    const sessionArgs = overlayPath === null
      ? ['--profile', PROFILE, '--json', taskText]
      : ['--profile', PROFILE, '--patch', overlayPath, '--json', taskText]
    const session = await runLauncher(launcher, sessionArgs, { cwd: runDir, env: sessionEnv, timeoutMs: 300000 })
    note('session: status=' + String(session.status) + ' signal=' + String(session.signal) + ' timedOut=' + String(session.timedOut))
    const eventLines = session.stdout.split(NL).filter((l) => l.trim().length > 0)
    out('  final event: ' + (eventLines[eventLines.length - 1] ?? '').slice(0, 400))
    check('会话事件流非空', eventLines.length > 0)
    check('会话正常收尾（rc=0）', session.status === 0, 'status=' + String(session.status) + ' stderr=' + tailLines(session.stderr, 3))
    check('事件流里没有 MISSING_CREDENTIAL', (session.stdout + session.stderr).indexOf('MISSING_CREDENTIAL') < 0)

    section('验世界：重读会话持久化（不看模型自述）')
    const persisted = findJsonlFiles(home)
    note('persisted files: ' + String(persisted.length))
    for (const file of persisted) note('  ' + path.relative(home, file))
    check('一次性 DSH_HOME 里存在会话持久化文件', persisted.length > 0)
    const rulesMessages = collectRulesMessages(persisted)
    check('存在 source.kind === "rules-context" 的用户消息', rulesMessages.length > 0, 'messages=' + String(rulesMessages.length))
    const joined = rulesMessages.map((m) => m.text).join(NL)
    const fixtureText = fs.readFileSync(ruleFile, 'utf8')
    const markerLine = fixtureText.split(NL).find((l) => l.indexOf(RESIDENT_MARKER) >= 0) ?? ''
    check('夹具文件本身含常驻 marker（外部对照）', markerLine.length > 0)
    check('规则消息的 source.form 是 instructions', rulesMessages.some((m) => m.form === 'instructions'))
    check('常驻规则正文 marker 进入 rules-context 消息', joined.indexOf(RESIDENT_MARKER) >= 0)
    check('常驻规则那一行逐字来自夹具文件', markerLine.length > 0 && joined.indexOf(markerLine) >= 0, 'markerLine=' + markerLine.slice(0, 80))
    check('按需规则只出现描述 marker', joined.indexOf(ONDEMAND_DESCRIPTION) >= 0)
    check('按需规则正文未进入 rules-context 消息', joined.indexOf(ONDEMAND_BODY) < 0)
  } finally {
    if (process.env['E2E_KEEP'] === '1') out('  kept temp dir: ' + base)
    else {
      try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }) } catch (err) { note('cleanup warning: ' + String(err)) }
    }
  }
}

main().then(() => {
  out('')
  out('checks: ' + String(checks) + ' 项，通过 ' + String(checks - fails) + ' 项')
  process.exitCode = fails ? 1 : 0
}).catch((err: unknown) => {
  out('FATAL: ' + (err instanceof Error ? err.stack ?? err.message : String(err)))
  process.exitCode = 1
})
