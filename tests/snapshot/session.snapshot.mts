/**
 * 官方测试政策第 6 层「录制会话快照（Session snapshot）」的插件级对应物。
 *
 * 出处 https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/testing.md
 * 第 6 层原文：顶层场景录下父代给的输入与模型回放，子代是期望的持久结果。
 * 本插件没有那套父子场景框架，于是把同一件事缩到插件规模：
 *   - 父代（输入）：本地 OpenAI 兼容 stub 的固定回放（模型是假的），加上一次真机 DSH
 *     无头会话里插件真的注入进模型上下文的 <rules> 块（会话是真的）；
 *   - 子代（持久结果）：那次会话在一次性 DSH_HOME 里留下的会话持久化文件，从里面重新
 *     读回 rules-context 消息的正文，以及插件状态文件 state.json 的规范化内容。
 * 断言方式：默认模式下重跑同一场会话，把新读回的两侧与录制文件逐字比对，不一致就打印
 * 第一处不同的上下文并以退出码 1 结束；设 DSH_SNAPSHOT_UPDATE=1 时改写录制文件。
 * 于是「注入文本」与「持久结果」都不会再悄悄漂移。
 *
 * 与 tests/e2e/smoke.mts 的分工：
 *   - smoke.mts 证明「能注入」：规则真的进入了模型可见的请求，并覆盖对照运行与对抗输入；
 *     它的期望值每次运行都现场推导，改动了注入文本它仍可能通过。
 *   - 本文件证明「不再漂移」：把一次真实注入的模型可见文本与会话落盘结果固化成可复核的
 *     录制，之后任何改动只要碰了模型可见文本或落盘结果，就必须显式刷新录制。
 * 两者都不需要任何模型凭据，也都不写入仓库里的夹具目录。
 *
 * 录制文件里不写任何本机路径：临时项目目录、一次性 DSH_HOME 与临时根目录的前缀在落盘前
 * 换成 <PROJECT> / <DSH_HOME> / <TEMP_ROOT> 占位，比对时对新读回的值做同样的替换。
 *
 * 运行：
 *   比对（默认） node --experimental-strip-types tests/snapshot/session.snapshot.mts
 *   刷新录制     DSH_SNAPSHOT_UPDATE=1 node --experimental-strip-types tests/snapshot/session.snapshot.mts
 * 拿不到可用 launcher 时打印一行 SKIPPED 并以退出码 0 结束。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
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
const SNAPSHOT_FILE = path.join(REPO_ROOT, 'tests', 'snapshot', 'session.snapshot.json')
const MODEL = 'snapshot-model'
const KEY_ENV = 'SNAPSHOT_PROBE_KEY'
const KEY_VALUE = 'snapshot-key-local'
const PROFILE = 'snapshot-probe'
const STUB_BASE_PORT = 18411
const SCHEMA_VERSION = 1
const RULES_OPEN = '<rules>'
const RULES_CLOSE = '</rules>'
const PROBE_REPLY = 'SNAPSHOT_DONE'
const PH_PROJECT = '<PROJECT>'
const PH_HOME = '<DSH_HOME>'
const PH_TEMP = '<TEMP_ROOT>'
const RUNNER_REL = 'tests/snapshot/session.snapshot.mts'

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
 * Electron 运行时能解析，因此只对可执行文件本身做存在性判断）。
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
 * 必须异步 spawn：stub 与 DSH 子进程共享同一个事件循环，同步等待会把 stub 饿死。
 * 超时不用 spawn 选项，自己计时后 SIGKILL，才能区分「跑完了」与「被杀了」。
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

// ------------------------------------------------------------------- stub

interface StubRequest { index: number; bytes: number; body: string }

interface Stub { port: number; requests: () => StubRequest[]; close: () => Promise<void> }

const sseChunk = (delta: Record<string, unknown>, finish: string | null): Record<string, unknown> => ({
  id: 'chatcmpl-snapshot',
  object: 'chat.completion.chunk',
  created: 1,
  model: MODEL,
  choices: [{ index: 0, delta, finish_reason: finish }],
})

function listenOn(server: Server, startPort: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let attempt = 0
    const attemptListen = (): void => {
      const port = startPort + attempt
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        if (err.code === 'EADDRINUSE' && attempt < 10) { attempt++; attemptListen(); return }
        reject(err)
      }
      const onListening = (): void => { server.removeListener('error', onError); resolve(port) }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    }
    attemptListen()
  })
}

/** OpenAI 兼容 stub：把每个请求体原样记一行，回放一段固定内容，不调用任何外部服务。 */
async function startStub(startPort: number): Promise<Stub> {
  const log: StubRequest[] = []
  let index = 0
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { chunks.push(c) })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const url = req.url ?? ''
      if (req.method === 'GET' && url.startsWith('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }))
        return
      }
      if (req.method === 'POST' && url.indexOf('chat/completions') >= 0) {
        index++
        log.push({ index, bytes: Buffer.byteLength(raw, 'utf8'), body: raw })
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.write('data: ' + JSON.stringify(sseChunk({ role: 'assistant', content: PROBE_REPLY }, null)) + NL + NL)
        res.write('data: ' + JSON.stringify(sseChunk({}, 'stop')) + NL + NL)
        res.write('data: [DONE]' + NL + NL)
        res.end()
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"not found"}')
    })
  })
  const port = await listenOn(server, startPort)
  return {
    port,
    requests: () => log.slice(),
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()) }),
  }
}

function overlayYaml(port: number): string {
  return [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      snapshotprobe:',
    '        apiKeyEnv: ' + KEY_ENV,
    '        api: openai-completions',
    '        baseURL: http://127.0.0.1:' + port + '/v1',
    '        models:',
    '          - id: ' + MODEL,
    '- id: agent-default-model',
    '  config:',
    '    provider: snapshotprobe',
    '    model: ' + MODEL,
  ].join(NL) + NL
}

// --------------------------------------------- 会话持久化（读回持久结果）

/** 递归找会话持久化文件；DSH 写的是 session.v4.jsonl.zstd，故按名字里的 .jsonl 匹配。 */
function findPersistedFiles(root: string): string[] {
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
  return found.sort()
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * 读取一个持久化文件为文本。实测 DSH 写的是 zstd 压缩的多帧追加文件（session.v4.jsonl.zstd）：
 * node:zlib 的 zstdDecompressSync 只解出第一帧就返回，整文件解压只能拿到会话头，因此按魔数
 * 偏移逐帧解压再拼接。zstd API 需要 Node 的 zlib zstd 支持（Node 22.15+ / 23.8+；本仓库
 * engines 允许 ^22.19.0 || >=24.0.0）。非 .zstd 的明文 jsonl 直接按 utf8 读，兼容未来换成
 * 明文持久化的情况。
 */
function decodeSessionFile(file: string): string {
  const buf = fs.readFileSync(file)
  if (file.endsWith('.zstd') === false) return buf.toString('utf8')
  if (typeof zlib.zstdDecompressSync !== 'function') return ''
  const parts: string[] = []
  let at = buf.indexOf(ZSTD_MAGIC, 0)
  while (at >= 0) {
    try { parts.push(String(zlib.zstdDecompressSync(buf.subarray(at)))) } catch { /* 该偏移不是帧起点 */ }
    at = buf.indexOf(ZSTD_MAGIC, at + 1)
  }
  return parts.join('')
}

/** 把消息内容里的文本段拼起来；内容本身是字符串时直接用。 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let joined = ''
  for (const part of content) {
    const item = part as { type?: unknown; text?: unknown }
    if (item.type === 'text' && typeof item.text === 'string') joined += item.text
  }
  return joined
}

interface RulesContextHit { file: string; line: number; form: string; text: string }

/** 从会话持久化里取 type === 'user/message' 且 data.source.kind === 'rules-context' 的消息。 */
function collectRulesContext(files: string[]): RulesContextHit[] {
  const hits: RulesContextHit[] = []
  for (const file of files) {
    const text = decodeSessionFile(file)
    if (text.length === 0) continue
    const lines = text.split(NL)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (line.trim().length === 0) continue
      let parsed: unknown
      try { parsed = JSON.parse(line) } catch { continue }
      const record = parsed as { type?: unknown; data?: { source?: { kind?: unknown; form?: unknown }; content?: unknown } }
      if (record.type !== 'user/message') continue
      const source = record.data?.source
      if (source === undefined || source.kind !== 'rules-context') continue
      hits.push({
        file,
        line: i + 1,
        form: typeof source.form === 'string' ? source.form : '',
        text: contentText(record.data?.content),
      })
    }
  }
  return hits
}

/** 从 stub 记录的请求体里取出模型实际看到的那份 <rules> 正文（即父代输入）。 */
function modelVisibleRulesText(body: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return '' }
  const messages = (parsed as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return ''
  for (const entry of messages) {
    const message = entry as { role?: unknown; content?: unknown }
    if (message.role !== 'user') continue
    const text = contentText(message.content)
    if (text.indexOf(RULES_OPEN) === 0) return text
  }
  return ''
}

// -------------------------------------------------------------- 去本机路径

/**
 * 一段路径在持久化文本里的真实写法可能与本进程拿到的字面量不同：会话是在自己的进程里读目录的，
 * 它写下的是解析后的长路径，而本进程的 os.tmpdir() 在 Windows 上可能是 8.3 短名
 * （%TEMP% 为短名时 os.tmpdir() 就返回短名）。因此这里把两种写法都收进来：字面量本身，
 * 加上 realpath 解析后的长形式；每种再按两种路径分隔符各展开一次。少一种写法就会漏掉本机路径。
 */
function pathSpellings(target: string): string[] {
  const spellings: string[] = []
  const add = (value: string): void => {
    if (value.length === 0) return
    for (const candidate of [value, value.split(BS).join('/'), value.split('/').join(BS)]) {
      if (candidate.length > 0 && spellings.indexOf(candidate) < 0) spellings.push(candidate)
    }
  }
  add(target)
  try { add(fs.realpathSync.native(target)) } catch { /* 路径可能已被清理，字面量仍然够用 */ }
  return spellings
}

/** 把临时目录前缀换成稳定占位；比对时对新读回的值做同一套替换。 */
function normalize(text: string, pairs: Array<[string, string]>): string {
  let result = text
  for (const [from, to] of pairs) {
    for (const spelling of pathSpellings(from)) result = result.split(spelling).join(to)
  }
  return result
}

// ------------------------------------------------------------ 规范化与比对

/** 递归按键名排序，让状态文件的比对不受字段顺序影响。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) sorted[key] = canonical(source[key])
    return sorted
  }
  return value
}

function lineOfOffset(text: string, offset: number): number {
  let line = 0
  const limit = Math.min(offset, text.length)
  for (let i = 0; i < limit; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function contextLines(text: string, offset: number, span: number): string[] {
  const lines = text.split(NL)
  const center = lineOfOffset(text, offset)
  const from = Math.max(0, center - span)
  const to = Math.min(lines.length - 1, center + span)
  const window: string[] = []
  for (let i = from; i <= to; i++) window.push((i + 1) + ': ' + (lines[i] ?? ''))
  return window
}

/** 文本字段逐字比对：不一致时打印第一处不同的偏移与它前后若干行原文。 */
function compareText(label: string, recorded: string, observed: string): void {
  checks++
  if (recorded === observed) { out('  OK   ' + label); return }
  fails++
  out('  BAD  ' + label)
  const limit = Math.min(recorded.length, observed.length)
  let at = 0
  while (at < limit && recorded.charCodeAt(at) === observed.charCodeAt(at)) at++
  out('    第一处不同：字符偏移 ' + String(at) + '（录制 ' + String(recorded.length) + ' 字符，本次 ' + String(observed.length) + ' 字符）')
  if (at === limit) {
    out('    ' + (recorded.length > observed.length ? '本次读数在偏移 ' + String(at) + ' 处就结束了' : '录制在偏移 ' + String(at) + ' 处就结束了'))
  } else {
    out('    录制该处: ' + JSON.stringify(recorded.slice(at, at + 60)))
    out('    本次该处: ' + JSON.stringify(observed.slice(at, at + 60)))
  }
  out('    --- 录制（第一处不同所在行的上下文）---')
  for (const line of contextLines(recorded, at, 3)) out('      ' + line.slice(0, 300))
  out('    --- 本次 ---')
  for (const line of contextLines(observed, at, 3)) out('      ' + line.slice(0, 300))
}

/** 标量字段比对。 */
function compareScalar(label: string, recorded: unknown, observed: unknown): void {
  checks++
  const a = JSON.stringify(recorded) ?? String(recorded)
  const b = JSON.stringify(observed) ?? String(observed)
  if (a === b) { out('  OK   ' + label); return }
  fails++
  out('  BAD  ' + label + '  → 录制=' + a + ' 本次=' + b)
}

// ------------------------------------------------------------------- main

interface SnapshotSession {
  persistedFiles: number
  rulesContextMessages: number
  rulesContextForm: string
  rulesContextLine: number
  modelVisibleRulesText: string
  injectedRulesText: string
}

interface SnapshotRecord {
  schemaVersion: number
  runner: string
  purpose: string[]
  refresh: string
  placeholders: { project: string; dshHome: string; tempRoot: string }
  session: SnapshotSession
  pluginState: unknown
}

const PURPOSE = [
  '官方测试政策第 6 层的插件级对应物：父代提供输入与模型回放，子代是期望的持久结果。',
  '父代（输入）：本地 OpenAI 兼容 stub 的固定回放，加上一次真机 DSH 无头会话里插件注入进模型上下文的 <rules> 块。',
  '子代（持久结果）：一次性 DSH_HOME 里那次会话留下的会话持久化文件，本文件记录从它重新读回的 rules-context 正文。',
  '两侧正文都记在 session 里：modelVisibleRulesText 是模型实际收到的，injectedRulesText 是会话落盘的；两者必须逐字一致。',
  '插件状态文件 state.json 由管理面板写入，无头会话不改写状态，故如实记为 null —— 这条 null 本身就是「无头会话不写状态」的断言。',
  '录制里不含任何本机路径：临时项目目录、一次性 DSH_HOME 与临时根目录的前缀已替换为占位。',
]

async function main(): Promise<void> {
  section('launcher')
  const launcher = resolveLauncher()
  if (launcher === null) {
    out('SKIPPED: 未找到可用 launcher（DSH_CLI 与 DSH_NODE_EXECUTABLE+DSH_INSTALL_DIR 都不可用）')
    return
  }
  note('source: ' + launcher.label)
  note('command: ' + launcher.command + (launcher.prefix.length > 0 ? ' [electron-as-node]' : ''))

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rules-snapshot-'))
  const home = path.join(base, 'dshhome')
  const tempHome = path.join(base, 'home')
  const project = path.join(base, 'project')
  const stateHome = path.join(home, 'rules-manager')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(tempHome, { recursive: true })
  fs.mkdirSync(stateHome, { recursive: true })
  fs.cpSync(FIXTURE_DIR, project, { recursive: true })
  fs.mkdirSync(path.join(project, '.git'), { recursive: true })

  const installEnv: Record<string, string> = { DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' }
  const sessionEnv: Record<string, string> = {
    DSH_HOME: home,
    HOME: tempHome,
    USERPROFILE: tempHome,
    DSH_RULES_MANAGER_HOME: stateHome,
    ELECTRON_RUN_AS_NODE: '1',
  }
  let stub: Stub | null = null
  try {
    section('profile / plugin 装配（一次性 DSH_HOME）')
    const created = await runLauncher(launcher, ['--profile', PROFILE, '--from-default-profile', 'headless', '--dump-config'], { env: installEnv, timeoutMs: 300000 })
    check('profile 首次使用创建成功（rc=0）', created.status === 0, 'status=' + String(created.status) + ' stderr=' + tailLines(created.stderr, 3))
    const added = await runLauncher(launcher, ['plugin', '--profile', PROFILE, 'add', REPO_ROOT], { env: installEnv, timeoutMs: 420000 })
    check('plugin add 本仓库成功（rc=0）', added.status === 0, 'status=' + String(added.status) + ' stderr=' + tailLines(added.stderr, 3))

    stub = await startStub(STUB_BASE_PORT)
    const overlay = path.join(base, 'overlay.yml')
    fs.writeFileSync(overlay, overlayYaml(stub.port))

    section('录制会话（真机无头会话 + 假模型回放）')
    const started = Date.now()
    const session = await runLauncher(launcher, ['--profile', PROFILE, '--patch', overlay, '--json', 'say SNAPSHOT_PROBE_OK'], {
      cwd: project,
      env: { ...sessionEnv, [KEY_ENV]: KEY_VALUE },
      timeoutMs: 240000,
    })
    const ms = Date.now() - started
    note('session: status=' + String(session.status) + ' signal=' + String(session.signal) + ' timedOut=' + String(session.timedOut) + ' ms=' + String(ms))
    check('会话正常收尾（rc=0）', session.status === 0, 'status=' + String(session.status) + ' stderr=' + tailLines(session.stderr, 3))

    section('子代：重读会话持久化（不看模型自述）')
    const persisted = findPersistedFiles(home)
    note('persisted files: ' + String(persisted.length))
    for (const file of persisted) note('  ' + path.relative(home, file))
    check('一次性 DSH_HOME 里存在会话持久化文件', persisted.length > 0)
    const hits = collectRulesContext(persisted)
    check('持久化里存在 source.kind === "rules-context" 的消息', hits.length > 0, 'messages=' + String(hits.length))
    const first = hits[0] ?? { file: '', line: 0, form: '', text: '' }
    check('rules-context 的 source.form 是 instructions', first.form === 'instructions', 'form=' + first.form)

    // 长的先替换：先换具体子目录，再换临时根，否则子目录会被短路成 <TEMP_ROOT>/... 的残段。
    const placeholderPairs: Array<[string, string]> = [
      [project, PH_PROJECT],
      [stateHome, PH_HOME + '/rules-manager'],
      [home, PH_HOME],
      [base, PH_TEMP],
      [os.tmpdir(), PH_TEMP],
    ]
    const injectedRulesText = normalize(first.text, placeholderPairs)
    const stubRequests = stub.requests()
    const modelVisible = stubRequests.map((r) => modelVisibleRulesText(r.body)).filter((t) => t.length > 0)
    const modelVisibleRulesTextNormalized = normalize(modelVisible[0] ?? '', placeholderPairs)
    note('stub 收到 ' + String(stubRequests.length) + ' 个请求，其中带 <rules> 块的 ' + String(modelVisible.length) + ' 个')
    check('stub 收到的请求里带 <rules> 块', modelVisible.length > 0)
    check('模型可见 <rules> 块与会话落盘正文逐字一致',
      modelVisibleRulesTextNormalized.length > 0 && modelVisibleRulesTextNormalized === injectedRulesText,
      'modelVisible=' + String(modelVisibleRulesTextNormalized.length) + ' persisted=' + String(injectedRulesText.length))
    check('注入块标签成对（<rules> 与 </rules> 各一次）',
      injectedRulesText.split(RULES_OPEN).length - 1 === 1 && injectedRulesText.split(RULES_CLOSE).length - 1 === 1)
    check('注入块里不含任何本机绝对路径（占位替换后）',
      injectedRulesText.indexOf(PH_PROJECT) >= 0 && !/AppData/.test(injectedRulesText) && !/[A-Za-z]:[\/]/.test(injectedRulesText))

    const pluginStateRaw = readPluginStateFile(stateHome)
    const pluginState = pluginStateRaw === null ? null : canonical(JSON.parse(pluginStateRaw))
    note('plugin state.json: ' + (pluginState === null ? 'null（本次会话没有写过）' : '已读出并规范化'))

    const observed: SnapshotRecord = {
      schemaVersion: SCHEMA_VERSION,
      runner: RUNNER_REL,
      purpose: PURPOSE,
      refresh: 'DSH_SNAPSHOT_UPDATE=1 node --experimental-strip-types ' + RUNNER_REL,
      placeholders: { project: PH_PROJECT, dshHome: PH_HOME, tempRoot: PH_TEMP },
      session: {
        persistedFiles: persisted.length,
        rulesContextMessages: hits.length,
        rulesContextForm: first.form,
        rulesContextLine: first.line,
        modelVisibleRulesText: modelVisibleRulesTextNormalized,
        injectedRulesText,
      },
      pluginState,
    }

    section(process.env['DSH_SNAPSHOT_UPDATE'] === '1' ? '写入录制（DSH_SNAPSHOT_UPDATE=1）' : '比对录制')
    if (process.env['DSH_SNAPSHOT_UPDATE'] === '1') {
      fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true })
      fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(observed, null, 2) + NL)
      const bytes = fs.statSync(SNAPSHOT_FILE).size
      note('snapshot: ' + SNAPSHOT_FILE)
      note('size: ' + String(bytes) + ' bytes')
      check('录制文件已写入且非空', bytes > 0, 'bytes=' + String(bytes))
    } else {
      const recorded = readRecorded()
      if (recorded === null) {
        check('录制文件存在且可解析（缺失时用 DSH_SNAPSHOT_UPDATE=1 生成）', false, SNAPSHOT_FILE)
      } else {
        compareScalar('schemaVersion', recorded.schemaVersion, observed.schemaVersion)
        compareScalar('session.persistedFiles', recorded.session.persistedFiles, observed.session.persistedFiles)
        compareScalar('session.rulesContextMessages', recorded.session.rulesContextMessages, observed.session.rulesContextMessages)
        compareScalar('session.rulesContextForm', recorded.session.rulesContextForm, observed.session.rulesContextForm)
        compareScalar('session.rulesContextLine', recorded.session.rulesContextLine, observed.session.rulesContextLine)
        compareText('session.modelVisibleRulesText', recorded.session.modelVisibleRulesText, observed.session.modelVisibleRulesText)
        compareText('session.injectedRulesText', recorded.session.injectedRulesText, observed.session.injectedRulesText)
        if (recorded.pluginState === null || observed.pluginState === null) {
          compareScalar('pluginState', recorded.pluginState, observed.pluginState)
        } else {
          compareText('pluginState', JSON.stringify(recorded.pluginState, null, 2), JSON.stringify(observed.pluginState, null, 2))
        }
      }
    }
  } finally {
    if (stub !== null) await stub.close()
    if (process.env['E2E_KEEP'] === '1') out('  kept temp dir: ' + base)
    else {
      try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }) } catch (err) { note('cleanup warning: ' + String(err)) }
    }
  }
}

/** 读插件状态文件；无头会话不改写状态，取不到就如实返回 null。 */
function readPluginStateFile(stateDir: string): string | null {
  try { return fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8') } catch { return null }
}

/** 读录制文件并补全缺键，键缺失也算作差异而不是崩溃。 */
function readRecorded(): SnapshotRecord | null {
  let raw: string
  try { raw = fs.readFileSync(SNAPSHOT_FILE, 'utf8') } catch { return null }
  try {
    const parsed = JSON.parse(raw) as Partial<SnapshotRecord>
    const session = parsed.session ?? ({} as Partial<SnapshotSession>)
    return {
      schemaVersion: parsed.schemaVersion ?? -1,
      runner: parsed.runner ?? '',
      purpose: parsed.purpose ?? [],
      refresh: parsed.refresh ?? '',
      placeholders: parsed.placeholders ?? { project: PH_PROJECT, dshHome: PH_HOME, tempRoot: PH_TEMP },
      session: {
        persistedFiles: session.persistedFiles ?? -1,
        rulesContextMessages: session.rulesContextMessages ?? -1,
        rulesContextForm: session.rulesContextForm ?? '',
        rulesContextLine: session.rulesContextLine ?? -1,
        modelVisibleRulesText: session.modelVisibleRulesText ?? '',
        injectedRulesText: session.injectedRulesText ?? '',
      },
      pluginState: parsed.pluginState ?? null,
    }
  } catch { return null }
}

main().then(() => {
  out('')
  out('checks: ' + String(checks) + ' 项，通过 ' + String(checks - fails) + ' 项')
  process.exitCode = fails ? 1 : 0
}).catch((err: unknown) => {
  out('FATAL: ' + (err instanceof Error ? err.stack ?? err.message : String(err)))
  process.exitCode = 1
})
