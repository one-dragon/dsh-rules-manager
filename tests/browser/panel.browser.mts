// 第 7 层浏览器快照测试：把 lib/client.js 真正载入本机 Edge/Chrome，让面板在真实 DOM
// 里渲染六份快照（初次渲染、点击 Global 范围页签后、点击 eta 规则开关后、点设置页入口、
// 点侧边栏入口、空工作区变体），并断言开关与入口位置控件真的发出了 POST 写请求、
// 两次同时渲染逐字节一致、且页面零错误。
// 断言什么：模块加载契约（只 require react / react jsx-runtime）、apply() 注册的插槽、
// RulesPanel 的六次真实 DOM、写请求体、同一次运行内两份 innerHTML 完全相同。
// 风格参照 tests/e2e/smoke.mts：只用 node 内置模块，异步 spawn 子进程，自计时 SIGKILL，零凭据。
// 运行：node --experimental-strip-types tests/browser/panel.browser.mts
// 快照：tests/browser/panel.snapshot.html；设置 DSH_BROWSER_UPDATE=1 时改写它，否则只比较。
// SKIPPED 语义：本机既没有 Edge 也没有 Chrome 时打印一行 SKIPPED 并以 0 退出（这一层需要真浏览器）。

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// 入口位置路由的路径与宿主实现共用一份常量；panel.ts 只 import type，可在 strip-types 下直接导入。
import { ENTRY_ROUTE } from '../../src/panel.ts'

const NL = String.fromCharCode(10)
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const HARNESS_PATH = path.join(REPO_ROOT, 'tests', 'browser', 'harness.html')
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'tests', 'browser', 'panel.snapshot.html')
const UPDATE = process.env.DSH_BROWSER_UPDATE === '1'
const REPORT_TIMEOUT_MS = 90000
const BROWSER_TIMEOUT_MS = 90000

let checks = 0
let fails = 0
const out = (line: string): void => { process.stdout.write(line + NL) }
const section = (title: string): void => { out(''); out('== ' + title + ' ==') }
const check = (label: string, ok: boolean, detail = ''): void => {
  checks += 1
  if (!ok) fails += 1
  out((ok ? '  OK   ' : '  FAIL ') + label + (detail === '' ? '' : ' -- ' + detail))
}

// ---------------------------------------------------------------- 浏览器解析

/** Microsoft Edge 的常见安装位置，全部从环境变量拼出来，不写死任何盘符。 */
function edgeCandidates(): string[] {
  const list: string[] = []
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const programFiles = process.env.ProgramFiles
  const localAppData = process.env.LOCALAPPDATA
  if (programFilesX86 !== undefined && programFilesX86 !== '') {
    list.push(path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  if (programFiles !== undefined && programFiles !== '') {
    list.push(path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  if (localAppData !== undefined && localAppData !== '') {
    list.push(path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  list.push('/usr/bin/microsoft-edge')
  list.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
  return list
}

/** Google Chrome / Chromium 的常见安装位置，同样只由环境变量拼成。 */
function chromeCandidates(): string[] {
  const list: string[] = []
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFiles !== undefined && programFiles !== '') {
    list.push(path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  }
  if (programFilesX86 !== undefined && programFilesX86 !== '') {
    list.push(path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  }
  list.push('/usr/bin/google-chrome')
  list.push('/usr/bin/google-chrome-stable')
  list.push('/usr/bin/chromium')
  list.push('/usr/bin/chromium-browser')
  list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  return list
}

/** DSH_BROWSER 优先，然后 Edge，然后 Chrome；都没有时返回 null（上层打印 SKIPPED）。 */
function resolveBrowser(): string | null {
  const configured = process.env.DSH_BROWSER
  if (configured !== undefined && configured !== '') {
    if (fs.existsSync(configured)) return configured
    out('  note  DSH_BROWSER is set but no file exists at ' + configured)
  }
  for (const candidate of edgeCandidates()) if (fs.existsSync(candidate)) return candidate
  for (const candidate of chromeCandidates()) if (fs.existsSync(candidate)) return candidate
  return null
}

// ---------------------------------------------------------------- 固定夹具

interface FixtureRule {
  path: string; name: string; type: string; description: string
  descriptionTokens: number; bodyTokens: number; bodyLength: number
  enabled: boolean; active: boolean; disabledBy: string | null
  sourceKey: string; sourceLabel: string; scope: string; family: string
  patterns: string[]; attached: boolean; diagnostics: unknown[]
}

function rule(over: Partial<FixtureRule> & { path: string; name: string; sourceKey: string; sourceLabel: string; scope: string }): FixtureRule {
  return {
    type: 'always',
    description: 'A rule body that is short enough to keep the snapshot readable.',
    descriptionTokens: 12,
    bodyTokens: 120,
    bodyLength: 480,
    enabled: true,
    active: true,
    disabledBy: null,
    family: over.sourceKey,
    patterns: [],
    attached: false,
    diagnostics: [],
    ...over,
  }
}

// 夹具刻意不写任何盘符：workspace、source 与 rule 的 path 都是仓库相对的写法。
const FIXTURE_RULES: readonly FixtureRule[] = [
  rule({ path: 'repo/.codebuddy/alpha.md', name: 'alpha', sourceKey: 'codebuddy', sourceLabel: 'CodeBuddy', scope: 'project',
    type: 'always', description: 'Project conventions that load on every request.', patterns: ['**/*.ts'] }),
  rule({ path: 'repo/.cursor/rules/beta.mdc', name: 'beta', sourceKey: 'cursor', sourceLabel: 'Cursor', scope: 'project',
    type: 'requested', attached: true, description: 'Frontend conventions, loaded when a matching file is touched.',
    diagnostics: [{ code: 'trigger.unknown', detail: 'globs: [**/*.tsx]', line: 3, kind: 'rule', path: 'repo/.cursor/rules/beta.mdc' }] }),
  rule({ path: 'repo/CLAUDE.md', name: 'gamma', sourceKey: 'claude', sourceLabel: 'Claude Code', scope: 'project',
    type: 'manual', description: 'Never injected; a person asks for it by name.' }),
  rule({ path: 'repo/.trae/rules/delta.md', name: 'delta', sourceKey: 'trae', sourceLabel: 'Trae', scope: 'project',
    enabled: false, active: false, disabledBy: 'frontmatter', description: 'Switched off in the file itself.' }),
  rule({ path: 'repo/.qoder/rules/epsilon.md', name: 'epsilon', sourceKey: 'qoder', sourceLabel: 'Qoder', scope: 'project',
    type: 'requested', active: false, disabledBy: 'source', description: 'Its whole source directory is switched off.' }),
  rule({ path: 'home/.claude/eta.md', name: 'eta', sourceKey: 'claude', sourceLabel: 'Claude Code', scope: 'user',
    type: 'always', description: 'Global rules that load on every request.' }),
  rule({ path: 'home/.codebuddy/zeta.md', name: 'zeta', sourceKey: 'codebuddy', sourceLabel: 'CodeBuddy', scope: 'user',
    type: 'requested', enabled: false, active: false, disabledBy: 'frontmatter', description: 'Global rule switched off in the file.' }),
]

const FIXTURE_SOURCES = [
  { key: 'codebuddy', label: 'CodeBuddy', scope: 'project', path: 'repo/.codebuddy', enabled: true, ruleCount: 1, activeRuleCount: 1 },
  { key: 'cursor', label: 'Cursor', scope: 'project', path: 'repo/.cursor/rules', enabled: true, ruleCount: 1, activeRuleCount: 1 },
  { key: 'claude', label: 'Claude Code', scope: 'project', path: 'repo', enabled: true, ruleCount: 1, activeRuleCount: 1 },
  { key: 'trae', label: 'Trae', scope: 'project', path: 'repo/.trae/rules', enabled: true, ruleCount: 1, activeRuleCount: 0 },
  { key: 'qoder', label: 'Qoder', scope: 'project', path: 'repo/.qoder/rules', enabled: false, ruleCount: 1, activeRuleCount: 0 },
  { key: 'claude', label: 'Claude Code', scope: 'user', path: 'home/.claude', enabled: true, ruleCount: 1, activeRuleCount: 1 },
  { key: 'codebuddy', label: 'CodeBuddy', scope: 'user', path: 'home/.codebuddy', enabled: true, ruleCount: 1, activeRuleCount: 0 },
]

/** scannedAt 固定为 0：面板只在它大于 0 时才渲染本机时间，快照因此与时区无关。 */
const FIXTURE_PAYLOAD = {
  rules: FIXTURE_RULES,
  sources: FIXTURE_SOURCES,
  scannedAt: 0,
  diagnostics: [],
  truncated: false,
  workspace: { path: 'repo', source: 'last-scan' },
  entryLocation: 'both',
}

/** 面板发出的写请求，落到这份文档上，模拟宿主接受并回传新文档。 */
function applyAction(document: Record<string, unknown>, action: Record<string, unknown>): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(document)) as { rules: Array<Record<string, unknown>>; sources: Array<Record<string, unknown>> }
  const scopeMatches = (ruleScope: unknown): boolean => action.scope === undefined || ruleScope === action.scope
  // A location change touches no row at all. The panel reads the answer out of
  // the response document, so the fake host carries it the way the real one does.
  if (action.action === 'setEntry') return { ...next, entryLocation: action.location }
  if (action.action === 'setSource') {
    for (const source of next.sources) {
      if (source.key === action.key && scopeMatches(source.scope)) source.enabled = action.enabled
    }
    for (const item of next.rules) {
      if (item.sourceKey !== action.key || !scopeMatches(item.scope)) continue
      if (action.enabled === false) { item.active = false; item.disabledBy = 'source' }
      else if (item.disabledBy === 'source') { item.active = item.enabled === true; item.disabledBy = item.enabled === true ? null : 'frontmatter' }
    }
    return next as unknown as Record<string, unknown>
  }
  for (const item of next.rules) {
    if (item.sourceKey !== action.key || item.path !== action.path || !scopeMatches(item.scope)) continue
    item.active = action.enabled === true
    item.disabledBy = action.enabled === true ? null : 'state'
  }
  return next as unknown as Record<string, unknown>
}

// ---------------------------------------------------------------- HTTP 服务器

interface ReportedPost { url?: string; body?: string }
interface ReportMeta {
  ua?: string; requires?: string[]; specId?: string; injected?: string[]
  registered?: string[]; secondRender?: string; disposer?: string; entryLocation?: string
}
interface Reported { snapshots?: string[]; posts?: ReportedPost[]; errors?: string[]; meta?: ReportMeta }

/**
 * react/jsx-runtime 只有 CJS 版本、没有 UMD，所以按 UMD 的做法把它包进一个模块作用域：
 * 提供一个只认 react 的 require 与只读的 process.env，然后把 module.exports 挂到 window 上。
 * 用真实实现而不是自写的 createElement 替身，是因为替身一旦把 key 合进 props 就会让 React 报
 * “Each child in a list should have a unique key prop” —— 真实实现按 jsx(type, props, key) 的第三
 * 个参数取 key，行为与打包器注入的调用点完全一致。
 */
const JSX_RUNTIME_HEAD = [
  '(function () {',
  '  var module = { exports: {} };',
  '  var exports = module.exports;',
  '  var process = { env: { NODE_ENV: "development" } };',
  '  function require(name) {',
  '    if (name === "react") return window.React;',
  '    throw new Error("unexpected require: " + name);',
  '  }',
  '',
].join(NL)

const JSX_RUNTIME_TAIL = [
  '',
  '  window.__dshrmJsxRuntime = module.exports;',
  '})();',
  '',
].join(NL)

function jsxRuntimeBody(): string {
  return JSX_RUNTIME_HEAD + readRepoFile(path.join('node_modules', 'react', 'cjs', 'react-jsx-runtime.development.js')) + JSX_RUNTIME_TAIL
}

interface Harness {
  readonly server: Server
  readonly port: number
  readonly reported: Promise<Reported>
  readonly requested: string[]
}

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8')
}

function startHarness(): Promise<Harness> {
  const assets: Record<string, { body: string; type: string }> = {
    '/': { body: readRepoFile(path.join('tests', 'browser', 'harness.html')), type: 'text/html; charset=utf-8' },
    '/client.js': { body: readRepoFile(path.join('lib', 'client.js')), type: 'text/javascript; charset=utf-8' },
    '/react.js': { body: readRepoFile(path.join('node_modules', 'react', 'umd', 'react.development.js')), type: 'text/javascript; charset=utf-8' },
    '/react-dom.js': { body: readRepoFile(path.join('node_modules', 'react-dom', 'umd', 'react-dom.development.js')), type: 'text/javascript; charset=utf-8' },
    '/jsx-runtime.js': { body: jsxRuntimeBody(), type: 'text/javascript; charset=utf-8' },
  }
  let currentDocument = JSON.parse(JSON.stringify(FIXTURE_PAYLOAD)) as Record<string, unknown>
  let currentEntry: unknown = 'both'
  const requested: string[] = []
  let settle: (value: Reported) => void = () => {}
  const reported = new Promise<Reported>((resolve) => { settle = resolve })

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? 'GET'
    const url = request.url ?? '/'
    requested.push(method + ' ' + url)
    const send = (status: number, type: string, body: string): void => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
      response.end(body)
    }
    if (method === 'POST' && url === '/report') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try { settle(JSON.parse(text) as Reported) } catch { settle({ errors: ['the report body was not JSON'] }) }
        send(200, 'application/json; charset=utf-8', '{"ok":true}')
      })
      return
    }
    if (url === '/api/rules-manager/rules.json') {
      if (method === 'POST') {
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        request.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let action: Record<string, unknown> = {}
          try { action = JSON.parse(text) as Record<string, unknown> } catch { action = {} }
          currentDocument = applyAction(currentDocument, action)
          // Kept in step the way the host keeps its two routes in step: whatever
          // the last write stored is what a later read of either route answers.
          if (typeof currentDocument.entryLocation === 'string') currentEntry = currentDocument.entryLocation
          send(200, 'application/json; charset=utf-8', JSON.stringify(currentDocument))
        })
        return
      }
      send(200, 'application/json; charset=utf-8', JSON.stringify(currentDocument))
      return
    }
    if (url === ENTRY_ROUTE) {
      // Always "both". A stored 'sidebar' would make the gate retire the settings
      // entry before the first paint, and the two location clicks below need the
      // control on screen; the layout it produces is a unit test's subject.
      send(200, 'application/json; charset=utf-8', JSON.stringify({ entryLocation: currentEntry }))
      return
    }
    if (url === '/favicon.ico') { send(204, 'text/plain; charset=utf-8', ''); return }
    const asset = assets[url]
    if (asset !== undefined && method === 'GET') { send(200, asset.type, asset.body); return }
    send(404, 'text/plain; charset=utf-8', 'not found')
  })

  return new Promise<Harness>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') { reject(new Error('the harness could not read its own port')); return }
      resolve({ server, port: address.port, reported, requested })
    })
  })
}

// ---------------------------------------------------------------- 子进程与比较

interface BrowserRun { code: number | null; signal: string | null; killed: boolean; stderr: string }

/** 异步 spawn + 自计时 SIGKILL：同步等待会饿死同一事件循环上的 harness 服务器。 */
function launchBrowser(executable: string, url: string, userDataDir: string): { run: Promise<BrowserRun>; stop: () => void } {
  const child = spawn(executable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--user-data-dir=' + userDataDir,
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let killed = false
  const stop = (): void => { killed = true; child.kill('SIGKILL') }
  const run = new Promise<BrowserRun>((resolve) => {
    const timer = setTimeout(stop, BROWSER_TIMEOUT_MS)
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      resolve({ code: null, signal: null, killed, stderr: stderr + NL + String(error.message) })
    })
    child.on('close', (code: number | null, signal: string | null) => {
      clearTimeout(timer)
      resolve({ code, signal, killed, stderr })
    })
  })
  return { run, stop }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for ' + label)), milliseconds)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: Error) => { clearTimeout(timer); reject(error) },
    )
  })
}

const MARKERS = [
  '<!-- SNAPSHOT 1: the panel as first rendered (project scope, every status) -->',
  '<!-- SNAPSHOT 2: after clicking the Global scope tab -->',
  '<!-- SNAPSHOT 3: after switching the eta rule off; the write request is asserted below -->',
  '<!-- SNAPSHOT 4: the empty-workspace variant rendered straight from the RulesPanel export -->',
  '<!-- SNAPSHOT 5: after pressing the Settings entry location; the setEntry write is asserted below -->',
  '<!-- SNAPSHOT 6: after pressing the Sidebar entry location -->',
]

function buildSnapshotFile(snapshots: readonly string[]): string {
  const lines: string[] = []
  lines.push('<!doctype html>')
  lines.push('<!-- Generated by tests/browser/panel.browser.mts. Run with DSH_BROWSER_UPDATE=1 to rewrite it. -->')
  lines.push('<!-- Each section holds one innerHTML of the rendered panel; the sections are compared byte for byte. -->')
  lines.push('<meta charset="utf-8">')
  for (let index = 0; index < snapshots.length; index += 1) {
    lines.push(MARKERS[index] ?? '<!-- SNAPSHOT -->')
    lines.push(snapshots[index] ?? '')
  }
  lines.push('')
  return lines.join(NL)
}

interface Difference { index: number; line: number; expected: string; actual: string }

function firstDifference(expected: string, actual: string): Difference | null {
  const limit = Math.min(expected.length, actual.length)
  let index = -1
  for (let cursor = 0; cursor < limit; cursor += 1) {
    if (expected[cursor] !== actual[cursor]) { index = cursor; break }
  }
  if (index === -1) {
    if (expected.length === actual.length) return null
    index = limit
  }
  const window = (text: string): string =>
    text.slice(Math.max(0, index - 40), index + 40).split(NL).join('<NL>')
  const line = expected.slice(0, index).split(NL).length
  return { index, line, expected: window(expected), actual: window(actual) }
}

// ---------------------------------------------------------------- 主流程

async function main(): Promise<void> {
  section('browser')
  const executable = resolveBrowser()
  if (executable === null) {
    out('SKIPPED: no Edge or Chrome executable was found; set DSH_BROWSER to run this layer.')
    process.exitCode = 0
    return
  }
  out('  browser: ' + executable)
  out('  node:    ' + process.version)
  out('  update:  ' + (UPDATE ? 'yes (the snapshot file will be rewritten)' : 'no (the snapshot file is only compared)'))

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dshrm-browser-'))
  const userDataDir = path.join(tempRoot, 'profile')
  let harness: Harness | null = null
  let stopBrowser: () => void = () => {}
  let browserRun: Promise<BrowserRun> | null = null
  try {
    harness = await startHarness()
    const url = 'http://127.0.0.1:' + String(harness.port) + '/'
    section('harness')
    out('  url: ' + url)
    out('  serving: tests/browser/harness.html, lib/client.js, react + react-dom UMD, the react/jsx-runtime development module')

    const launched = launchBrowser(executable, url, userDataDir)
    stopBrowser = launched.stop
    browserRun = launched.run
    const reported = await withTimeout(harness.reported, REPORT_TIMEOUT_MS, 'the page to POST /report')

    const snapshots = Array.isArray(reported.snapshots) ? reported.snapshots : []
    const errors = Array.isArray(reported.errors) ? reported.errors : []
    const posts = Array.isArray(reported.posts) ? reported.posts : []
    const meta: ReportMeta = reported.meta ?? {}
    const first = snapshots[0] ?? ''
    const second = snapshots[1] ?? ''
    const third = snapshots[2] ?? ''
    const variant = snapshots[3] ?? ''
    const settingsOnly = snapshots[4] ?? ''
    const sidebarOnly = snapshots[5] ?? ''

    section('page assertions')
    check('the page reported no window error and no console.error call', errors.length === 0, errors.join(' | '))
    check('the module loader spec carries the plugin id', meta.specId === '@one-dragon/dsh-rules-manager', String(meta.specId))
    const requires = Array.isArray(meta.requires) ? meta.requires : []
    check('the bundle required only react and react/jsx-runtime',
      requires.length === 2 && requires[0] === 'react' && requires[1] === 'react/jsx-runtime', JSON.stringify(requires))
    const injected = Array.isArray(meta.injected) ? meta.injected : []
    check('apply() injected the four slot names, in registration order',
      injected.slice(0, 4).join(',') === 'settings.section,settings.section.icon,sidebar.panellist,main', injected.join(','))
    // The names, not the entries: a slot whose service changes runs its inject
    // callback again, and each name is still meant to appear once in this list.
    check('the inject list is those four names and nothing else', injected.length === 4, String(injected.length))
    check('the gate left both entries in place for a host that stores both',
      String(meta.entryLocation) === 'both', String(meta.entryLocation))
    const registered = Array.isArray(meta.registered) ? meta.registered : []
    check('apply() registered a component for the panel slots',
      registered.includes('settings.section') && registered.includes('main') && registered.includes('sidebar.panellist'), registered.join(','))
    check('apply() returned a disposer function', meta.disposer === 'function', String(meta.disposer))
    check('six snapshots were reported', snapshots.length === 6, String(snapshots.length))
    check('every snapshot contains the panel root',
      [first, second, third, variant, settingsOnly, sidebarOnly].every((text) => text.includes('dshrm-panel')),
      [first, second, third, variant, settingsOnly, sidebarOnly].map((text) => String(text.length)).join(','))
    // One occurrence of the attribute: exactly one of the three buttons is
    // pressed, whatever the location is - 'both' describes the host layout, not
    // a third pressed button.
    check('the rendered panel carries the three-location control',
      first.includes('class="dshrm-entry"') && first.includes('dshrm-entry-btn on')
      && first.split('aria-pressed="true"').length === 2, 'entry control')
    check('the settings-only variant presses Settings alone',
      settingsOnly.includes('dshrm-entry-btn on') && settingsOnly.split('aria-pressed="true"').length === 2, String(settingsOnly.length))
    check('the sidebar-only variant presses Sidebar alone',
      sidebarOnly.includes('dshrm-entry-btn on') && sidebarOnly.split('aria-pressed="true"').length === 2, String(sidebarOnly.length))
    check('the two location clicks changed the markup', settingsOnly !== sidebarOnly && sidebarOnly !== third)
    check('snapshot 1 carries every project rule name',
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].every((name) => first.includes('>' + name + '<')), first.length.toString())
    check('snapshot 1 keeps the user tier out of the project scope',
      !first.includes('data-rule="home/.claude/eta.md"') && first.includes('data-rule="repo/.codebuddy/alpha.md"'), 'project tier')
    check('snapshot 2 carries both user-tier rule names',
      second.includes('data-rule="home/.claude/eta.md"') && second.includes('data-rule="home/.codebuddy/zeta.md"'), 'user tier')
    check('snapshot 1 marks the attached on-demand rule',
      first.includes('dshrm-type is-attached') && first.includes('data-rule="repo/.cursor/rules/beta.mdc"'), 'beta row')
    check('snapshot 1 renders the frontmatter-disabled rule as off',
      first.includes('dshrm-row dshrm-off" data-rule="repo/.trae/rules/delta.md"'), 'delta row')
    check('snapshot 1 renders the rule of a switched-off source as off',
      first.includes('dshrm-row dshrm-off" data-rule="repo/.qoder/rules/epsilon.md"'), 'epsilon row')
    check('snapshot 1 shows the project rule and the source path',
      first.includes('data-rule="repo/.codebuddy/alpha.md"') && first.includes('repo/.cursor/rules'), 'paths')
    check('the scope tab click changed the markup', first !== second && second.length > 0)
    check('snapshot 2 shows the user tier and drops the project rows',
      second.includes('data-rule="home/.claude/eta.md"') && !second.includes('data-rule="repo/.codebuddy/alpha.md"'), 'user tier')
    check('snapshot 3 differs from snapshot 2 after the switch click', third !== second && third.length > 0)
    check('the eta row is off in snapshot 3',
      third.includes('dshrm-row dshrm-off" data-rule="home/.claude/eta.md"'), 'eta row')
    // The switch is the first write on this page; the location control adds two
    // more afterwards, so the last request is no longer the one under test.
    const togglePost = posts.length > 0 ? posts[0] : undefined
    let action: Record<string, unknown> = {}
    if (togglePost !== undefined && typeof togglePost.body === 'string') {
      try { action = JSON.parse(togglePost.body) as Record<string, unknown> } catch { action = {} }
    }
    // Every write on this page - the switch, then the two location clicks - goes
    // to the catalog route. Nothing else writes at all.
    check('the switch sent exactly one write request, and the location control two',
      posts.length === 3, String(posts.length))
    check('every write request targets the rules route',
      posts.every((post) => typeof post.url === 'string' && post.url.includes('/api/rules-manager/rules.json')),
      posts.map((post) => String(post.url)).join(' | '))
    const locationPost = posts.length > 0 ? posts[posts.length - 1] : undefined
    let locationChange: Record<string, unknown> = {}
    if (locationPost !== undefined && typeof locationPost.body === 'string') {
      try { locationChange = JSON.parse(locationPost.body) as Record<string, unknown> } catch { locationChange = {} }
    }
    check('the location control writes the location it pressed, and only that',
      locationChange.action === 'setEntry' && locationChange.location === 'sidebar'
      && locationChange.key === undefined && locationChange.path === undefined, String(locationPost?.body))
    check('the write request is the setRule action of the clicked row',
      action.action === 'setRule' && action.key === 'claude' && action.path === 'home/.claude/eta.md'
      && action.enabled === false && action.scope === 'user',
      String(togglePost?.body))
    check('two simultaneous renders of the same panel are byte identical',
      typeof meta.secondRender === 'string' && meta.secondRender === first && first.length > 0,
      String(first.length) + ' vs ' + String((meta.secondRender ?? '').length))
    check('the empty-workspace variant words the missing workspace',
      variant.includes('No workspace could be determined') && !variant.includes('data-rule='), 'variant')

    section('snapshots')
    for (let index = 0; index < snapshots.length; index += 1) {
      const text = snapshots[index] ?? ''
      out('  snapshot ' + String(index + 1) + ': ' + String(Buffer.byteLength(text, 'utf8')) + ' bytes, ' + String(text.length) + ' characters')
    }
    out('  requests served: ' + String(harness.requested.length) + ' (' + harness.requested.slice(0, 6).join(', ') + ')')

    section('snapshot file')
    const produced = buildSnapshotFile(snapshots)
    out('  produced: ' + String(Buffer.byteLength(produced, 'utf8')) + ' bytes')
    if (UPDATE) {
      fs.writeFileSync(SNAPSHOT_PATH, produced, 'utf8')
      out('  wrote: ' + SNAPSHOT_PATH)
      check('the snapshot file was written', fs.existsSync(SNAPSHOT_PATH))
    } else if (!fs.existsSync(SNAPSHOT_PATH)) {
      check('the snapshot file exists', false, 'missing; rerun with DSH_BROWSER_UPDATE=1 to create it')
    } else {
      const expected = fs.readFileSync(SNAPSHOT_PATH, 'utf8')
      out('  on disk:  ' + String(Buffer.byteLength(expected, 'utf8')) + ' bytes')
      const difference = firstDifference(expected, produced)
      if (difference === null) {
        check('the rendered panel matches the stored snapshot byte for byte', true)
      } else {
        check('the rendered panel matches the stored snapshot byte for byte', false,
          'first difference at byte ' + String(difference.index) + ' (file line ' + String(difference.line) + ')')
        out('  expected: ' + difference.expected)
        out('  actual:   ' + difference.actual)
      }
    }
  } finally {
    stopBrowser()
    if (harness !== null) harness.server.close()
    if (browserRun !== null) await browserRun
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (error) {
  check('the browser layer ran to completion', false, error instanceof Error ? error.message : String(error))
}

out('')
out('checks: ' + String(checks) + ', failures: ' + String(fails))
process.exitCode = fails === 0 ? 0 : 1
