# 测试地图与官方依据

本文件记录两件事：本插件各层测试怎么跑、各层断言什么；以及这些分层所依据的 DeepSeek Harness 官方原文。
表中每个 URL 的 HTTP 状态码与抓取日期都是当场 fetch 得到的实测值，没有实测的一律标 FAILED 或 UNVERIFIED。

## 官方依据

抓取日期均为 2026-11-26（Asia/Shanghai）；HTTP 一列是 fetch 实测状态码，标题取自文件自身的一级标题。

| 来源 URL | 标题 | HTTP | 抓取日期 |
| --- | --- | --- | --- |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/testing.md | Testing policy | 200 | 2026-11-26 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/postmortem/0001-acp-default-export-drops-inject.md | Post-mortem 0001: ACP server crashed on connect — `export default` dropped the plugin's `inject` | 200 | 2026-11-26 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/development.md | Development guide | 200 | 2026-11-26 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/publish.md | Package and install a plugin | 200 | 2026-11-26 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/develop/basic/index.md | Your first plugin | 200 | 2026-11-26 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cookbook/extension-cookbook.md | Cookbook: extension plugin shapes | 200 | 2026-11-26 |
| https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/llm/llm-pi-ai/README.md | @deepseek-ai/dsh-llm-pi-ai | 200 | 2026-11-26 |

补充取证（本节其余论断用到，均 200，2026-11-26）：

- https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/core/agent-default-model/README.md — `@deepseek-ai/dsh-agent-default-model`
- https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/bundle/base/cordis.patch.yml — 基础层里 `llm-pi-ai` 与 `agent-default-model` 两行的原始写法

## 官方定的四条规矩

逐字引英文原句，后附中文释义；括号内是出处文件与行号。

1. "Mock only the expensive or non-deterministic boundary (LLM adapter, network, clock); keep everything downstream real."（docs/testing.md:29）
   只 mock 昂贵或不确定的边界（LLM 适配器、网络、时钟），下游一律用真实现。手写的替身只能证明「桥在搬字节」，证明不了真正交付的工具会按断言的语义行动。

2. "Product-visible plugins require a non-unit REAL-composition test. Hand-built `ctx.plugin(...)` suites are insufficient: boot test-only `cordis.yml` through Loader and app/process, mock only external services or nondeterministic inputs, and assert model-visible request/log, durable state, or user-visible output. Keep opt-ins out of shipped defaults."（docs/testing.md:39）
   面向产品的插件必须有一个非单测的真实组合测试；手工搭的 `ctx.plugin(...)` 套件不算数——要用 Loader 与 app/process 启动一份仅供测试的 `cordis.yml`，只 mock 外部服务或不确定输入，并断言模型可见的请求/日志、持久状态或用户可见输出。可选项不要混进默认发货配置。

3. "Verify the world, not the self-report"（docs/testing.md:33）；正文要求 "An e2e assertion re-runs the command or re-reads the file externally; a keyword probe on the agent's own output lets a cheating agent pass."（docs/testing.md:35）
   e2e 断言要从外部重跑命令或重读文件；只在 agent 自己的输出里搜关键词，会让作弊的 agent 蒙混过关。

4. "When the headline operation does not call the model, that test needs no API key — so it belongs in CI, not behind a key gate."（docs/postmortem/0001-acp-default-export-drops-inject.md:112）
   当被测主流程根本不调用模型时，这个测试不需要 API key，因而属于 CI，不该被放在 key 门槛后面。

同源背景：官方把「无 key 测试只证明管道通畅，只有带 key 运行才证明 agent 真的能对着真模型干活」写在 docs/testing.md:25 的 with-key 政策里，并要求 smoke 测试启动真实 `dsh` profile、发一句话、检查世界。

## 本插件的测试地图

八层，命令全部来自 package.json 的 scripts；单元层的 include 与覆盖率阈值来自 vitest.config.ts。

| 层 | 命令 | 需要 API key | 覆盖的测试 | 断言什么 |
| --- | --- | --- | --- | --- |
| 单元 | `npm test`（vitest run） | 否 | tests 下 25 个 `*.spec.ts` / `*.spec.tsx`（include 为 `tests/**/*.spec.{ts,tsx}`） | 纯逻辑用真实输入：parse/classify/globs/budget/render/token-count 走纯函数断言；scan/state/config/attach 用 `mkdtemp` 真实临时夹具跑真 `scanAll` 与真读写；entry/client 用手搭 fake ctx 断言注册与注入决策；panel-ui 用 `renderToStaticMarkup` 断言真实标记 |
| 覆盖率门禁 | `npm run test:coverage`（vitest run --coverage） | 否 | vitest.config.ts 的 per-file 100% 门槛 | 官方第 2 层的落点：未覆盖的行往往就是该死代码；`src/types.ts` 只含类型与模块声明、运行时零字节，显式排除在外；阈值写在 vitest.config.ts，被它挡住的文件不通过就算失败 |
| 真实项目集成 | `npm run test:integration`（node --experimental-strip-types tests/integration/real-project.mts） | 否 | tests/integration/real-project.mts | 需要一个含真实规则文件的项目（DSH_RULES_PROJECT）；未设置时打印跳过并 exit 0，克隆下来默认是绿的。断言：项目根识别、扫描计数（14 条 / always=1 / requested=7 / manual=6）、`<rules>` 包裹与分区、requested 正文不进块、manual 完全不出现、token 预算，以及 `read_rules` 完整往返（绝对路径 / 文件名 / 规则名 / 不存在 / 批量五路，批量输出含 7 个 `<rule>` 块） |
| 真机冒烟 | `npm run test:e2e`（node --experimental-strip-types tests/e2e/smoke.mts） | 否（零凭据：本机 OpenAI 兼容 stub 顶替模型） | tests/e2e/smoke.mts 与 tests/e2e/fixture/ | 起真实 DSH 无头会话（真实 Loader 组合，在一次性 DSH_HOME 里装入本仓库），断言只读 stub 记录的请求原文：启用时首个请求含 `<rules>` 与常驻正文、按需规则只给目录行、续跑请求复用同一份块；禁用组全程无 `<rules>`；再跑四例对抗输入（不可读目录、灾难性 glob、空项目、20000 字超长规则） |
| 真机冒烟（带 key 真模型） | `npm run test:e2e:live`（node --experimental-strip-types tests/e2e/live-model.mts） | **是**（`DEEPSEEK_API_KEY` 为空时打印 SKIPPED 并 exit 0） | tests/e2e/live-model.mts | 一次性 DSH_HOME + 无头 profile + 真实模型跑一句任务，然后**验世界**：解出会话转录 `session.v4.jsonl.zstd`（多帧 zstd），断言里面存在 `data.source.kind === "rules-context"` 的注入消息且正文含夹具标记。读的是落盘的会话记录，不是模型自述。已实测通过 14/14 |
| 指向自建网关 | 同上，加 `LIVE_BASE_URL` 与 `LIVE_MODEL` | 是（`LIVE_KEY_ENV` 指定凭据变量名，默认 `DEEPSEEK_API_KEY`） | 同上 | 设置 `LIVE_BASE_URL` 后本层写一份 `--patch` overlay，把 `llm-pi-ai` 的 provider 字典与 `agent-default-model` 两行整体覆盖成自建网关（形态取自官方 `packages/llm/llm-pi-ai/README.md` 的 hand-declared gateway 示例），因此请求不会落到默认的官方路由上。只设 `LIVE_BASE_URL` 而不设 `LIVE_MODEL` 会打印 SKIPPED，避免把请求打到一个未指明的模型上 |
| 录制会话快照 | `npm run test:snapshot` | 否 | tests/snapshot/session.snapshot.mts 与 session.snapshot.json | 用零凭据 stub 路线录一次真机会话，把注入的 rules-context 正文与规范化后的 state.json 存成录制；默认逐字节比对，第一处不同会打印字符偏移与两侧上下文；`DSH_SNAPSHOT_UPDATE=1` 才改写录制 |
| 真浏览器快照 | `npm run test:browser` | 否（无浏览器时打印 SKIPPED 并 exit 0） | tests/browser/panel.browser.mts 与 panel.snapshot.html | 把真实 lib/client.js（连同 react UMD 与 jsx 运行时模块）伺服给无头 Edge/Chrome，渲染面板并断言零窗口错误、四个插槽注入、层级与停用原因、`attached` 标记、点击开关恰好一条写请求、同一份输入两次渲染逐字节相同，最后与存档快照逐字节比对；`DSH_BROWSER_UPDATE=1` 才改写 |
| 基准 | `npm run test:bench` | 否 | tests/bench/bench.mts | 对真实模块计时：scanAll（约 400 文件）、renderRulesBlock（约 400 规则）、attachedRules（200×200）、read_rules；取三次中位数与宽松上限比，只作回归护栏，不是性能主张 |

## 无 key 的车道进 CI

官方第 4 条规矩说「不调用模型的测试属于 CI，而不是待在 key 门槛后面」，所以 `.github/workflows/ci.yml` 把这些层接在 `ubuntu-latest` 上，按顺序跑：`npm i -g pnpm@10` → `npm ci` → `npm run check` → `npm run test:coverage` → `npm run test:snapshot` → `npm run test:integration` → 装一份 npm 发布的 `@deepseek-ai/dsh@0.2` 到 `$RUNNER_TEMP/dsh` → `npm run test:e2e`（`DSH_CLI` 指向那份 `.bin/dsh`，超时 15 分钟）。装 pnpm 是因为 `dsh plugin add` 会调它，而 runner 镜像不自带；装发布的 CLI 是因为它的 `headless` 模板自带，不需要桌面端安装（2026-11-27 实测：发布包 `dsh --profile p1 --from-default-profile headless --dump-config` rc=0，`bundles` 里能看到本插件）。工作流里没有任何凭据字段，`DEEPSEEK_API_KEY` 与 `secrets.` 都不出现。

带 key 的 `test:e2e:live` 刻意不进 CI —— 官方要求这类车道在没有凭据时自跳过，本仓库的做法是把凭据留在本机。`test:browser` 需要无头 Edge/Chrome（`ubuntu-latest` 上两者都没有，跑起来只会打印 SKIPPED，等于没跑），`test:bench` 是宽松上限的回归护栏；两层都保留在本机执行。

CI 里 `test:e2e` 的启动器解析与本地一致：`DSH_CLI` 优先，否则要 `DSH_NODE_EXECUTABLE` + `DSH_INSTALL_DIR`；两个来源都不可用时它打印 SKIPPED 并以 0 退出，所以这一步最坏情况也不会把 CI 变红。

仓库的 tracker 约定同样接线到位：`docs/work/file-scoped-attachment/issues/01-file-scoped-attachment.md` 是这个 feature 的第一张 implementation ticket（头部有 `Status:` 行），`scripts/delivery-check.mts` 的必需文件清单同时覆盖 spec 与 ticket。

诚实备注：tests/entry.spec.ts 与 tests/client.spec.tsx 用的是手搭 fake ctx（`apply(ctx as never)`），正是官方四条规矩第 2 条判定为「不够」的形态；补位的是「真实项目集成」这层与真机冒烟：前者走真实扫描链路，后者由真实 Loader 启动真实 profile。

## 怎么复现一次真机冒烟

实际做法与 `tests/e2e/smoke.mts` 一致：

- 启动器两个来源：优先 `DSH_CLI`（显式指向 `dsh` 可执行文件或一个 shell 包装脚本）；否则由 DSH 进程导出的 `DSH_NODE_EXECUTABLE` 与 `DSH_INSTALL_DIR` 拼出 Electron 内的 host cli（`DSH_INSTALL_DIR/../dsh-desktop-host/lib/cli.js`，以 `ELECTRON_RUN_AS_NODE=1` 运行）。两个来源都不可用时打印 SKIPPED 并以 0 退出，保持无凭据机器与 CI 可用。
- 多轮粘性不在本层验证：无头模板按设计只答一个任务就退出，工具续跑那一步 host 给出空声明批次（`src/inject.ts` 返回 `no-claim`），续跑沿用已声明的同一份块 —— 这是 host 对齐，不是插件缺陷。会话内跨请求的附着升级由 `tests/entry.spec.ts` 的假宿主用例覆盖。
- overlay 覆盖两行（取自基础 bundle 层的原始写法）：
  1. `llm-pi-ai` 的 `providers`：把 `- id: llm-pi-ai / name: '@deepseek-ai/dsh-llm-pi-ai'` 这一行改写成带 `providers` 配置的形式（`providers` 是该适配器的路由字典）。
  2. `agent-default-model` 的 `provider` / `model`：把 `provider: deepseek-official / model: deepseek-flash` 改成冒烟使用的路由，保证新 agent 一定落到被 overlay 接管的那条模型路由上。
- 对照组断言：把本插件的插件行置为 disabled 后再启动一次，模型可见的请求里必须**不含** `<rules>`；与之相对，插件行 enabled 的那次请求必须含 `<rules>`。这是「检查世界」而不是「读自我报告」：断言落在请求日志上，而不是落在插件自己的输出上。

官方对 smoke 的定位：启动真实 `dsh` profile、发一句 prompt、然后检查世界（docs/testing.md:25 与 postmortem 0001 的 no-key e2e 先例）。

## 维护提醒

官方文档改动后按下面顺序重新核实，改动结果只落在本文件：

1. 重新 fetch 本文件「官方依据」里的每一个 URL，记录新的 HTTP 状态码与当天日期（`date -I` 即可）。
2. 状态码不再是 200 时：URL 失效就换成新路径并保留旧路径一行备注；只是抓取失败就写 FAILED 并保留 URL，同时把依赖该文档的正文论断降级为 UNVERIFIED。
3. 逐字核对「官方定的四条规矩」的四句引文与行号；官方重排段落时行号会变，引文本身不变。
4. 若官方新增了测试分层或修改 with-key 政策，同步更新「本插件的测试地图」的层数与每层需不需要 key 的说法。
5. 官方第 4 条规矩点名的层若有增减，同步 `.github/workflows/ci.yml` 的步骤列表与本节上面的说明。
6. 单元层的文件数与用例数会变：`npm test` 报出的 Test Files 要同步到本文件第 45 行附近的表格行与 README 的 Development 块，`docs/plugin-testing.md` 第五节那张就位表也引用同一组数字。
