/**
 * 面板截图：把真面板渲染进真浏览器，产出 README 与详情页要用的 PNG。
 *
 * 与 tests/browser/panel.browser.mts 的分工：那条车道是**快照断言**（把 DOM 存成文本、
 * 逐字节比对、不产图）；这条只负责**出图**。两者共用同一份真 bundle（lib/client.js）
 * 与同一套「假宿主」思路，互不依赖：截图脚本挂掉不该让断言车道变红，反过来也一样。
 *
 * 为什么要有它：README 之前放的是 docs/preview.svg —— 一张手画的灰块，看不出插件到底
 * 长什么样。这里的每个像素都来自 lib/client.js 在真 DOM 里的渲染结果；规则数据是造的
 * （不读也不写本机任何规则文件），界面、文案、布局、主题色全部是真的。
 *
 * 用法：node --experimental-strip-types scripts/panel-shot.mts
 * 产物：docs/panel.png（浅色）、docs/panel-dark.png（深色）。
 * 环境变量：DSH_BROWSER 指定浏览器可执行文件；DSH_SHOT_WIDTH 逻辑宽度（默认 880）；
 *           DSH_SHOT_SCALE 像素密度（默认 1.5：正文清晰，单张约 160 KB；2 会让每张涨到约 500 KB）。
 * 找不到浏览器时打印 SKIPPED 并以 0 退出：没有浏览器的机器不该让这条流程变红。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const OUT_DIR = join(ROOT, 'docs')
const WIDTH = Number.parseInt(process.env['DSH_SHOT_WIDTH'] ?? '880', 10)
const SCALE = Number.parseFloat(process.env['DSH_SHOT_SCALE'] ?? '1.5')
const BROWSER_TIMEOUT_MS = 90_000
// String.fromCharCode 而不是转义写法：这个文件本身要被拼进别的程序里，少一类转义少一类坑。
const NL = String.fromCharCode(10)

function log(line: string): void {
  process.stdout.write(line + NL)
}

function readRepoFile(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

// ------------------------------------------------------------------ 浏览器与端口

/** 常见 Edge 安装位置；只用环境变量与固定目录拼，不猜盘符。 */
function edgeCandidates(): string[] {
  const roots = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles'], process.env['LOCALAPPDATA']]
    .filter((root): root is string => typeof root === 'string' && root !== '')
  return [
    ...roots.map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    '/usr/bin/microsoft-edge',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
}

/** 常见 Chrome 安装位置。 */
function chromeCandidates(): string[] {
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']]
    .filter((root): root is string => typeof root === 'string' && root !== '')
  return [
    ...roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
}

/** DSH_BROWSER 优先，其次 Edge，再其次 Chrome；都没有返回 null。 */
function resolveBrowser(): string | null {
  const explicit = process.env['DSH_BROWSER']
  if (typeof explicit === 'string' && explicit !== '') return explicit
  for (const candidate of [...edgeCandidates(), ...chromeCandidates()]) {
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      // 该位置没有浏览器，试下一个。
    }
  }
  return null
}

/** 让系统分配一个空闲端口：多条车道同时跑时不该抢同一个调试端口。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createTcpServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') { probe.close(); reject(new Error('no free port')); return }
      const port = address.port
      probe.close(() => resolve(port))
    })
  })
}

// ------------------------------------------------------------------ CDP 客户端

interface CdpEnvelope {
  id?: number
  result?: Record<string, unknown>
  error?: { message?: string }
}

interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  close(): void
}

/** 一个只够用的小 CDP 客户端：发一条、等它的 id 回来。 */
function connectCdp(url: string): Cdp {
  const socket = new WebSocket(url)
  const pending = new Map<number, (value: Record<string, unknown>) => void>()
  const failing = new Map<number, (error: Error) => void>()
  let nextId = 1
  const opened = new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('the debugger socket could not be opened'))
  })
  socket.onmessage = (event: MessageEvent) => {
    const text = typeof event.data === 'string' ? event.data : ''
    if (text === '') return
    const envelope = JSON.parse(text) as CdpEnvelope
    if (envelope.id === undefined) return
    const done = pending.get(envelope.id)
    const fail = failing.get(envelope.id)
    pending.delete(envelope.id)
    failing.delete(envelope.id)
    if (envelope.error !== undefined) { fail?.(new Error(envelope.error.message ?? 'cdp error')); return }
    done?.(envelope.result ?? {})
  }
  const send = async (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    await opened
    const id = nextId
    nextId += 1
    const answer = new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, resolve)
      failing.set(id, reject)
    })
    socket.send(JSON.stringify({ id, method, params: params ?? {} }))
    return answer
  }
  return { send, close: () => { socket.close() } }
}

// ------------------------------------------------------------------ 主题令牌

/**
 * 截图用的主题样式。
 *
 * 取的是 DSH 真实主题的取值（浅色一套、深色一套），写成面板 CSS 期望的同名变量，
 * 这样 docs 里的图与真机看到的是同一套颜色。品牌色在 DSH 里等于前景色（黑白），
 * 所以这里没有蓝色强调色。
 */
const THEME_CSS = [
  ':root{',
  '  --dsw-alias-bg-layer-1:#f9fafb;',
  '  --dsw-alias-bg-layer-2:#f5f6f7;',
  '  --dsw-alias-border-l1:rgba(0,0,0,.04);',
  '  --dsw-alias-border-l2:rgba(0,0,0,.10);',
  '  --dsw-alias-border-l3:rgba(0,0,0,.12);',
  '  --dsw-alias-brand-primary:#0f1115;',
  '  --dsw-alias-interactive-bg-hover:rgba(38,49,72,.06);',
  '  --dsw-alias-label-on-color:#ffffff;',
  '  --dsw-alias-label-primary:#0f1115;',
  '  --dsw-alias-label-secondary:#61666b;',
  '  --dsw-alias-label-tertiary:#81858c;',
  '  --dsw-alias-state-business-primary:#3b82f6;',
  '  --dsw-alias-state-error-primary:#ec1313;',
  '  --dsw-alias-state-success-primary:#22c55e;',
  '  --dsw-alias-state-warn-primary:#f59e0b;',
  '  --dsw-focus-ring-color:rgba(77,107,254,.55);',
  '  --dsw-focus-ring-width:2px;',
  '  --dsw-radius-lg:16px;',
  '  --dsw-radius-sm:8px;',
  '  --dsw-radius-xs:4px;',
  '  --dsw-shadow-lv1:0 2px 4px 0 rgba(0,0,0,.05);',
  '  --dsw-static-violet-600:#7c3aed;',
  '  --shot-bg:#ffffff;',
  '}',
  'html.dark{',
  '  --dsw-alias-bg-layer-1:#232324;',
  '  --dsw-alias-bg-layer-2:#2c2c2e;',
  '  --dsw-alias-border-l1:rgba(255,255,255,.06);',
  '  --dsw-alias-border-l2:rgba(255,255,255,.10);',
  '  --dsw-alias-border-l3:rgba(255,255,255,.14);',
  '  --dsw-alias-brand-primary:#f9fafb;',
  '  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.08);',
  '  --dsw-alias-label-primary:#f9fafb;',
  '  --dsw-alias-label-secondary:#adb2b8;',
  '  --dsw-alias-label-tertiary:#979da6;',
  '  --dsw-alias-state-business-primary:#60a5fa;',
  '  --dsw-alias-state-error-primary:#f87171;',
  '  --dsw-alias-state-success-primary:#4ade80;',
  '  --dsw-alias-state-warn-primary:#fbbf24;',
  '  --shot-bg:#0f1115;',
  '}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--shot-bg);color:var(--dsw-alias-label-primary);',
  '  font-family:"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif;',
  '  font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}',
  '#shot{width:100%;padding:22px 26px 30px}',
].join(NL)

// ------------------------------------------------------------------ 截图数据

type ShotRule = Record<string, unknown>

function shotRule(over: ShotRule): ShotRule {
  return {
    type: 'requested',
    description: '按需加载的规则：只有描述这一行常驻，正文等模型点名才加载。',
    descriptionTokens: 26,
    bodyTokens: 0,
    bodyLength: 600,
    enabled: true,
    active: true,
    disabledBy: null,
    sourceKey: 'codebuddy',
    sourceLabel: 'CodeBuddy',
    scope: 'project',
    family: 'codebuddy',
    patterns: [],
    attached: false,
    diagnostics: [],
    ...over,
  }
}

const PROJECT = 'D:/project/.codebuddy/rules'

/**
 * 截图用的规则数据。
 *
 * 全是造的：不读本机任何规则文件，也不写任何东西。名字与规模照着一次真机扫描的观感
 * 取（14 条 CodeBuddy 项目规则、1 条常驻、7 条按需、6 条停用、1 条诊断），让图里的
 * 统计卡、页签计数、成本行与卡片内容彼此自洽。
 */
const SHOT_RULES: readonly ShotRule[] = [
  shotRule({ path: PROJECT + '/agent-coding-discipline.md', name: 'agent-coding-discipline', type: 'always',
    description: '约束改码纪律：先读后写、小步提交、不擅自扩大改动面。', descriptionTokens: 24, bodyTokens: 312, bodyLength: 2740,
    patterns: ['**/*.ts', '**/*.tsx'] }),
  shotRule({ path: PROJECT + '/active-memory-recording.md', name: 'active-memory-recording', bodyTokens: 126,
    description: '把本次会话确认过的长期事实记进记忆文件，别等会话结束再补。' }),
  shotRule({ path: PROJECT + '/openspec-superpowers.md', name: 'openspec-superpowers', bodyTokens: 121,
    description: '规格驱动开发的流程约定：先写 spec，再动代码。' }),
  shotRule({ path: PROJECT + '/browser-auth-token-refresh.md', name: 'browser-auth-token-refresh', bodyTokens: 114,
    description: '浏览器里调接口前先确认令牌没有过期。',
    diagnostics: [{ code: 'trigger.unknown', detail: 'trigger: on-file-save', line: 4, kind: 'rule', path: PROJECT + '/browser-auth-token-refresh.md' }] }),
  shotRule({ path: PROJECT + '/browser-auto-close.md', name: 'browser-auto-close', bodyTokens: 96,
    description: '验证完的页面要自己关掉，别把标签页留给用户。' }),
  shotRule({ path: PROJECT + '/browser-no-hmr-testing.md', name: 'browser-no-hmr-testing', bodyTokens: 88,
    description: '热更新后的页面不算验证过，必须整页重载再看一次。' }),
  shotRule({ path: PROJECT + '/browser-verify-navigation.md', name: 'browser-verify-navigation', bodyTokens: 92,
    description: '跳转类改动要用浏览器确认确实落到目标路由。' }),
  shotRule({ path: PROJECT + '/css-standard.md', name: 'css-standard', bodyTokens: 104,
    description: '样式变量优先，避免深层选择器与魔法数字。' }),
  shotRule({ path: PROJECT + '/cleanup-temp-files.md', name: 'cleanup-temp-files', enabled: false, active: false, disabledBy: 'frontmatter', bodyTokens: 74,
    description: '临时文件用完就删，不要留在仓库里。' }),
  shotRule({ path: PROJECT + '/large-file-optimization.md', name: 'large-file-optimization', enabled: false, active: false, disabledBy: 'state', bodyTokens: 132,
    description: '单文件过大时的拆分与懒加载策略。' }),
  shotRule({ path: PROJECT + '/project-conventions.md', name: 'project-conventions', enabled: false, active: false, disabledBy: 'state', bodyTokens: 168,
    description: '本仓库的目录、命名与提交信息约定。' }),
  shotRule({ path: PROJECT + '/tdesign-d2c-agent.md', name: 'tdesign-d2c-agent', enabled: false, active: false, disabledBy: 'frontmatter', bodyTokens: 146,
    description: '设计稿转代码走 TDesign 组件，不手写等价物。' }),
  shotRule({ path: PROJECT + '/ts-standard.md', name: 'ts-standard', enabled: false, active: false, disabledBy: 'source', bodyTokens: 118,
    description: 'TypeScript 严格模式下的写法与禁用项。' }),
  shotRule({ path: PROJECT + '/vite-asset-import.md', name: 'vite-asset-import', enabled: false, active: false, disabledBy: 'source', bodyTokens: 102,
    description: '静态资源的导入方式与构建产物路径。' }),
]

const SHOT_PAYLOAD = {
  rules: SHOT_RULES,
  sources: [{
    key: 'codebuddy',
    label: 'CodeBuddy',
    scope: 'project',
    path: PROJECT,
    enabled: true,
    ruleCount: SHOT_RULES.length,
    activeRuleCount: SHOT_RULES.filter((rule) => rule['active'] === true).length,
  }],
  // 0 而不是真时间：图里因此不出现「扫描于 …」，也不会因为时区或运行时刻而变化。
  scannedAt: 0,
  diagnostics: [],
  truncated: false,
  workspace: { path: 'D:/project', source: 'last-scan' },
  entryLocation: 'both',
}

// ------------------------------------------------------------------ 截图页

/**
 * 截图页：真 bundle、真 DOM、真主题，加一层假宿主。
 *
 * 与 tests/browser/harness.html 的区别是这里不做快照断言，所以不收集 DOM 文本，
 * 只在渲染完成后举一个完成标志，让 CDP 知道可以拍了。
 */
function buildPage(payloadJson: string): string {
  const head = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>dsh-rules-manager panel screenshot</title>',
    '<style>',
    THEME_CSS,
    '</style>',
    '</head>',
    '<body>',
    '<div id="shot"><div id="root"></div></div>',
  ]
  const boot = [
    '<script>',
    'window.__dshrmErrors = []',
    'window.__dshrmShotReady = false',
    'window.__dshrmShotError = ""',
    'window.onerror = function (message, source, line, column) {',
    '  window.__dshrmErrors.push("onerror: " + String(message) + " @ " + String(source) + ":" + String(line) + ":" + String(column))',
    '  return false',
    '}',
    'window.addEventListener("unhandledrejection", function (event) {',
    '  window.__dshrmErrors.push("unhandledrejection: " + String(event.reason))',
    '})',
    'window.__dshrmPayload = ' + payloadJson,
    'window.fetch = function (input, init) {',
    '  var url = typeof input === "string" ? input : (input && input.url ? String(input.url) : String(input))',
    '  var headers = { "content-type": "application/json" }',
    '  if (url.indexOf("/api/rules-manager/entry.json") !== -1) {',
    '    return Promise.resolve(new Response(JSON.stringify({ entryLocation: "both" }), { status: 200, headers: headers }))',
    '  }',
    '  if (url.indexOf("/api/rules-manager/rules.json") !== -1) {',
    '    return Promise.resolve(new Response(JSON.stringify(window.__dshrmPayload), { status: 200, headers: headers }))',
    '  }',
    '  return Promise.resolve(new Response("{}", { status: 404, headers: headers }))',
    '}',
    '</scr' + 'ipt>',
    '<script src="/react.js"></scr' + 'ipt>',
    '<script src="/react-dom.js"></scr' + 'ipt>',
    '<script src="/jsx-runtime.js"></scr' + 'ipt>',
    '<script>',
    'window.__ModuleLoader__ = {',
    '  load: function (spec) {',
    '    window.__dshrmModule = spec.factory(function (name) {',
    '      if (name === "react") return window.React',
    '      if (name === "react/jsx-runtime") return window.__dshrmJsxRuntime',
    '      throw new Error("unexpected require: " + name)',
    '    })',
    '  }',
    '}',
    '</scr' + 'ipt>',
    '<script src="/client.js"></scr' + 'ipt>',
  ]
  const runner = [
    '<script>',
    '(function () {',
    '  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }',
    '  function waitFor(label, timeoutMs, probe) {',
    '    var started = Date.now()',
    '    return new Promise(function (resolve, reject) {',
    '      function tick() {',
    '        var value = false',
    '        try { value = probe() } catch (error) { value = false }',
    '        if (value) { resolve(value); return }',
    '        if (Date.now() - started > timeoutMs) { reject(new Error("timeout waiting for " + label)); return }',
    '        setTimeout(tick, 25)',
    '      }',
    '      tick()',
    '    })',
    '  }',
    '  async function run() {',
    '    var mod = window.__dshrmModule',
    '    if (mod === undefined || mod === null) throw new Error("the client bundle never called __ModuleLoader__.load")',
    '    // 中文界面：locale.bind 命中，面板走的正是宿主翻译那条路。',
    '    var locale = {',
    '      register: function () {},',
    '      bind: function () {',
    '        return function (key) { return mod.TEXT.zh[key] !== undefined ? mod.TEXT.zh[key] : key }',
    '      },',
    '      getSnapshot: function () { return { active: "zh-CN" } }',
    '    }',
    '    var registered = {}',
    '    var fakeCtx = {',
    '      slots: {',
    '        inject: function (name, callback) {',
    '          var result = callback()',
    '          return typeof result === "function" ? result : function () {}',
    '        },',
    '        register: function (definition, component) {',
    '          registered[definition.name] = component',
    '          return function () { delete registered[definition.name] }',
    '        }',
    '      },',
    '      effect: function (callback) {',
    '        var result = callback()',
    '        return typeof result === "function" ? result : function () {}',
    '      },',
    '      get: function (name) { return name === "locale" ? locale : undefined }',
    '    }',
    '    mod.apply(fakeCtx)',
    '    var Panel = registered["settings.section"]',
    '    if (typeof Panel !== "function") throw new Error("the settings.section slot registered no component")',
    '    window.ReactDOM.createRoot(document.getElementById("root")).render(window.React.createElement(Panel))',
    '    await waitFor("the first rule row", 20000, function () {',
    '      return document.getElementById("root").innerHTML.indexOf("agent-coding-discipline") !== -1',
    '    })',
    '    // 统计卡之外还有一次按需目录行的排版，等一拍再拍。',
    '    await sleep(400)',
    '    if (window.__dshrmErrors.length > 0) throw new Error(window.__dshrmErrors[0])',
    '    window.__dshrmShotReady = true',
    '  }',
    '  run().catch(function (error) {',
    '    window.__dshrmShotError = String(error && error.message ? error.message : error)',
    '    if (window.__dshrmErrors.length > 0) window.__dshrmShotError += " | " + window.__dshrmErrors.join(" | ")',
    '  })',
    '})()',
    '</scr' + 'ipt>',
    '</body>',
    '</html>',
  ]
  return [...head, ...boot, ...runner].join(NL) + NL
}

/** react/jsx-runtime 只有 CJS 版本，按 UMD 的做法包一层模块作用域。 */
function jsxRuntimeBody(): string {
  const head = [
    '(function () {',
    '  var module = { exports: {} };',
    '  var exports = module.exports;',
    '  var process = { env: { NODE_ENV: "development" } };',
    '  function require(name) {',
    '    if (name === "react") return window.React;',
    '    throw new Error("unexpected require: " + name);',
    '  }',
    '',
  ]
  const tail = [
    '',
    '  window.__dshrmJsxRuntime = module.exports;',
    '})();',
    '',
  ]
  return head.join(NL) + readRepoFile(join('node_modules', 'react', 'cjs', 'react-jsx-runtime.development.js')) + tail.join(NL)
}

// ------------------------------------------------------------------ HTTP 服务器

interface ShotServer {
  readonly port: number
  readonly stop: () => Promise<void>
}

function startShotServer(page: string): Promise<ShotServer> {
  const assets: Record<string, { body: string; type: string }> = {
    '/': { body: page, type: 'text/html; charset=utf-8' },
    '/client.js': { body: readRepoFile(join('lib', 'client.js')), type: 'text/javascript; charset=utf-8' },
    '/react.js': { body: readRepoFile(join('node_modules', 'react', 'umd', 'react.development.js')), type: 'text/javascript; charset=utf-8' },
    '/react-dom.js': { body: readRepoFile(join('node_modules', 'react-dom', 'umd', 'react-dom.development.js')), type: 'text/javascript; charset=utf-8' },
    '/jsx-runtime.js': { body: jsxRuntimeBody(), type: 'text/javascript; charset=utf-8' },
  }
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    const asset = assets[url]
    if (asset !== undefined) {
      response.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' })
      response.end(asset.body)
      return
    }
    if (url === '/favicon.ico') { response.writeHead(204); response.end(); return }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') { reject(new Error('the shot server could not read its own port')); return }
      resolve({
        port: address.port,
        stop: () => new Promise<void>((done) => { server.close(() => done()) }),
      })
    })
  })
}

// ------------------------------------------------------------------ 主流程

/** 反复问同一个问题，直到它有答案或超时。 */
async function waitForJson<T>(ask: () => Promise<T | null>, ms: number, label: string): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = await ask().catch(() => null)
    if (value !== null) return value
    if (Date.now() - started > ms) throw new Error('timeout waiting for ' + label)
    await sleep(200)
  }
}

async function debuggerTargets(port: number): Promise<Array<Record<string, unknown>>> {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list')
  if (!response.ok) throw new Error('the debugger answered ' + response.status)
  return await response.json() as Array<Record<string, unknown>>
}

async function evaluate<T>(cdp: Cdp, expression: string): Promise<T> {
  const answer = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const box = answer['result'] as { value?: unknown } | undefined
  return box?.value as T
}

interface ShotState { readonly ok?: boolean; readonly error?: string; readonly height?: number }

/** 面板渲染好了没有、有没有出错、现在有多高。 */
function shotState(cdp: Cdp): Promise<ShotState> {
  return evaluate<ShotState>(cdp, [
    '({',
    '  ok: window.__dshrmShotReady === true,',
    '  error: window.__dshrmShotError ? String(window.__dshrmShotError) : "",',
    '  height: Math.ceil(document.getElementById("shot").getBoundingClientRect().height)',
    '})',
  ].join(NL))
}

async function capture(cdp: Cdp, height: number): Promise<Buffer> {
  const answer = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
    clip: { x: 0, y: 0, width: WIDTH, height, scale: SCALE },
  })
  const data = typeof answer['data'] === 'string' ? answer['data'] : ''
  if (data === '') throw new Error('the browser returned no image data')
  return Buffer.from(data, 'base64')
}

async function main(): Promise<void> {
  const browser = resolveBrowser()
  if (browser === null) {
    log('SKIPPED: no Edge or Chrome found; set DSH_BROWSER to point at one')
    return
  }
  log('browser: ' + browser)
  const server = await startShotServer(buildPage(JSON.stringify(SHOT_PAYLOAD)))
  const profileDir = await mkdtemp(join(tmpdir(), 'dshrm-shot-'))
  const debugPort = await freePort()
  const url = 'http://127.0.0.1:' + server.port + '/'
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=' + String(SCALE),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--remote-debugging-port=' + String(debugPort),
    '--user-data-dir=' + profileDir,
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 4000) stderr += chunk.toString('utf8') })
  const killer = setTimeout(() => { child.kill('SIGKILL') }, BROWSER_TIMEOUT_MS)

  let cdp: Cdp | null = null
  try {
    const target = await waitForJson(async () => {
      const targets = await debuggerTargets(debugPort)
      const found = targets.find((item) => String(item['type']) === 'page' && String(item['url']).startsWith(url))
      return found ?? null
    }, 45_000, 'the debugger page target')
    const socketUrl = String(target['webSocketDebuggerUrl'] ?? '')
    if (socketUrl === '') throw new Error('the debugger page target had no socket url')
    cdp = connectCdp(socketUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 1, mobile: false })
    // 缩放交给 clip.scale，而不是 deviceScaleFactor：后者会让固定像素宽度的控件
    // 被当作 CSS 像素重排，输出的版式与真机不同。

    const settled = await waitForJson(async () => {
      const state = await shotState(cdp as Cdp)
      if (state.error !== undefined && state.error !== '') return state
      return state.ok === true ? state : null
    }, 45_000, 'the panel to render')
    if (settled.error !== undefined && settled.error !== '') throw new Error(settled.error)
    const height = Math.max(200, settled.height ?? 0)

    const light = await capture(cdp, height)
    await writeFile(join(OUT_DIR, 'panel.png'), light)
    log('docs/panel.png ' + light.length + ' bytes, ' + WIDTH + 'x' + height + ' css px at ' + SCALE + 'x')

    await evaluate(cdp, 'document.documentElement.classList.add("dark")')
    await sleep(300)
    const darkState = await shotState(cdp)
    const dark = await capture(cdp, Math.max(200, darkState.height ?? height))
    await writeFile(join(OUT_DIR, 'panel-dark.png'), dark)
    log('docs/panel-dark.png ' + dark.length + ' bytes, ' + WIDTH + 'x' + String(darkState.height ?? height) + ' css px at ' + SCALE + 'x')
  } finally {
    clearTimeout(killer)
    cdp?.close()
    child.kill('SIGKILL')
    await server.stop()
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
    if (stderr !== '') log('browser stderr (tail): ' + stderr.split(NL).slice(-3).join(' / '))
  }
}

await main()
