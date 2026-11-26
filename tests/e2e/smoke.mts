/**
 * 真实组合 e2e：用本地 OpenAI 兼容 stub 驱动真实 DSH 无头会话，零凭证。
 * 断言只读 stub 记录的请求原文与 DSH 的 NDJSON 事件流，不读模型自述。
 * 风格参照 tests/integration/real-project.mts；launcher 全部从环境变量推导，不写死任何机器路径。
 * 运行：node --experimental-strip-types tests/e2e/smoke.mts
 * 两个来源都拿不到可用 launcher 时打印 SKIPPED 并以 0 退出。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
const countOf = (hay: string, needle: string): number => hay.split(needle).length - 1
const tailLines = (text: string, n: number): string => text.split(NL).filter((l) => l.trim().length > 0).slice(-n).join(NL)

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'e2e', 'fixture')
const MODEL = 'probe-model'
const KEY_ENV = 'PROBE_KEY'
const KEY_VALUE = 'probe-key-local'
const PROFILE = 'e2e-probe'
const STUB_BASE_PORT = 18391
const RULES_OPEN = '<rules>'
const RULES_CLOSE = '</rules>'
const TRUNC_MARK = '[... rule truncated at 8000 chars]'

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
 * 以 ELECTRON_RUN_AS_NODE=1 让 Electron 二进制按 node 运行该脚本。
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
 * 实测症状：会话停在 step_start 永不前进，stub 连一个 TCP 连接都收不到。
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

// ------------------------------------------------------------------- stub

interface StubEntry { run: string; index: number; bytes: number; body: string }

interface Stub {
  port: number
  beginRun: (run: string, appPath: string) => void
  endRun: () => void
  requests: (run: string) => StubEntry[]
  close: () => Promise<void>
}

const sseChunk = (delta: Record<string, unknown>, finish: string | null): Record<string, unknown> => ({
  id: 'chatcmpl-probe',
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

/** OpenAI 兼容 stub：把每个请求体原样记一行，并按对话阶段返回工具调用或结束语。 */
async function startStub(startPort: number): Promise<Stub> {
  const log: StubEntry[] = []
  let run = 'idle'
  let appPath = ''
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
        log.push({ run, index, bytes: Buffer.byteLength(raw, 'utf8'), body: raw })
        let parsed: Record<string, unknown> | null = null
        try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { parsed = null }
        const messages = Array.isArray(parsed?.['messages']) ? (parsed?.['messages'] as Record<string, unknown>[]) : []
        const tools = Array.isArray(parsed?.['tools']) ? (parsed?.['tools'] as unknown[]) : []
        const usedTool = messages.some((m) => m['role'] === 'assistant' && (m['tool_calls'] !== undefined || m['function_call'] !== undefined))
        const callTool = tools.length > 0 && !usedTool
        const toolArgs = JSON.stringify({ file_path: appPath })
        const stream = parsed?.['stream'] !== false
        if (stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
          const parts: Record<string, unknown>[] = callTool
            ? [
              sseChunk({ role: 'assistant', content: '' }, null),
              sseChunk({ tool_calls: [{ index: 0, id: 'call_probe_1', type: 'function', function: { name: 'read', arguments: toolArgs } }] }, null),
              sseChunk({}, 'tool_calls'),
            ]
            : [sseChunk({ role: 'assistant', content: 'PROBE_DONE' }, null), sseChunk({}, 'stop')]
          for (const part of parts) res.write('data: ' + JSON.stringify(part) + NL + NL)
          res.write('data: [DONE]' + NL + NL)
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        const message: Record<string, unknown> = callTool
          ? { role: 'assistant', content: '', tool_calls: [{ id: 'call_probe_1', type: 'function', function: { name: 'read', arguments: toolArgs } }] }
          : { role: 'assistant', content: 'PROBE_DONE' }
        res.end(JSON.stringify({ id: 'chatcmpl-probe', object: 'chat.completion', created: 1, model: MODEL, choices: [{ index: 0, message, finish_reason: callTool ? 'tool_calls' : 'stop' }] }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"not found"}')
    })
  })
  const port = await listenOn(server, startPort)
  return {
    port,
    beginRun: (name: string, file: string) => { run = name; appPath = file },
    endRun: () => { run = 'idle' },
    requests: (name: string) => log.filter((e) => e.run === name),
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()) }),
  }
}

// -------------------------------------------------------------- 运行目录

interface RuleFile { file: string; text: string }

interface DirSpec { name: string; fromFixture: boolean; rules: RuleFile[]; lockDir?: boolean }

function makeRunDir(base: string, spec: DirSpec): string {
  const dir = path.join(base, 'runs', spec.name)
  const appSource = fs.readFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'utf8')
  if (spec.fromFixture) fs.cpSync(FIXTURE_DIR, dir, { recursive: true })
  else {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), appSource)
  }
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  for (const rule of spec.rules) {
    const target = path.join(dir, '.codebuddy', 'rules', rule.file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rule.text)
  }
  if (spec.lockDir === true && process.platform !== 'win32') {
    const locked = path.join(dir, '.codebuddy', 'rules', 'locked')
    fs.mkdirSync(locked, { recursive: true })
    fs.writeFileSync(path.join(locked, 'hidden.mdc'), '---' + NL + 'description: LOCKED_DIR_RULE' + NL + 'alwaysApply: true' + NL + '---' + NL + NL + 'LOCKED_BODY' + NL)
    try { fs.chmodSync(locked, 0o000) } catch { /* 平台不支持时忽略，下面会显式报告 */ }
  }
  return dir
}

function overlayYaml(port: number, disabled: boolean): string {
  const lines = [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      localprobe:',
    '        apiKeyEnv: ' + KEY_ENV,
    '        api: openai-completions',
    '        baseURL: http://127.0.0.1:' + port + '/v1',
    '        models:',
    '          - id: ' + MODEL,
    '- id: agent-default-model',
    '  config:',
    '    provider: localprobe',
    '    model: ' + MODEL,
  ]
  if (disabled) lines.push('- id: rules-manager', '  disabled: true')
  return lines.join(NL) + NL
}

interface SessionResult { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string; ms: number }

async function runSession(l: Launcher, stub: Stub, runName: string, dir: string, overlay: string, baseEnv: Record<string, string>, timeoutMs: number): Promise<SessionResult> {
  stub.beginRun(runName, path.join(dir, 'src', 'app.ts'))
  const started = Date.now()
  const r = await runLauncher(l, ['--profile', PROFILE, '--patch', overlay, '--json', 'say PROBE_OK'], {
    cwd: dir,
    env: { ...baseEnv, ELECTRON_RUN_AS_NODE: '1', [KEY_ENV]: KEY_VALUE },
    timeoutMs,
  })
  const ms = Date.now() - started
  stub.endRun()
  const err = r.spawnError.length > 0 ? r.spawnError + NL + r.stderr : r.stderr
  return { status: r.status, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout, stderr: err, ms }
}

function rulesBlockOf(body: string): string {
  const i = body.indexOf(RULES_OPEN)
  const j = body.indexOf(RULES_CLOSE)
  if (i < 0 || j < i) return ''
  return body.slice(i, j + RULES_CLOSE.length)
}

function reportRequests(label: string, entries: StubEntry[]): void {
  note(label + ': ' + entries.length + ' 个请求')
  for (const e of entries) {
    const block = rulesBlockOf(e.body)
    note('  request[' + e.index + '] ' + e.bytes + ' bytes' + (block.length > 0 ? '  [rules ' + block.length + ' chars]' : '  [no rules]'))
  }
}

function failureDetail(r: SessionResult): string {
  const bits: string[] = []
  bits.push('status=' + String(r.status))
  if (r.signal !== null) bits.push('signal=' + r.signal)
  if (r.timedOut) bits.push('timedOut')
  if (r.stderr.trim().length > 0) bits.push('stderr=' + tailLines(r.stderr, 3))
  return bits.join(' | ')
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

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rules-e2e-'))
  const home = path.join(base, 'dshhome')
  const tempHome = path.join(base, 'home')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(tempHome, { recursive: true })
  const installEnv: Record<string, string> = { DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' }
  const sessionEnv: Record<string, string> = { DSH_HOME: home, HOME: tempHome, USERPROFILE: tempHome, ELECTRON_RUN_AS_NODE: '1' }
  let stub: Stub | null = null
  try {
    section('profile / plugin 装配（一次性 DSH_HOME）')
    note('temp DSH_HOME: ' + home)
    const created = await runLauncher(launcher, ['--profile', PROFILE, '--from-default-profile', 'headless', '--dump-config'], { env: installEnv, timeoutMs: 300000 })
    check('profile 首次使用创建成功（rc=0）', created.status === 0, 'status=' + String(created.status) + ' stderr=' + tailLines(created.stderr ?? '', 3))
    const added = await runLauncher(launcher, ['plugin', '--profile', PROFILE, 'add', REPO_ROOT], { env: installEnv, timeoutMs: 420000 })
    check('plugin add 本仓库成功（rc=0）', added.status === 0, 'status=' + String(added.status) + ' stderr=' + tailLines(added.stderr ?? '', 3))
    const pnpmLine = (added.stdout ?? '').split(NL).concat((added.stderr ?? '').split(NL)).find((l) => l.toLowerCase().indexOf('pnpm') >= 0)
    if (pnpmLine !== undefined) note('pnpm: ' + pnpmLine.trim())
    const dumped = await runLauncher(launcher, ['--profile', PROFILE, '--dump-config'], { env: installEnv, timeoutMs: 300000 })
    const dumpText = (dumped.stdout ?? '') + (dumped.stderr ?? '')
    check('dump-config 里出现 dsh-rules-manager 两次', countOf(dumpText, 'dsh-rules-manager') >= 2, 'count=' + String(countOf(dumpText, 'dsh-rules-manager')))

    stub = await startStub(STUB_BASE_PORT)
    out('  stub port: ' + stub.port)
    const overlay = path.join(base, 'overlay.yml')
    const overlayOff = path.join(base, 'overlay-disabled.yml')
    fs.writeFileSync(overlay, overlayYaml(stub.port, false))
    fs.writeFileSync(overlayOff, overlayYaml(stub.port, true))

    section('注入运行（默认启用）')
    const injectDir = makeRunDir(base, { name: 'inject', fromFixture: true, rules: [] })
    const inject = await runSession(launcher, stub, 'inject', injectDir, overlay, sessionEnv, 240000)
    const injectReqs = stub.requests('inject')
    reportRequests('inject', injectReqs)
    note('inject: ' + inject.ms + ' ms, status=' + String(inject.status))
    const withRules = injectReqs.filter((e) => e.body.indexOf(RULES_OPEN) >= 0)
    const firstBlock = withRules.length > 0 ? rulesBlockOf(withRules[0]!.body) : ''
    const lastEntry = injectReqs.length > 0 ? injectReqs[injectReqs.length - 1]! : null
    const lastBlock = lastEntry === null ? '' : rulesBlockOf(lastEntry.body)
    check('某个请求带 <rules> 开标签', withRules.length > 0, 'requests=' + String(injectReqs.length))
    check('常驻规则正文进入注入块', firstBlock.indexOf('RESIDENT_MARKER_ALPHA') >= 0)
    check('按需规则只给描述（目录行）', firstBlock.indexOf('ONDEMAND_DESCRIPTION_MARKER') >= 0)
    check('按需规则正文未进入注入块', firstBlock.indexOf('ONDEMAND_BODY_MARKER_BETA') < 0)
    check('注入块标签成对（<rules> 与 </rules> 各一次）', countOf(lastBlock, RULES_OPEN) === 1 && countOf(lastBlock, RULES_CLOSE) === 1, 'len=' + String(lastBlock.length))
    check('工具续跑后的请求仍带同一份注入块', lastBlock.length > 0 && lastBlock === firstBlock, 'first=' + String(firstBlock.length) + ' last=' + String(lastBlock.length))
    note('  （此同块现象来自 host 的 pre-step 空声明批次：src/inject.ts 在此返回 skip 原因 no-claim，续跑沿用已声明块，属 host 对齐，非插件缺陷）')
    const toolResultLine = inject.stdout.split(NL).find((l) => (l.indexOf('tool_result') >= 0 || l.indexOf('tool-result') >= 0) && l.indexOf('completed') >= 0 && l.indexOf('app.ts') >= 0)
    const contentEcho = injectReqs.some((e, i) => i > 0 && e.body.indexOf('APP_MARKER_GAMMA') >= 0)
    check('事件流里有 read 的 tool_result 且 status=completed', toolResultLine !== undefined || contentEcho, '未匹配到事件行，且续跑请求里也没有夹具正文')
    check('会话正常收尾（rc=0）', inject.status === 0, failureDetail(inject))
    out('  raw tail (inject stdout):')
    for (const line of tailLines(inject.stdout, 12).split(NL)) out('    ' + line.slice(0, 400))

    section('对照运行（rules-manager disabled）')
    const offDir = makeRunDir(base, { name: 'control', fromFixture: true, rules: [] })
    const off = await runSession(launcher, stub, 'control', offDir, overlayOff, sessionEnv, 240000)
    const offReqs = stub.requests('control')
    reportRequests('control', offReqs)
    check('对照运行全程没有 <rules>', offReqs.every((e) => e.body.indexOf(RULES_OPEN) < 0), 'hits=' + String(offReqs.reduce((n, e) => n + countOf(e.body, RULES_OPEN), 0)))
    check('对照运行正常收尾（rc=0）', off.status === 0, failureDetail(off))

    section('对抗性输入')
    const broken = '---' + NL + 'description: BROKEN_FRONTMATTER 未闭合的 frontmatter' + NL + NL + 'BROKEN_BODY' + NL
    const residentHostile = '---' + NL + 'description: HOSTILE_RESIDENT' + NL + 'alwaysApply: true' + NL + '---' + NL + NL + 'HOSTILE_RESIDENT_BODY' + NL
    const unreadable = makeRunDir(base, { name: 'hostile-unreadable', fromFixture: false, rules: [{ file: 'broken.mdc', text: broken }, { file: 'resident.mdc', text: residentHostile }], lockDir: true })
    const h1 = await runSession(launcher, stub, 'hostile-unreadable', unreadable, overlay, sessionEnv, 240000)
    const h1Reqs = stub.requests('hostile-unreadable')
    reportRequests('hostile-unreadable', h1Reqs)
    const h1Block = h1Reqs.length > 0 ? rulesBlockOf(h1Reqs[0]!.body) : ''
    if (process.platform === 'win32') note('不可读目录子用例跳过：Windows 的 chmod 000 不阻止读取（POSIX 才生效）')
    else check('POSIX 下 chmod 000 的规则目录没有破坏注入', h1Block.length > 0 && countOf(h1Block, RULES_OPEN) === 1 && countOf(h1Block, RULES_CLOSE) === 1, 'len=' + String(h1Block.length))
    check('未闭合 frontmatter + 不可读目录：会话仍收尾（rc=0）', h1.status === 0, failureDetail(h1))
    check('未闭合 frontmatter + 不可读目录：事件流非空', h1.stdout.trim().length > 0)

    const globRule = '---' + NL + 'description: CATASTROPHIC_GLOB 灾难性 glob' + NL + 'alwaysApply: true' + NL + 'paths:' + NL + '  - ' + "'*a*a*a*a*a*a*a*a*a*.ts'" + NL + '---' + NL + NL + 'CATASTROPHIC_GLOB_BODY' + NL
    const globDir = makeRunDir(base, { name: 'hostile-glob', fromFixture: false, rules: [{ file: 'glob.mdc', text: globRule }] })
    fs.writeFileSync(path.join(globDir, 'src', 'aaaaaaa.ts'), 'export const AAA = 1' + NL)
    const h2 = await runSession(launcher, stub, 'hostile-glob', globDir, overlay, sessionEnv, 240000)
    const h2Reqs = stub.requests('hostile-glob')
    reportRequests('hostile-glob', h2Reqs)
    check('灾难性 glob：会话在宽松时限内收尾（rc=0）', h2.status === 0 && h2.ms < 180000, failureDetail(h2) + ' ms=' + String(h2.ms))
    check('灾难性 glob：注入块仍然成对', h2Reqs.every((e) => { const b = rulesBlockOf(e.body); return b.length === 0 || (countOf(b, RULES_OPEN) === 1 && countOf(b, RULES_CLOSE) === 1) }))

    const emptyDir = makeRunDir(base, { name: 'empty-project', fromFixture: false, rules: [] })
    const h3 = await runSession(launcher, stub, 'empty-project', emptyDir, overlay, sessionEnv, 240000)
    const h3Reqs = stub.requests('empty-project')
    reportRequests('empty-project', h3Reqs)
    check('没有任何规则文件的空项目：会话收尾（rc=0）', h3.status === 0, failureDetail(h3))
    check('没有任何规则文件的空项目：不出现 <rules>', h3Reqs.every((e) => e.body.indexOf(RULES_OPEN) < 0))

    const longBody = 'LONG_HEAD_DELTA' + NL + 'L'.repeat(19900) + NL + 'LONG_TAIL_EPSILON' + NL
    const longRule = '---' + NL + 'description: LONG_RULE 超长正文' + NL + 'alwaysApply: true' + NL + '---' + NL + NL + longBody
    const longDir = makeRunDir(base, { name: 'long-rule', fromFixture: false, rules: [{ file: 'long.mdc', text: longRule }] })
    const h4 = await runSession(launcher, stub, 'long-rule', longDir, overlay, sessionEnv, 240000)
    const h4Reqs = stub.requests('long-rule')
    reportRequests('long-rule', h4Reqs)
    const h4Block = h4Reqs.length > 0 ? rulesBlockOf(h4Reqs[0]!.body) : ''
    check('20000 字超长规则：头部进入注入块', h4Block.indexOf('LONG_HEAD_DELTA') >= 0)
    check('20000 字超长规则：按 perRuleMax 截断并带标记', h4Block.indexOf(TRUNC_MARK) >= 0, 'len=' + String(h4Block.length))
    check('20000 字超长规则：正文尾部没有整段泄漏', h4Block.indexOf('LONG_TAIL_EPSILON') < 0)
    check('超长规则会话收尾（rc=0）', h4.status === 0, failureDetail(h4))
  } finally {
    if (stub !== null) await stub.close()
    if (process.env['E2E_KEEP'] === '1') out('  kept temp dir: ' + base)
    else {
      for (const rel of ['runs/hostile-unreadable/.codebuddy/rules/locked']) {
        const locked = path.join(base, rel)
        try { if (fs.existsSync(locked)) fs.chmodSync(locked, 0o755) } catch { /* 忽略：仅用于让清理能删掉只读目录 */ }
      }
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
