# dsh-rules-manager

> 在 [DeepSeek Harness](https://www.deepseek.com/en/harness/) 中统一加载与管理跨 Agent 的规则文件 —— 支持**全文常驻**、**按需加载**、**不注入**三种状态。

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.5-4D6BFE)](package.json)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-yes-2496ED)](package.json)

---

![规则面板：左侧是来源，右侧是每条规则的状态与层级](docs/preview.svg)

## 它做什么

你机器上已经有其他编码 Agent 的规则文件。DSH 不读它们，而把它们复制进 `AGENTS.md` 会丢掉原有的结构。

`@one-dragon/dsh-rules-manager` 就地读取它们，并给每条规则**三种状态**之一：

| 状态 | 内容在哪里 | 成本 |
|---|---|---|
| **全文常驻**（always） | 正文进提示词，每次请求都在 —— 描述不注入 | 常驻 |
| **按需加载**（on demand） | 只有路径 + 描述；正文在模型需要时才加载 | 每条约一行 |
| **停用**（disabled） | 哪里都没有 | 零 |

**中间那档才是重点。** 在一个真实项目中实测：让所有规则常驻需 **9,934 token**；同一套规则按本方案只需 **943** —— **省 91%**，且一条规则都没删。

## 支持的来源

**始终只读**，绝不写入任何第三方目录。

| 来源 | 用户级目录 | 项目级目录 | 读取的 frontmatter |
|---|---|---|---|
| **CodeBuddy** | `~/.codebuddy/rules` | `<项目>/.codebuddy/rules` | `description`、`alwaysApply`、`enabled` |
| **CodeBuddy（内网版）** | 同上 | 同上 | `type: always \| requested \| manual` |
| **Cursor** | `~/.cursor/rules` | `<项目>/.cursor/rules` | `description`、`globs`、`alwaysApply`（只收 `.mdc`） |
| **Claude Code** | `~/.claude/rules` | `<项目>/.claude/rules` | `paths` |
| **Agent standard（.agents）** | `$DSH_AGENTS_HOME/rules`，否则 `~/.agents/rules` | `<项目>/.agents/rules` | `trigger`、`globs` |
| **Trae** | `~/.trae/user_rules` | `<项目>/.trae/rules` | `description`、`globs`、`alwaysApply`、`scene` |
| **Trae CN** | `~/.trae-cn/user_rules` | `<项目>/.trae/rules` —— 与 Trae 同一目录，只声明一次 | 同上 |
| **Qoder** | `~/.qoder/rules` | `<项目>/.qoder/rules` | `trigger`、`alwaysApply`、`glob`（或 `paths`） |
| **Qoder CN** | `~/.qoder-cn/rules` | `<项目>/.qoder/rules` —— 与 Qoder 同一目录，只声明一次 | `trigger`、`alwaysApply`、`glob`（或 `paths`） |
| **Cline** | `~/.cline/rules`（受 `CLINE_DIR` 影响）与 `~/Cline/Rules` | `<项目>/.clinerules` 与 `<项目>/.cline/rules` | `paths` |
| **Roo Code** | `~/.roo/rules` | `<项目>/.roo/rules`，回退文件 `<项目>/.roorules` | 无（纯 markdown） |
| **Devin / Windsurf** | `~/.devin/rules`、常开文件 `~/.devin/global_rules.md` | `<项目>/.devin/rules`、常开文件 `<项目>/.devin/global_rules.md` | `trigger`、`globs` |
| **Windsurf（旧版）** | 单文件 `~/.codeium/windsurf/memories/global_rules.md` | `<项目>/.windsurf/rules`、文件 `<项目>/.windsurf/global_rules.md` 与 `<项目>/.windsurfrules` | `trigger`、`globs` |
| **GitHub Copilot** | 目录 `~/.copilot/instructions` 加文件 `~/.copilot/copilot-instructions.md`（`COPILOT_HOME` 可覆盖） | 目录 `<项目>/.github/instructions` 加文件 `<项目>/.github/copilot-instructions.md` | `applyTo`、`excludeAgent` |
| **Junie（JetBrains）** | — | `<项目>/.junie/rules`、legacy `<项目>/.junie/guidelines` | 无（纯 markdown） |
| **Amazon Q** | — | `<项目>/.amazonq/rules` | 无（纯 markdown） |
| **Tabnine** | — | `<项目>/.tabnine/guidelines` | 无（纯 markdown） |
| **Continue** | — | `<项目>/.continue/rules` | `name`、`globs`、`regex`、`description`、`alwaysApply` |
| **Lingma** | — | `<项目>/.lingma/rules` | 无（纯 markdown） |
| **JetBrains AI Assistant** | — | `<项目>/.aiassistant/rules` | `type`（`always on`）、`pattern` |
| **Antigravity** | `~/.gemini/config/rules` | —（其项目档 `<项目>/.agents/rules` 已由 `.agents` 行覆盖） | `trigger`、`globs` 或 `glob` |
| **Kiro** | `~/.kiro/steering`（`KIRO_HOME` 可覆盖） | `<项目>/.kiro/steering` | `inclusion`（`always`（默认）/ `fileMatch` / `manual` / `auto`）、`fileMatchPattern` |
| **Augment Code** | `~/.augment/rules`、文件 `~/.augment/user-guidelines.md` | `<项目>/.augment/rules`、文件 `<项目>/.augment-guidelines` | `type: always_apply \| agent_requested \| manual`（默认 `always_apply`） |

23 行表格涵盖 22 种约定：只有 CodeBuddy、Cursor、Claude Code、`.agents`（DSH 的 shared agents root）、Trae、Trae CN、Qoder CN、Cline、Roo Code、Devin、Windsurf（旧版）、Qoder、GitHub Copilot（CLI）、Antigravity、Kiro 与 Augment Code 有官方记载的用户级档位；其余来源——Junie、Amazon Q、Tabnine、Continue、Lingma 与 JetBrains AI Assistant——的用户级目录**留空而不是猜一个路径**。另有几条来源声明的是单文件档而非目录：Devin 与 Windsurf（旧版）的常开文件 `global_rules.md`、GitHub Copilot 的 `copilot-instructions.md` 以及 Augment Code 的 `user-guidelines.md`。GitHub Copilot 只读文件名以 `.instructions.md` 结尾的文件；Roo Code 另外接受 `.txt`。

Qoder 的用户级路径来自 CLI 页（`~/.qoder/rules/**/*.md`）；IDE 页只记载项目档，这也是此行此前写作「—」的原因。

Tabnine 的文档写明 `.tabnine` 目录也可能位于你的主目录，但该页从未印出这个路径；它的用户级档位因此留空，而不是猜一个。

Augment Code 是唯一一个「同一个文件在两个档位下答案不同」的来源：官方页写明 `~/.augment/rules/` 下的规则「always treated as `always_apply`」且「do not support other frontmatter types」，而工作区规则「support all three types」。因此用户级规则无论 frontmatter 写了什么一律按常驻读取，面板会在该文件上给出 `type.tierOverridden` 诊断，被忽略的字段不会被默默抹掉。

另有几个字段会被读入并保留，即使暂时没有任何状态依赖它们：GitHub Copilot 的 `excludeAgent`（该文件面向哪个入口）、CodeBuddy 的 `updatedAt` / `provider` 元数据，以及上表未点名的其它键。本插件当前只读，但一个被静默丢掉的字段将来永远无法原样写回，因此即便无人使用也一律保留。

### `.agents` 来源

第 4 个来源遵循 Google Antigravity 的 `.agents/rules` 约定（亦被 `agent-rules-spec` 提案采纳）。
它**只读 markdown**：`.mdc` 不属于该约定，即使放在同一目录也不会被这个来源收进来。

| `trigger` | 映射到的状态 |
|---|---|
| `always_on`、`always` | 全文常驻 |
| `model_decision`、`auto` | 按需加载 |
| `glob` | 按需加载，同时把 `globs` 读进该规则的 patterns |
| `manual` | 手动 |

**缺 `trigger` 的 `.agents` 文件会被静默丢弃**，与 Antigravity 的规定一致。
这是插件唯一一处「不根据 frontmatter 里其它字段推导状态」的地方。

**扫描是平坦的**，与 Antigravity 的规定一致：只读 `<目录>/.agents/rules/*.md` 的直接子级，子目录里的文件一律忽略。本插件的其它来源仍是递归扫描。

`trigger` 的取值**大小写不敏感**，并接受两个官方别名（`always`、`auto`）。这是**有意比 Antigravity 宽松**：官方会丢弃 `modelDecision` 这类驼峰写法，而本插件接受；也就是说被本插件接受的写法，Antigravity 本身仍可能丢弃。

其用户级目录的解析顺序为 **显式配置 > `DSH_AGENTS_HOME` > `~/.agents`**。这是 DSH 的 **shared agents root**（出自 `dsh-agent-instructions` 的 README），**不是** Antigravity 自己的用户级目录（`~/.gemini/config/rules`）——两者是不同的位置；本插件跑在 DSH 里，因此读的是前者。

CodeBuddy 接受 `.mdc` 与 `.md`；Cursor **只收 `.mdc`**（官方要求 project rules 必须使用 `.mdc` 扩展名，纯 `.md` 会被忽略）；其余来源——Claude Code、`.agents`、Trae、Qoder、Roo Code、Kiro 等——只接受 `.md`（Cline 与 Augment Code 同时接受 `.md` 与 `.mdc`），其中 Roo Code 另外接受 `.txt`；而 Junie、Amazon Q、Tabnine、Lingma 与 JetBrains AI Assistant 官方没有记载任何 frontmatter 词表，因此这些目录里的 markdown 文件对所有请求都生效。

### 没有 frontmatter 的文件

「没有 frontmatter 的文件算什么？」每种约定的答案都不同，因此来源表**逐条记录**这个答案，而不是统一假设。
CodeBuddy 文档化的「始终生效」示例里 frontmatter 只有一行注释；Cursor 对 `alwaysApply`、`description`、`globs`
三字段全无的文件只在 `@` 提及时才生效；Antigravity 则硬性要求 `trigger`。

| 没有 frontmatter 时 | 适用约定 |
|---|---|
| 全文常驻 | CodeBuddy、Claude Code、Cline、Trae、Trae CN、Qoder、Qoder CN、Continue、Roo Code、Junie、Amazon Q、Tabnine、Lingma、JetBrains AI Assistant、Kiro、Augment Code、Devin、Windsurf（旧版） |
| 不注入 | GitHub Copilot —— `.instructions.md` 由 `applyTo` 决定作用域；没写到本插件会读的字段的文件，不主动进入提示词 |
| 直接丢弃 | Cursor、`.agents` 与 Antigravity 的全局档（后两者硬性要求 `trigger`） |

有四种形态对**任何**约定都会被拒收，因为没有任何 Agent 把它们文档化为规则：含二进制内容的文件、
开了 `---` 围栏却没有闭合的文件、没有任何文字的文件，以及每一行非注释内容都是调用表达式
（`prefix_rule(pattern=[...], decision="allow")`）的文件。最后一条正是把 Codex 权限清单挡在
「纯 markdown 也算规则」的目录之外的那道门。

### 刻意**不**读的东西

有几个 Agent 用 "rules" 一词指代完全不同的东西。**只按目录名扫描**会把它们读进你的提示词：

| 不读 | 原因 |
|---|---|
| `~/.codex/rules` | 是 **shell 权限**清单：`prefix_rule(pattern=[...], decision="allow")` |
| `~/.cc-safety-net/rules` | 是 JSON 格式的**命令安全策略** |
| `~/.workbuddy/BOOTSTRAP.md` 等 | 是 Agent 的**身份与记忆** |
| `AGENTS.md`、`CLAUDE.md`、`GEMINI.md` | 不是异域，而是**已经被加载**：DSH 内置的 `@deepseek-ai/dsh-agent-instructions` 会按目录层级读取这一族，这里再扫一遍等于同一段文字注入两次 |

这些路径**根本不在来源表里**，因此不会被读到；上面的接纳规则是第二道防线。有几条来源确实在 rules 目录旁边还文档化了一个这类文件（Junie 的 `.junie/AGENTS.md`、Devin 的 `~/.config/devin/AGENTS.md`、Antigravity 的四个常驻 `AGENTS.md` / `GEMINI.md`、Kiro 明确说 `AGENTS.md` 不参与 `inclusion` 模式）：这些档位**一律留给 DSH**，来源表只声明它们的 rules 档。

## 安装

### 让 Agent 帮你装

把下面这段发给一个能操作本机终端的 Agent：

```text
请把最新版 @one-dragon/dsh-rules-manager 安装到我的 DSH profile，安装后确认已生效，
并告诉我如何重新加载。如果我用的是桌面版，就用 desktop profile。
```

### 手动安装

```sh
dsh plugin --profile desktop add @one-dragon/dsh-rules-manager
```

然后**新开一个会话** —— 插件变更只影响新会话。

### 从本地检出安装

`lib/` 已提交进仓库，所以克隆下来就带着构建产物，**无需构建步骤**：

```sh
git clone https://github.com/one-dragon/dsh-rules-manager.git
dsh plugin --profile desktop add link:$PWD/dsh-rules-manager
```

若要从源码重新构建（改过 `src/` 下任何文件之后），先跑 `npm install && npm run build` —— 因为宿主加载的是 `lib/` 而不是 `src/`。

## 配置

打开 **插件 → Rules Manager**。设置存在 `~/.dsh/rules-manager/state.json`；**不配置也能跑**。

| 设置项 | 默认值 | 取值范围 | 含义 |
|---|---|---|---|
| `perRuleMax` | `8000` | 100 - 2,000,000 | 单条常驻规则的字符上限 |
| `userRulesTotal` | `6000` | 0 - 2,000,000 | 用户级常驻规则的总量上限 |
| `projectRulesTotal` | `12000` | 0 - 2,000,000 | 项目级常驻规则的总量上限 |
| `readRulesOutput` | `60000` | 1,000 - 4,000,000 | 一次 `read_rules` 结果的字符上限 |
| `maxScanDepth` | `6` | 0 - 100 | 每个来源根目录的递归深度；`0` 表示只读根目录 |
| 入口位置 | 两处都显示 | 至少一处 | 仅设置 / 仅侧边栏 / 两处 —— **始终保留至少一处** |

若要在部署时固定配置，可在 `cordis.patch.yml` 的插件条目 `config:` 块里设置。

自动附带也有自己的上限：每个会话最多记住 2000 条被触碰的路径（超出按最早先出），每次请求最多编译 256 条文件作用域规则；看起来有回溯风险的匹配式、或超出约 200 ms 匹配预算的匹配式会被跳过并给出诊断，而不是硬匹配。编译失败的匹配式同样跳过；一旦附带，该规则在本会话剩余时间内保持常驻；但会话切换工作目录后会重新开始 —— 触碰列表绑定在它被收集的那棵目录树上，相对路径离开那棵树就没有意义。

每个数值都必须是取值范围内的整数；越界的值会在读取设置时被拒绝，并由 schema 报出越过了哪条边界，而不是悄悄改变行为（实测 `perRuleMax: -1` 会把每条规则截成 `-1 chars`，`maxScanDepth: -3` 则一条规则都不返回、也没有任何解释）。`state.json` 本身按 1 MiB 上限读取——更大的文件当作损坏处理、回落默认值；写入时拒绝符号链接目标，遇到被链接的设置文件会报出来而不是把它替换掉。

## 按需加载是怎么工作的

每次请求都携带一个 `<rules>` 块，其中对每条按需规则只列出它的**绝对路径与描述**，**绝不含正文**：

```xml
<agent_requestable_workspace_rules description="...">
Use read rule tool to fetch the rule content if needed. In this section, key is the rule's absolute file path, value is rule's description.
- /repo/.codebuddy/rules/ts-standard.mdc: 当编写 TypeScript 代码时…
</agent_requestable_workspace_rules>
```

当某条描述与当前任务匹配时，模型调用 `read_rules`：

```json
{ "ruleNames": ["/repo/.codebuddy/rules/ts-standard.mdc"] }
```

**键的解析很宽容**，因为模型经常只传文件名。依次尝试：精确绝对路径 → 大小写不敏感路径 → 唯一 basename → 唯一规则名。后两档若出现多个候选，会**连同候选一起报为 ambiguous**，而**不是猜一个**。

## 与 DSH 自带 `AGENTS.md` 的关系

**两者并存。** DSH 自带 `@deepseek-ai/dsh-agent-instructions`，按目录层级加载 `AGENTS.md` 与 `CLAUDE.md`。本插件不碰它。

| | `dsh-agent-instructions`（自带） | `@one-dragon/dsh-rules-manager` |
|---|---|---|
| 来源 | 按目录层级的 `AGENTS.md` / `CLAUDE.md` | `.codebuddy` / `.cursor` / `.claude` 的规则文件 |
| 状态 | 只有常驻 | 常驻 / 按需 / 停用 |
| 触发 | 目录层级与文件访问 | 描述匹配，以及会话触碰过匹配文件后的 `paths` / `globs` 匹配式 |

两者都注入持久的 user 消息，所以它们**在提示词里是叠加的**。若同时使用，请留意合计成本。

## 规则面板

插件带有客户端半边，因此 **插件 → 规则** 既有设置分区，也有侧边栏入口（点开在主栏打开面板）。
两处展示同一份目录：每条规则的状态与 token 成本，外加搜索框和常驻 token 汇总。

面板围绕用户真正会问的两个问题组织：**这条来自哪个目录？** 和 **它花了我多少 token？**

- **作用域页签** —— 全局 / 项目，默认落在项目。
- **状态页签** —— 全部 / 全文常驻 / 按需加载 / 不注入 / **已停用**，各带计数。被停用的规则**不会消失**：它进入「已停用」页签并显示停用原因（文件里写了 `enabled: false`、在此处关闭、或其来源已关闭），且保留开关，随时可以重新启用。
- **按来源分组**，每组标题显示**真实的绝对目录**（例如 `D:\repo\.codebuddy\rules`），并带来源级开关。
- **按开销排序**，常驻 token 最高的排在前面。
- **一行脚注解释这些数字**：全文常驻类只把正文放进提示词，描述不随行；按需加载类常驻的只有一行 `路径: 描述`，正文在模型调用时才加载；不注入类从不进入提示词。这些数字是预算感知的：正文超过单条上限 8000 字符会被截断并标注；某一档总量超限（用户级 6000 字符、项目级 12000 字符）时整条规则会被丢弃，脚注会点名。已附着到被触碰文件的规则按常驻计费，因为它的正文就在提示词里，不再只是一行索引。
- **成本汇总后面有「详情」入口**：逐条列出每条规则常驻多少 token、只在读取时才花多少 token，并给出两项合计与同样的解释。它最后一行「按需清单的固定开销」不属于任何规则 —— 那是包住按需索引行的标签与说明文字，只要还有按需规则，它就常驻。
- **扫描问题可展开**：统计栏只给数量，点开才逐条列出问题的代码、所在行与来自哪个文件；「详情」弹窗里也是同一份清单。只给一个数字、不说是哪个文件，是没法处理的。
- **每张来源卡片都带自己的标识**：来源标题旁的色块优先用厂商自己的 SVG；厂商没有可用图形的（`.agents` 是共享目录而不是厂商）保留两字母缩写。每个标识都是厂商自己的文件、整份随包提交而不是运行时去取，其来源链接、字节数与许可说明都写在 `src/client/brand-icons.ts` 里字节旁边。

- **文件作用域规则会在你触碰匹配文件的瞬间转为常驻。** 每一次成功的 `read`、`write`、`edit`、`read_image`、`str_replace_editor` 或 `apply_patch` 调用都是一次观测：`paths` / `globs` 匹配到其中某个文件（或其中某个目录下的文件）的规则，从下一次请求起不再是一行索引，而是整份注入，并在本会话剩余时间内保持。附带依据的是**实际发生过什么**，而不是猜测将要发生什么；`bash` **不追踪** —— 解析任意 shell 语法不是可靠的文件系统 seam，宿主自带的指令插件也做了同样的选择。22 家约定文档化的作用域键都会读取（`paths`、`globs`、`glob`、`pattern`、`fileMatchPattern`、`applyTo`），每个键的官方核对地址都写在 `src/attach.ts` 的文件头里，随时可回溯。

每个开关**只写 `state.json`**，绝不修改任何第三方规则文件。

还没有任何 agent 跑过时，面板会**自行解析工作区**，所以重启后立刻就有数据：优先用最近一次扫描的目录，其次是 DSH 已登记的工作区，最后是会话头里记录的 `cwd`。可选服务（`workspaceRegistry`、`sessions`）一律用 `ctx.get` 探测，**不放进 inject**。

面板的数据**由宿主提供**，不是写死的列表。宿主半边通过 Connection 的精确 Fetch 注册点
（`ctx.connection.fetch.register`）在 `/api/rules-manager/rules.json` 发布当前目录，面板挂载时读取它。
该路由与其它 `/api` 请求走同一道浏览器信任围栏，只有已认证的本机 GUI 能读。

注册采用 **晚绑定**（`ctx.inject(['connection'], …)`），而不是一次性的 `ctx.get('connection')`：
在启动顺序里 Connection 晚于本插件挂载，一次性读取会静默不注册 —— 这是实测结果，不是推断。请求失败或结果为空时，
面板会给出明确文案并提供重试，而不是渲染一个空框。

两处契约是关键，`npm run verify` 都会断言：

- 客户端 bundle **必须返回一个带 `apply` 方法的插件对象**。DSH 的加载器会拒绝其它形态
  （`isDynamicCordisPlugin`）；没有它，两个入口一个都不会注册。
- `main` 面板与它的 `sidebar.panellist` 条目**共用一个 id**。不一致会让侧边栏点得动、但背后没有面板。

面板文案走宿主自己的 locale 服务翻译：`apply` 在 `ctx.effect` 内用 `locale.register(NS, { en, zh })`
把本插件的字典注册进命名空间，label 通过 `locale.bind(NS)` 读取。当前语言取自宿主
`getSnapshot().active`。没有加载 locale 服务时回退到内置表，即降级为英文而不是失败。

`inject` 在客户端只放 `slots`，宿主侧只放 `tools`/`workingDirectory`。Cordis 没有可选依赖语法，
因此真正可选的服（`locale`、`webServer`）在使用处用 `ctx.get(...)` 探测 ——
放进 `inject` 会让插件在缺少该服务的环境里整体不加载。

## 已知限制

- **附带只由第一方文件工具触发，且有上限。** 由 `paths` / `globs` 限定作用域的规则，会在会话经 DSH 工具读取/写入/编辑/打补丁到匹配文件时附着；观测从不阻塞或改写工具调用，每次请求最多编译 256 条文件作用域规则，每个会话最多记住 2000 条被触碰路径，回溯风险过高或超出匹配预算的匹配式会被跳过 —— 后三种情况都会在面板里给出诊断。附带在本会话内是粘性的；会话切换到其他工作目录后重新开始，因为相对路径离开它被解析的那棵树便没有意义。
- **不追踪经 `bash` 的文件访问。** 宿主自带的指令插件出于同样理由做了同样选择：解析任意 shell 语法不是可靠的文件系统 seam。因此本可通过 `cat` 命中的模式，要等到该文件被第一方工具读取/写入/编辑后才会生效。
- **按需附带在会话内是粘性的。** 一旦附带，保持到会话结束。压缩（compaction）会重算，而不是无限累积。
- **CodeBuddy 内网版 `type:` 的支持属推断**，依据是实际观察到的文件。它被当作公网版 `alwaysApply` 的别名；状态推导顺序在 `src/parse.ts` 的 `deriveRule` 函数里。
- **没有 `@name` 手动触发。** 手动规则没有描述，因此从不注入。若需要同等效果，可用带 `disable-model-invocation: true` 的 DSH skill。
- **不读 `.agents/rules.json`。** Antigravity 支持用该目录下的显式注册文件把嵌套文件纳入；本插件是平坦扫描，忽略它。仅在注册文件里登记的规则不会出现。
- **行内 `#` 注释只在封闭取值字段上生效**（`trigger`、`type`、`alwaysApply`、`enabled`）。`description` 与 `name` 是自由文本，字面 `#` 会保留 —— 这也意味着给 `description` 追加的注释会被当成值的一部分。

## 开发

```sh
npm install
npm run typecheck            # tsc --noEmit
npm run test                 # vitest，全量套件（25 个 spec 文件）
npm run test:coverage        # 同一套件，外加每文件 100% 的覆盖率门禁
npm run test:integration      # 真实项目 + 真实规则文件
npm run test:e2e             # 真实 DSH 会话 + 本地模型 stub，无需凭据
npm run test:e2e:live        # 真模型；需要 DEEPSEEK_API_KEY（或 LIVE_KEY_ENV），未设置时自跳过
npm run test:snapshot        # 录制的会话转录，逐字节比对
npm run test:browser         # 真实无头浏览器渲染面板，逐字节比对
npm run test:bench           # 扫描、渲染、附着与 read_rules 的耗时
npm run build                # tsdown -> lib/
npm run verify               # 交付检查（清单、README 主张、只读承诺）
npm run check                # typecheck + test + build + verify
```

### 一个 Windows 注意事项

在 MSYS Bash 下，`npm.cmd` 会以 exit 126 失败。请改为通过 Node 调用 CLI：

```sh
node "<node-dir>/node_modules/npm/bin/npm-cli.js" install   # npm-cli.js 与 node.exe 同级
```

### 已在真实 DSH 安装上验证

插件被装进一个独立的 scratch profile，并由 DSH 自己的 profile 组合器加载：

```
dsh plugin --profile scratch add "link:<检出目录>"
dsh --profile scratch --dump-config          # exit 0，条目出现在树里
dsh --profile scratch --dump-config-schema   # Config 被解析，默认值正确
```

`--dump-config` 把我们的 `cordis.patch.yml` 层组合进了树；`--dump-config-schema` 从我们的 schemastery `Config` 生成了 JSON Schema，**所有文档中的默认值**（`8000`、`6000`、`12000`、`60000`、`6`）都正确。

测试深度 —— 每一层能证明什么、官方政策要求什么、19 个真实第三方 DSH 插件怎么测自己 —— 写在 [docs/plugin-testing.md](docs/plugin-testing.md) 里，本仓库逐层就位情况是该文件里的一张表。

## 设计与依据

本插件的每一条行为主张都可追溯到**读过的源码**或**跑过的测试**。证据就在代码旁边与测试套件里：

- `agent/pre-step` 的载荷字段 —— 读自 `@deepseek-ai/dsh-agent/src/runtime-types.ts`
- 三态推导顺序 —— 读自 CodeBuddy 的 `parseRuleFile`
- 60000 字符输出预算与四级键解析 —— 读自 CodeBuddy 的 `ReadRulesTool`
- ReDoS 预筛阈值 —— 在 picomatch 4.0.7 上实测（`*a*a*a*…` 十星超 5 秒；`**` 与花括号模式稳定在 2–3 ms）
- `safeSlice` 的代理对保护 —— **CodeBuddy 自己的版本是错的**，它判断低代理区间，会丢掉完整的对。本插件判断高代理区间，并有覆盖每个截断位置的测试。
- `dsh.client.external` —— 核对 10 个已安装客户端插件后留空：最接近的 `@michengai/dsh-skills-manager` 声明了**相同的三项 `inject`**、`external` 为空，且只 require `react` 与 `@deepseek-ai/dsh-client-ui-primitives`，两者都属平台 baseline。
- `MessageSourceMap` —— 用模块增强声明（宿主自己的 `dsh-agent-instructions` 用的同一处 seam），而不是强制类型转换。
- **注入位置** —— 规则块折叠在**已认领批次之后**，使直接提示在其前、driver 追加的运行时上下文在其后。这是宿主自己的约定（读自 `dsh-agent-instructions/src/index.ts`）；追加到末尾会把顺序反过来，并且会往一个本不拥有请求的首步里注入。
- 面板样式 —— 注入一个 `<style>` 元素，使用 DSH 的 `--dsw-*` 别名 token（参考实现用的就是这套）。每个 token 都带字面 fallback，并有测试断言这一点。

**六个缺陷是靠跑代码（而非读代码）发现的**，每个都有回归测试，列在 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE)
