# AGENTS.md

本文件是这个仓库给 AI coding agent 的仓库级说明。

这个仓库是 DeepSeek Harness（DSH）插件 `@one-dragon/dsh-rules-manager`：从各个 AI coding agent 的规则文件里发现规则，判定每条规则是常驻、按需还是停用，把结果注入 agent 的上下文，并提供 `read_rules` 工具与一块管理面板。

## 硬性约定

- **只读承诺**：插件绝不写入任何规则文件。所有开关只写 `state.json`，规则文件永远只被读取。
- **写注释带依据**：任何来自厂商文档的行为判断，注释里要写明完整 URL，方便回溯。`src/scan.ts` 的来源表与 `src/attach.ts` 的文件头是范本。
- **注释里避免 placeholder 这个词**：仓库检查器把注释里的这个英文单词判为遗留占位（JSX 属性除外）。
- **测试要有理有据**：断言要用真实夹具，不用 mock 掩盖行为；测试命名说明它保护的行为。

## Agent skills

### Issue tracker

Issues 和 specs 以 markdown 文件存放在本仓库的 `docs/work/<feature-slug>/` 下（local-markdown tracker，不依赖 GitHub/GitLab CLI）。

这是对上游模板 `.scratch/<feature-slug>/` 的一处有意偏离：本仓库的 `.gitignore` 已声明本地临时文件放在仓库之外，而 spec 与 ticket 需要跟代码一起进同一个 diff、被同一轮 review。See `docs/agents/issue-tracker.md`.

### Triage labels

五个 canonical triage roles 全部沿用默认字符串：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`，在 local-markdown tracker 中作为 issue 文件的 `Status:` 取值。See `docs/agents/triage-labels.md`.

### Domain docs

单上下文（single-context）布局：仓库根一个 `GLOSSARY.md`，加一个 `docs/adr/`。See `docs/agents/domain.md`.
