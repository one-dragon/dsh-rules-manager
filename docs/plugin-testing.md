# DSH 插件测试：最全的答案

本文件回答一个问题：测一个 DSH 插件，怎么测才算最全。

答案来自两处一手证据，不来自印象：DSH 官方 docs/testing.md 定义的分层与四条硬规矩；19 个真实第三方 DSH 插件仓库的测试实践调研（方法与出处见「证据与复现」一节）。

## 结论

最全 = **官方七层各自就位 + 四条规矩不破 + 每条护栏都能被故意注入的回归弄红**。本仓库把官方第 5 层（Performance benchmarks）单列成表里的一行，因此第五节的就位表是八行；层数口径始终以官方七层为准。

- 没有任何单一层能覆盖全部。官方自己的七层里，单元测试证明不了产品可用，覆盖率证明不了功能正确，无 key 只证明管道通。本仓库那张八行就位表是同一批层的落地视图，不是另一套分层。
- 四条第 2 条还有一条社区共同承认的边界：样本里**没有任何项目**声称自己的 e2e 能证明插件业务正确，只声称证明了**挂载 / 注册 / 契约 / 安装**。dsh-substrate 的原话是 a pass means *the composition mounts*, never *these plugins work*。
- 所以「最全」是按被测对象选层的组合，不是把某一层做到极致。具体选法见「按被测对象选层」。

## 一、官方分层：七层各证明什么

出处：docs/testing.md 的 Tiers 一节（第 9-15 行）。命令是宿主仓库自己的 script 名，插件仓库应按自己的技术栈映射成等价物。

下表就是官方分层本身（七行）。本仓库第五节把官方第 3 层拆成「真机冒烟（零凭据）」与「真机冒烟（带 key 真模型）」两个脚本、并把第 5 层按本仓库命令单列成「基准」一行，所以那里是八行 —— 两表的层一一对应，不是两套口径。

| 层 | 官方命令 | 证明什么 | 要 key |
| --- | --- | --- | --- |
| Unit | pnpm run test | 边缘情况、错误路径、事件顺序、并发竞争，以及**永久的契约回归用例** | 否 |
| **Coverage gate** | pnpm run test:coverage | per-file 100%；官方定位是**找出该死代码**，不是证明功能正确 | 否 |
| Real-API e2e | pnpm run test:e2e | 真模型下的文件写入、多轮对话、工具调用、流中途取消 | **是** |
| Owner-local expected | pnpm run test:expected | 无 key 的组装式 CLI / 进程期望（不起录制会话） | 否 |
| Performance benchmarks | pnpm run test:bench | 时间、堆、伸缩预算，是 Linux PR 门禁 | 否 |
| Snapshot | pnpm run test:snapshot | 录制会话回放：顶层场景录下的父代给输入与模型回放，子代是期望的持久结果 | 否 |
| Web browser snapshot | pnpm run test:web | **真 Chromium**（部分场景 WebKit）判 UI，CI 强制只读回放 | 否 |

三句决定「最全」判据的原文：

1. 覆盖率（第 10 行）：An uncovered line is often dead code the gate flags for deletion, not a missing test to bolt on. Line coverage is necessary, never sufficient — it proves lines ran, not that the feature works as shipped.
   未覆盖的行往往是该死代码，门禁把它标出来是为了删，而不是为了补一个测试。行覆盖是必要条件，永远不是充分条件：它只证明这些行跑过，不证明功能按发货形态工作。
2. 真模型（第 25 行）：A no-key test proves plumbing; only a with-key run proves the agent works against a real model. 无 key 测试证明管道通；只有带 key 的运行才证明 agent 能对着真模型干活。
3. 快照（第 14 与 55 行）：每一处非平凡的、模型可见或人可见的改动，都要在同一个 PR 里新增或更新一个**无 key 的录制会话场景**；包级、e2e、纯 mock 与文字理由都不能替代组装好的 transcript。

这三句合起来意味着：**零散断言永远拼不出完整会话**，所以官方才需要第 6 层把整段会话录下来回放。

## 二、四条硬规矩（比分层更重要）

逐字引英文原句，后附中文释义与出处行号。

1. **只 mock 昂贵或不确定的边界。** 第 29 行：Mock only the expensive or non-deterministic boundary (LLM adapter, network, clock); keep everything downstream real.
   下游一律用真实现。宿主自己的范例是 makeBridgeHarness()：挂真 loop、真 session store、真 tool registry、真 JSONL 持久化，**只 mock 一个 MockAdapter**（packages/acp/acp/tests/harness.ts）。手写替身只能证明「桥在搬字节」，证明不了真正发货的工具会按断言的语义行动。
2. **面向产品的插件必须有真实组合测试，且测的是发布产物。** 第 39 行：Product-visible plugins require a non-unit REAL-composition test. Hand-built ctx.plugin(...) suites are insufficient: boot test-only cordis.yml through Loader and app/process, mock only external services or nondeterministic inputs, and assert model-visible request/log, durable state, or user-visible output. Keep opt-ins out of shipped defaults.
   第 41 行补充：Real entry path means the published artifact —— 要跑构建产物（bin 在 plain node 下跑 lib/bin.js），因为 tsx 会掩盖 settle race、模块解析与被吞掉的加载失败。第 40 行还要求护栏**必须能红**：A guard only guards if the regression fails it —— 故意引入回归、看它变红、再还原。
3. **验证世界，不验证自我报告。** 第 33 行：Verify the world, not the self-report；第 35 行：An e2e assertion re-runs the command or re-reads the file externally; a keyword probe on the agent own output lets a cheating agent pass.
   断言要从外部重跑命令或重读文件；只在 agent 自己的输出里搜关键词，会让作弊的 agent 蒙混过关。同一节还要求**断言没被碰过的文件逐字节不变**。
4. **无 key 的测试属于 CI，不该放在 key 门槛后面。** 出处是 postmortem 0001（第 112 行）：When the headline operation does not call the model, that test needs no API key — so it belongs in CI, not behind a key gate.

## 三、社区实证：19 个真实插件的实际做法

样本是 19 个真实第三方 DSH 插件仓库（billion-context、dsh-mnemon、dsh-context、DSH-better-sidebar、dsh-ops、dsh-skills-manager、dsh-mcp-connector、dsh-free-search、archify、dsh-unlag、dsh-substrate、cc-safety-net、dsh-win-pwsh7 等），逐仓库读 package.json / tests / tools / scripts / 工作流后记录。

### 3.1 三种主流做法

① 纯离线断言语件（node --test 或自研 assert，CI 零 secret）；② **手搭假宿主**（最普遍，集成级但不要 key）；③ 真宿主冒烟 —— 把打包产物 dsh plugin add 进一次性 profile 再起真 dsh，**全部 keyless**。

### 3.2 假宿主的四档谱系（由弱到强）

| 档 | 做法 | 代表 |
| --- | --- | --- |
| 1 | 只 import 模块，断言 name / inject / apply 与 provider 契约 | mattpocock-skills-zh 的 dsh-plugin/tests/provider.test.mjs（node:test + node:assert/strict） |
| 2 | 手写对象当 ctx，只给用得到的服务 | dsh-skills-manager 的 test/dsh-go-e2e.test.mjs 里叫 mockCtx |
| 3 | **严格 Proxy ctx**：访问未 inject 的面即抛错，用于验证 inject 声明完整性 | dsh-skills-manager 的 test/host-fence.test.mjs（new Proxy，14 处 makeContext 同类做法见 dsh-win-pwsh7 的 tools/check-host.mjs） |
| 4 | **真 cordis new Context() + apply(ctx, config) + 事件驱动** | dsh-context 的 tests/compat/staging.ts；dsh-mnemon 的 src/sdk/testing.ts（并把测试宿主作为 dsh-mnemon/testing 子路径导出） |

第 4 档是社区最强形态，也正好对上官方第 2 条规矩。dsh-mnemon 是唯一样本把「可复用的测试宿主」做成包的一部分。

### 3.3 --dump-config 是社区公认的安装层断言面

至少三个独立项目把它当作 bundle 层是否真的落地的判据：archify 的 distribution-acceptance 脚本（安装 / 升级 / 升级后读回，6 处 dump-config）；dsh-context 的手动安装检查（plugin add → dump-config 里恰好一行 → plugin remove → 归零）；dsh-ops 甚至不 spawn 真 dsh，而是仿真 dump-config 的读回语义（自述：Nothing spawns dsh, pnpm or npm）。

### 3.4 没有一家用录制会话回放（replay / VCR）来顶替模型

- 19 个仓库里搜 vcr 命中 0。
- 搜 replay 的命中**全部是业务语义的消息重放**（如 DSH-better-sidebar 的「队列在 attach 时重放一次」断言），不是模型回放。
- 搜 golden 的命中是**确定性渲染器的 golden file**（archify 的 test/golden.mjs 开头自述：renderers are deterministic, so fresh renders must match the checked-in example HTML），也不是模型 transcript。
- 把假上游做进 CI 的只有 billion-context：tests/e2e/fake-upstream.mjs（自述 Deterministic fake Responses-API upstream），工作流 job 名直接叫 zero tokens、不消费 secret。dsh-mnemon 则用 loopback stub（DEEPSEEK_API_KEY 填一个隔离用的常量），只有显式 --live-model 才读真 key。

结论：**社区用「假模型 + 真宿主」替代 replay**，而官方第 6 层的录制会话回放是宿主自己的重型机制，第三方插件基本没有复刻。

### 3.5 需要 secret 的矩阵

| 需要 secret？ | 仓库 |
| --- | --- |
| 从不 | dsh-free-search、dsh-mcp-connector、dsh-context、dsh-mnemon、dsh-market、archify、dsh-ops、dsh-skills-manager、mattpocock-skills-zh、DSH-better-sidebar、dsh-win-pwsh7 |
| 仅可选 lane | billion-context（默认假上游零 token；真上游要单独开关与 secret） |
| 仅本地手动 | cc-safety-net 的 e2e-live、dsh-unlag 的 contract / smoke、dsh-mnemon 的 --live-model |

### 3.6 「让 AI 验证插件」的落地形态

样本里没有「让 agent 自主判断插件好坏」的通用做法。可复现的只有三种，且都由**确定性信号**收口：

1. **探针插件**（archify 的 integrations/deepseek-harness/test/probe-skills.mjs）：装一个只报告「宿主是否给到某个面」的插件，由真宿主 apply，再读它写出的文件 —— 让宿主自己回答宿主问题。
2. **结构化 pass/fail 矩阵**：把验证结论压成机器可读矩阵供 agent 消费。
3. **真浏览器判决**：JSON spec 进、真 Chromium 出 PASS/FAIL 加截图 —— 把「UI 是否真的对」交给浏览器，不交给模型。

## 四、按被测对象选层

| 被测对象 | 最全的形态 | 依据 |
| --- | --- | --- |
| 纯逻辑（解析、分类、匹配、预算） | 单测 + **per-file 100% 覆盖门禁**（覆盖率用来删死代码） | 官方第 1、2 层 |
| 插件契约与注入语义 | 假宿主，越靠第 4 档越强（真 new Context() + 事件驱动） | 官方第 2 条规矩 + 社区谱系 |
| 装载与 profile 组合 | --dump-config 读回 + 真 Loader 装配 | 社区 3.3 |
| **模型真正看到什么** | **零凭据 stub + 真会话，断言请求原文** | 官方第 3 条规矩 |
| 端到端真的能用 | **带 key 真模型 smoke**（唯一能证明的一层） | 官方第 25 行 |
| 完整会话是否符合预期 | 录制会话回放 / 快照 | 官方第 6 层 |
| UI 是否真的对 | 真浏览器快照出 PASS/FAIL | 官方第 7 层 |
| 防倒退 | 每条护栏都做「故意注入回归 → 看红 → 还原」验证 | 官方第 40 行 |

## 五、本仓库的逐层就位情况

实测口径（本文件写入当天重跑）：

| 层 | 本仓库 | 状态 |
| --- | --- | --- |
| 单元 | 25 个 spec 文件 / 877 个用例（面板交互单独一个文件 60 例），skip 与 only 与 todo 命中 0 | 已就位 |
| 覆盖率门禁 | npm run test:coverage：语句、行、函数按**每文件 100%** 强制（vitest.config.ts 的 thresholds.perFile）；`src/types.ts` 排除，因为它只声明类型与模块增强、运行时零字节。残留分支报告为 1404/1436（97.77%，32 处未覆盖），逐条定性见下 | 已就位 |
| 真实项目集成 | npm run test:integration（真实项目 + 真实规则文件，无 key，未设置 DSH_RULES_PROJECT 时自跳过） | 已就位 |
| 真机冒烟（零凭据） | npm run test:e2e：真 Loader 装配 + 本地 OpenAI 兼容 stub，断言只读 stub 记录的请求原文；超长规则那例把截断点顶进代理对中间，断言块里没有半个 emoji | 已就位（27/27） |
| 真机冒烟（带 key 真模型） | npm run test:e2e:live：真模型跑一句可外部核验的任务，再解压会话持久化文件验证注入落地。已对本机自建网关（`LIVE_BASE_URL` + `LIVE_MODEL`，凭据走 `LIVE_KEY_ENV` 指定的变量名）实跑，14/14 通过；覆盖形态取自官方 packages/llm/llm-pi-ai/README.md 的 hand-declared gateway 示例 | 已就位 |
| 录制会话快照 | npm run test:snapshot：录一次真机会话，比对注入正文与规范化 state.json；改一个字符即 exit 1 | 已就位（18/18） |
| 真浏览器快照 | npm run test:browser：无头 Edge 伺服真实 lib/client.js 渲染面板，逐字节比对存档快照 | 已就位（25/25） |
| 基准 | npm run test:bench：scanAll / renderRulesBlock / attachedRules / read_rules 三次取中位数 | 已就位（8/8） |
| 真实组合（非单测） | tests/e2e 起真实无头会话；tests/entry.spec.ts 与 tests/client.spec.tsx 是手搭 fake ctx | 已就位（fake ctx 那部分官方判为不够，由 e2e 与集成层补位） |
| 无 key 车道接入 CI | `.github/workflows/ci.yml` 在 `ubuntu-latest` 上跑 `check`、`test:coverage`、`test:e2e`、`test:snapshot`、`test:integration`，全程零凭据；带 key 的车道不进 CI | 已就位 |
| 发布产物路径 | 与「真实组合」是同一层，单列出来是因为官方对它另有一条要求：`node -e "import('./lib/index.js')"` 在 plain node 下成功并导出 name / inject / Config / apply 四个符号，没有 tsx 或构建器参与；各层测试本身仍导入源码，因为要断言的是模块内部行为 | 已就位 |

剩下的差距（发布产物入口已在 2026-11-27 补上：`node -e "import('./lib/index.js')"` 在 plain node 下成功并导出 name / inject / Config / apply 四个符号）：

1. **带 key 的真模型 smoke 只跑过自建网关，没跑过官方路由。** 脚本两种都能跑（不设 `LIVE_BASE_URL` 即用 profile 默认路由），本机没有官方路由的凭据。
2. **分支未达 100% 的 32 处已逐条定性，结论是「不可达」而不是「还缺用例」。分布（覆盖率汇总实测）：src/index.ts 17、src/scan.ts 6、src/parse.ts 6、src/globs.ts 1、src/token-count.ts 1、src/client/index.tsx 1。** 三类：需要打桩才能触发的库内异常（picomatch 的编译抛错、matcher 抛错）；构造上不可能取到 undefined 的兜底（`lines[i] ?? ''` 这类下标恒在界内的 `??`）；以及公开面走不到的守卫（重复根去重、`Array.isArray` 参数守卫）。其中两处纯防御臂已按覆盖率证据删除：`src/globs.ts` 里实测从不触发的 `catch`，与 `src/tool-read-rules.ts` 里被 `defineTool` 参数校验挡在门外的非数组分支。
3. **故意「注入回归看红」已固化成清单，见 6.3。** 录制快照层、真浏览器快照层、覆盖率门禁与截断护栏各做了一次当场变异实验，另加一次诊断码改名的反向验证，观察到的红色输出逐字记在该节；每一处都已还原，并核对文件 revision 与实验前逐字相同。

## 六、证据与复现

### 6.1 官方依据（URL、状态码、抓取日期）

| 来源 URL | HTTP | 抓取日期 |
| --- | --- | --- |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/testing.md | 200 | 2026-11-27 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/postmortem/0001-acp-default-export-drops-inject.md | 200 | 2026-11-27 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/development.md | 200 | 2026-11-27 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/publish.md | 200 | 2026-11-27 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/index.md | 200 | 2026-11-27 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cookbook/extension-cookbook.md | 200 | 2026-11-27 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/core/agent-default-model/README.md | 200 | 2026-11-27 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/bundle/base/cordis.patch.yml | 200 | 2026-11-27 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/llm/llm-pi-ai/README.md | 200 | 2026-11-27 |

### 6.2 社区结论的取证方式

用浅克隆把 19 个仓库取到仓库之外的工作目录，**只读** package.json、tests、tools、scripts 与工作流文件；每条结论带可点开的 blob 链接与行号，引文逐字。完整报告是工作目录里的 plugin-testing-survey.md（不在本仓库内，因为它是调研产物而不是插件的组成部分）。

2026-11-27 复核时把 6.1 表里九条 URL 全部重新 fetch 了一遍，全部 200 且内容相符；社区侧另抽验五条关键论断同样全部 200：billion-context 的假上游脚本、dsh-substrate 的边界声明、dsh-mnemon 的真 Context 测试宿主、dsh-context 的真 Context、archify 的探针插件。

本仓库自身各层测试的跑法、断言内容与官方出处，另见同目录的 testing.md。两份文件的分工：本文件是官方政策与社区实证的调研结论加本仓库就位表；testing.md 是本仓库各层的命令、断言与官方出处，改动各自独立成篇。

### 6.3 故意注入回归看红的实测清单

官方第 40 行要求护栏必须能红（A guard only guards if the regression fails it）。下面五次实验都是 2026-11-27 当场做的：先改一处，看它变红，再还原，并核对文件 revision 与实验前逐字相同。

| 层 | 改了什么 | 观察到的红色 | 还原 |
| --- | --- | --- | --- |
| 录制会话快照 | 把 `tests/snapshot/session.snapshot.json` 里 `modelVisibleRulesText` 的首个 `number` 改成 `NUMBER` | `node --experimental-strip-types tests/snapshot/session.snapshot.mts` 报 checks 18 项 / 通过 17 项、exit 1，并打印第一处不同的字符偏移与两侧上下文 | 18/18、exit 0，revision 与实验前相同（6eba49a6 开头） |
| 真浏览器快照 | 把 `tests/browser/panel.snapshot.html` 注释里的 `first` 改成 `FIRST` | `node --experimental-strip-types tests/browser/panel.browser.mts` 报 checks 25 项 / failures 1：`FAIL the rendered panel matches the stored snapshot byte for byte -- first difference at byte 275 (file line 5)` | 25/25、failures 0，revision 与实验前相同（ed30c8f6 开头） |
| 诊断码改名 | 把 `src/attach.ts` 里的 `attach.slow` 改成 `attach.slowRENAMED` | `npx vitest run` 报 1 failed / 24 passed 文件、1 failed / 872 passed 用例，输出 `FAIL tests/attach.spec.ts > attachedRules - self-check budget > warns and skips a rule whose matchers exceed the self-check budget` 与 `expected 'attach.slowRENAMED' to be 'attach.slow'` | 改回 `attach.slow` 后回到 25 个文件全过（当时基线 873 个用例；同一句断言在新增四例后的 877 基线上仍然咬住）| `git diff --stat -- src/attach.ts` 为空，即与提交版本逐字相同 |
| 覆盖率门禁 | 在 `vitest.config.ts` 的 thresholds 里临时加 `branches: 100` | 六条 ERROR 同时出现：`src/client/index.tsx` 99.67、`src/globs.ts` 95.65、`src/index.ts` 92.51、`src/parse.ts` 96.1、`src/scan.ts` 95.65、`src/token-count.ts` 97.36 | 去掉该阈值后回到「25 个文件 / 877 个用例全过、残留分支 1404/1436」 |
| 截断护栏（safeSlice） | 把 `src/budget.ts` 的两处截断点从 `safeSlice(...)` 改回裸 `slice` | `npx vitest run` 报 1 failed / 24 passed 文件、2 failed / 875 passed 用例：`applyBudget drops the half pair at every cut position`（`expected true to be false`）与 `applyBudget shortens the body when the cap splits a pair`（期望 `abc`、实得 `abc\uFFFD`）。只把 `consumeOutputBudget` 那一处改回裸 `slice` 时收窄为 1 failed / 876 passed。`scripts/delivery-check.mts` 同时报 `BAD [文本检查] 两处截断都走 safeSlice` 与「终检：1 处问题」 | 两处都改回 `safeSlice` 后 25 个文件 / 877 个用例全过，revision 与实验前相同（83827446 开头） |

这五次实验同时是「哪些层真的会拦人」的证据：快照与浏览器两层拦的是渲染与注入正文的逐字节漂移，覆盖率门禁拦的是「新增分支没被任何输入走到」，截断护栏拦的是「保留正文末尾剩下半个代理对」。真机冒烟那一层不靠临时改文件复核：它的对照断言（禁用组必须不含 `<rules>`）与代理对断言都常驻在 `tests/e2e/smoke.mts` 里。超长规则那例的切点位置也有直接证据 —— 在 bundle 的截断点临时插一段标签打印该处码位，真机读回 `Bd83d A78 H7999 E7999`，即上限正好落在高位 0xd83d 与低位 0xde00 之间，而注入块里既没有完整 emoji、也没有孤立高代理。

## 七、维护提醒

1. 官方 docs/testing.md 改动后，重新 fetch 并核对本文件的层数、命令名、四条规矩的引文与行号。
2. 社区结论有时效：样本仓库会加测试。要复核时重新克隆并重跑 6.2 的搜索口径，尤其是 3.4 的 replay / vcr / golden 三词命中。
3. 本仓库补齐某一层后，同步更新「逐层就位情况」表与上面的差距清单，并在 CHANGELOG 里记一行。
