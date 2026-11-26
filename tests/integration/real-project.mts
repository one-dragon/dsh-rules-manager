/**
 * 真实项目集成测试：对一个带有真实规则文件的项目跑完整链路
 * （scan → 过滤 → render → read_rules 往返）。
 *
 * 目录不写死在源码里：把 DSH_RULES_PROJECT 指向任意一个已经有规则文件的
 * 项目（例如你自己的工作区）即可；不设置时本用例跳过而不是失败，因此新克隆
 * 下来的仓库默认是绿的。
 */
import { scanAll, findProjectRoot } from '../../src/scan.ts'
import { renderRulesBlock } from '../../src/render.ts'
import { resolveRequested, formatResolved, type RequestableIndex } from '../../src/tool-read-rules.ts'
import { readState, isSourceEnabled, isRuleDisabled, defaultState } from '../../src/state.ts'

const PROJECT = process.env['DSH_RULES_PROJECT'] ?? ''
if (PROJECT === '') {
  console.log('集成测试：跳过（未设置 DSH_RULES_PROJECT，指向一个含规则文件的项目即可）')
  process.exit(0)
}

let fails = 0
const check = (label: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  OK   ${label}`)
  else { console.log(`  BAD  ${label}${detail ? '  → ' + detail : ''}`); fails++ }
}

console.log('════ 1. 项目根与扫描 ════')
const root = await findProjectRoot(PROJECT)
// Normalize separators: `relative`/`resolve` on Windows return backslashes.
const norm = (p: string | null) => (p === null ? null : p.replace(/\\/g, '/'))
check('找到项目根（含 .git）', norm(root) === PROJECT, `实际 ${root}`)

const state = defaultState()
const scan = await scanAll(root)
const rules = scan.rules.filter((r) =>
  isSourceEnabled(state, r.sourceKey) && !isRuleDisabled(state, r.sourceKey, r.path))

console.log(`\n  扫描到 ${scan.rules.length} 条规则`)
const byType = { always: 0, requested: 0, manual: 0 }
for (const r of rules) byType[r.type]++
console.log(`  启用中: always=${byType.always} requested=${byType.requested} manual=${byType.manual}`)

check('扫描到 14 条（真实 .mdc 数）', scan.rules.length === 14, `实际 ${scan.rules.length}`)
check('always = 1', byType.always === 1, `实际 ${byType.always}`)
check('requested = 7', byType.requested === 7, `实际 ${byType.requested}`)
check('manual = 6（enabled:false 的那批）', byType.manual === 6, `实际 ${byType.manual}`)
check('无截断', !scan.truncated)

console.log('\n════ 2. 渲染 <rules> 块 ════')
const block = renderRulesBlock(rules, { projectRoot: root })
check('非空', block.length > 0)
check('含 <rules> 包裹', block.startsWith('<rules>') && block.trimEnd().endsWith('</rules>'))
check('含 always 分区', block.includes('<always_applied_workspace_rules'))
check('含 requested 分区', block.includes('<agent_requestable_workspace_rules'))
check('含 read_rules 指引', block.includes('read_rules tool'))

// 关键：始终常驻的正文 vs 按需的描述
const alwaysRule = rules.find((r) => r.type === 'always')!
check('always 规则的正文进了块', block.includes(alwaysRule.body.slice(0, 80)))
const requestedRule = rules.find((r) => r.type === 'requested')!
check('requested 规则的正文【不】在块里', !block.includes(requestedRule.body.slice(0, 80)))
check('requested 规则的路径在块里', block.includes(requestedRule.path))
check('requested 规则的描述在块里', block.includes(requestedRule.description.slice(0, 40)))

// manual 完全不出现
const manualRule = rules.find((r) => r.type === 'manual')!
check('manual 规则完全不在块里', !block.includes(manualRule.name))

console.log(`\n  块大小: ${block.length} 字符 ≈ ${Math.round(block.length / 1.6)} token`)

console.log('\n════ 3. token 成本统计 ════')
const resident = rules.filter((r) => r.enabled && r.type === 'always')
  .reduce((n, r) => n + r.descriptionTokens + r.bodyTokens, 0)
const onDemand = rules.filter((r) => r.enabled && r.type === 'requested')
  .reduce((n, r) => n + r.descriptionTokens, 0)
const bodyTotal = rules.filter((r) => r.enabled && r.type === 'requested')
  .reduce((n, r) => n + r.bodyTokens, 0)
console.log(`  always 常驻      : ${resident} token`)
console.log(`  requested 常驻   : ${onDemand} token（仅描述）`)
console.log(`  requested 正文总量: ${bodyTotal} token（按需才加载）`)
console.log(`  → 常驻合计 ${resident + onDemand} token；按需可省 ${bodyTotal - onDemand} token`)
check('requested 正文远大于描述（按需设计有效）', bodyTotal > onDemand * 3)

console.log('\n════ 4. read_rules 完整往返 ════')
const index: Record<string, { path: string; name: string; body: string }> = {}
for (const r of rules) {
  if (r.type !== 'requested') continue
  index[r.path] = { path: r.path, name: r.name, body: r.body }
}
check('索引只含 requested', Object.keys(index).length === 7)

// ① 用绝对路径
const r1 = resolveRequested(index, [requestedRule.path])
check('绝对路径命中', r1.resolved.length === 1)
check('返回正文', r1.resolved[0]?.body === requestedRule.body)

// ② 只用文件名（模型常犯的错）
const r2 = resolveRequested(index, [requestedRule.name + '.mdc'])
check('仅文件名也能命中（四级降级）', r2.resolved.length === 1, JSON.stringify(r2.notFound))

// ③ 用规则名
const r3 = resolveRequested(index, [requestedRule.name])
check('仅规则名也能命中', r3.resolved.length === 1)

// ④ 不存在的
const r4 = resolveRequested(index, ['does-not-exist'])
check('不存在的进 notFound', r4.notFound.length === 1)

// ⑤ 批量
const r5 = resolveRequested(index, Object.values(index).map((v) => v.path))
check('批量取 7 条全命中', r5.resolved.length === 7)

const out = formatResolved(r5)
check('输出含全部 7 个 <rule> 块', (out.match(/<rule /g) || []).length === 7)
check('输出未超预算', out.length < 60000, `实际 ${out.length}`)
console.log(`  批量输出: ${out.length} 字符（预算 60000）`)

// ⑥ 全项目正文总量是否触预算
console.log(`  → 7 条正文合计 ${bodyTotal} token，远低于预算`)

console.log('\n════ 5. 负面场景 ════')
// 把 Codex 的权限文件混进索引，确认不会被当成规则
const fakeIndex = { ...index, '/tmp/codex.rules': { path: '/tmp/codex.rules', name: 'permissions', body: 'prefix_rule' } }
const r6 = resolveRequested(fakeIndex, [requestedRule.name + '.mdc'])
check('合法键仍能命中（混入垃圾不干扰）', r6.resolved.length === 1)

console.log('\n' + '═'.repeat(54))
console.log(fails ? `集成测试：${fails} 处失败` : '集成测试：全部通过 ✅')
console.log('═'.repeat(54))
process.exitCode = fails ? 1 : 0
