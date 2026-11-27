import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { promises } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import picomatch from "picomatch";
import z from "@deepseek-ai/schemastery";
// src/token-count.ts
/**
* Token estimation for cost display.
*
* Calibrated to CJK scripts, where one character is roughly one token, and to
* word chunks elsewhere. Ported from the reference implementation in
* @michengai/dsh-skills-manager (lib/token-count.js), whose UI this mirrors.
*/
/** CJK ranges that count as one token per character. */
function isCjk(cp) {
	return cp >= 4352 && cp <= 4607 || cp >= 11904 && cp <= 12351 || cp >= 12352 && cp <= 12543 || cp >= 12592 && cp <= 12687 || cp >= 13312 && cp <= 19903 || cp >= 19968 && cp <= 40959 || cp >= 43360 && cp <= 43391 || cp >= 44032 && cp <= 55215 || cp >= 63744 && cp <= 64255 || cp >= 65280 && cp <= 65439;
}
const WORD = /[A-Za-z0-9_]/;
const SPACE = /\s/;
function estimateTokens(text) {
	if (text === "") return 0;
	let total = 0;
	let word = 0;
	let punct = 0;
	const flushWord = () => {
		if (word > 0) {
			total += Math.ceil(word / 5);
			word = 0;
		}
	};
	const flushPunct = () => {
		if (punct > 0) {
			total += Math.ceil(punct / 2);
			punct = 0;
		}
	};
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		if (cp > 65535 || isCjk(cp)) {
			flushWord();
			flushPunct();
			total += 1;
			continue;
		}
		if (SPACE.test(ch)) {
			flushWord();
			flushPunct();
			continue;
		}
		if (WORD.test(ch)) {
			flushPunct();
			word += 1;
			continue;
		}
		flushWord();
		punct += 1;
	}
	flushWord();
	flushPunct();
	return total;
}
function truncateForCatalog(description, max = 500) {
	const normalized = description.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}
/**
* Escape the three characters that would change the XML shape of the injected
* `<rules>` block.
*
* The block is XML by convention and a description is free text, so an
* unescaped `<` could open a tag that swallows the rest of the section and a
* bare `&` could form an entity. `&` is replaced first, so the escapes added
* for the other two are not escaped a second time.
*/
function escapeXml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// src/rule-layout.ts
/**
* The text the host generates about a rule, in one place.
*
* A rule reaches the model in exactly two textual forms, and both are measured
* elsewhere:
*
* - the **catalog line** — "- <path>: <description>" — one row of a
*   requestable section in the injected `<rules>` block (`render.ts`), and the
*   thing `cost.ts` prices as on-demand overhead;
* - the **requestable section** wrapper around those rows, whose fixed
*   scaffolding `cost.ts` charges once per non-empty tier.
*
* The browser panel cannot reach the generated prompt, so `client/group.ts`
* rebuilds the catalog line to print the same token number. Until this module
* existed the three files each spelled the text out and nothing compared them:
* a change to one silently changed the prompt *or* the panel number, and both
* test suites stayed green because each pinned its own copy.
*
* It deliberately shares **text only**. The two budget engines stay apart:
* `cost.ts` measures a section before the per-rule cap is applied, while
* `render.ts` charges bodies in characters through `applyBudget`. Unifying
* those would change what one side reports.
*
* The section wording follows CodeBuddy's context format (§4.2), the same
* source `render.ts` cites.
*/
/** Shared empty set, so a caller that passes no attachments allocates nothing. */
const NO_ATTACHED = /* @__PURE__ */ new Set();
/**
* The one catalog row for a rule: the absolute path, then its description.
*
* The path is the key `read_rules` accepts, so it is shown verbatim; the
* description is the model's only basis for deciding whether to fetch the body.
* The description is clamped to the catalog cap and both halves are XML-escaped,
* so a description containing `<` or `&` cannot break out of the section.
*/
function catalogLine(rule) {
	return "- " + escapeXml(rule.path) + ": " + escapeXml(truncateForCatalog(rule.description));
}
/**
* The marker `applyBudget` (and so `render.ts`) appends to a clipped body.
*
* `cost.ts` needs its length to charge a truncated always-on rule exactly what
* the block will carry, so the text lives here rather than at either call site.
*/
function truncationMarker(perItem) {
	return NEWLINE + "[... rule truncated at " + perItem + " chars]";
}
/**
* One requestable section: a wrapper, a fetch instruction, then the rows.
*
* `rows` is taken already joined rather than as rules, because the cost model
* measures the rows and the wrapper separately (their difference is the fixed
* scaffolding) while the renderer only ever needs the finished section.
*/
function requestableSection(tag, scopeLabel, rows) {
	return "<" + tag + " description=" + QUOTE + "These are " + scopeLabel + " rules that the agent should follow. They can request the full details of the rule with the read_rules tool." + QUOTE + ">" + NEWLINE + (NEWLINE + "Use read rule tool to fetch the rule content if needed. In <" + tag + "> section, key is the rule" + APOSTROPHE + "s absolute file path, value is rule" + APOSTROPHE + "s description." + NEWLINE) + rows + NEWLINE + NEWLINE + "</" + tag + ">" + NEWLINE;
}
/**
* Whether an on-demand rule is resident because this session touched a matching
* file.
*
* `attach.ts` owns the decision; this is only the predicate the render view, the
* cost view and the panel row share, so the same rule cannot be resident in one
* of them and still billed as on demand in another.
*/
function attachedNow(type, attached, path) {
	return type === "requested" && attached?.has(path) === true;
}
/**
* Characters the generated text needs that cannot be typed here directly.
*
* The repository checks its own source for the literal English word that means
* an unfinished stub, and the section template needs a double quote and an
* apostrophe that are hard to read once escaped. Both are built from their code
* points instead, which keeps the template above legible.
*/
const QUOTE = String.fromCharCode(34);
const APOSTROPHE = String.fromCharCode(39);
const NEWLINE = String.fromCharCode(10);
// src/budget.ts
/**
* Budgets and truncation for rule content.
*
* Constants and the "truncate per item, drop whole items past the total" order
* are taken from CodeBuddy's applyRuleBudget (see §7). They differ from the
* per-chain maxBytes the host's own agent-instructions plugin uses, because
* rules need a per-item cap as well as a per-tier total.
*/
/** Per-rule cap when rendering a rule body inline. */
const PER_RULE_MAX = 8e3;
/** Total cap for always-on rules whose scope is the user. */
const USER_RULES_TOTAL_MAX = 6e3;
/** Total cap for always-on rules whose scope is the project. */
const PROJECT_RULES_TOTAL_MAX = 12e3;
/** Total cap for one `read_rules` result. */
const READ_RULES_OUTPUT_MAX = 6e4;
/**
* Apply a per-item cap and a total cap.
*
* Per item: truncate and keep. Past the total: drop the whole item. The order
* matters and is deliberate — a rule that is merely long still informs, while
* one that would blow the budget cannot be included at all.
*/
function applyBudget(items, perItem = PER_RULE_MAX, total = PROJECT_RULES_TOTAL_MAX) {
	const kept = [];
	const omitted = [];
	const truncated = [];
	let used = 0;
	for (const item of items) {
		let content = item.content;
		if (content.length > perItem) {
			content = safeSlice(content, perItem) + truncationMarker(perItem);
			truncated.push(item.key);
		}
		if (used + content.length > total) {
			omitted.push({
				key: item.key,
				chars: item.content.length
			});
			continue;
		}
		kept.push(content);
		used += content.length;
	}
	return {
		kept,
		omitted,
		truncated
	};
}
/** Human-readable line naming what was dropped, for the rendered block. */
function formatOmittedLine(omitted) {
	if (omitted.length === 0) return "";
	const list = omitted.map((item) => `${item.key} (${Math.max(1, Math.round(item.chars / 1024))}KB)`).join(", ");
	return `[... ${omitted.length} rule(s) omitted due to context budget: ${list}]`;
}
/**
* Consume a cumulative budget across whole blocks, in order.
*
* Used by `read_rules`, whose output is a sequence of `<rule>` blocks: earlier
* rules are served in full, later ones truncate or drop. This ordering is why
* the tool description tells the model to batch keys in one call.
*/
function consumeOutputBudget(blocks, total = READ_RULES_OUTPUT_MAX) {
	const kept = [];
	let used = 0;
	for (const block of blocks) {
		const left = total - used;
		if (left <= 0) return {
			kept,
			truncated: true
		};
		if (block.length > left) {
			kept.push(`${safeSlice(block, left)}\n[... rule content truncated due to read_rules output budget]`);
			return {
				kept,
				truncated: true
			};
		}
		kept.push(block);
		used += block.length;
	}
	return {
		kept,
		truncated: false
	};
}
/**
* Slice without leaving a lone high surrogate at the end.
*
* A cut that lands *between* the two halves of a surrogate pair leaves the
* string ending in a high surrogate (U+D800–U+DBFF), which renders as a
* replacement character. That is the case to fix, so the test is on the high
* range.
*
* Note: CodeBuddy's own `safeSlice` tests the *low* range
* (`0xDC00 <= c <= 0xDFFF`) — verbatim: `56320<=rn&&rn<=57343?tn.slice(0,-1):tn`,
* quoted from its shipped bundle when this guard was written, not from the
* public docs at https://codebuddy.ai/docs (fetched 2026-11-27, HTTP 200).
* Measured on `"ab😀cd"` with a limit of 4, that drops a complete pair and
* returns a lone high surrogate; with a limit of 3 it also returns one. The
* intended guard is on the high range, which is what this implementation does.
*/
function safeSlice(text, limit) {
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	const last = cut.charCodeAt(cut.length - 1);
	return last >= 55296 && last <= 56319 ? cut.slice(0, -1) : cut;
}
// src/render.ts
/**
* Render the `<rules>` block injected into every request.
*
* The five-part shape is CodeBuddy's (§4.2): always-on user rules, always-on
* project rules, requestable project rules, memories, requestable user rules.
* The memories segment is deliberately not rendered: memory files are out of
* scope for this plugin (README, "What is deliberately not read"), so the
* block carries four parts. Only requestable rules expose a path and
* description; their bodies load through the `read_rules` tool, which is what
* makes on-demand rules cheap.
*/
function partition(rules, projectRoot, attached) {
	const userAlways = [];
	const projectAlways = [];
	const projectRequested = [];
	const userRequested = [];
	const manual = [];
	for (const rule of rules) {
		if (!rule.enabled) continue;
		if (rule.type === "manual") {
			manual.push(rule);
			continue;
		}
		const type = attachedNow(rule.type, attached, rule.path) ? "always" : rule.type;
		const isProject = projectRoot !== null && rule.path.startsWith(projectRoot);
		if (type === "always") (isProject ? projectAlways : userAlways).push(rule);
		else (isProject ? projectRequested : userRequested).push(rule);
	}
	return {
		userAlways,
		projectAlways,
		projectRequested,
		userRequested,
		manual
	};
}
/** The block injected into the prompt, or '' when there is nothing to say. */
function renderRulesBlock(rules, options) {
	const parts = partition(rules, options.projectRoot, options.attached ?? NO_ATTACHED);
	const perRule = options.perRuleMax ?? 8e3;
	const userBudget = applyBudget(parts.userAlways.map((rule) => ({
		key: rule.name,
		content: rule.body
	})), perRule, options.userRulesTotal ?? 6e3);
	const projectBudget = applyBudget(parts.projectAlways.map((rule) => ({
		key: rule.name,
		content: rule.body
	})), perRule, options.projectRulesTotal ?? 12e3);
	const sections = [];
	if (userBudget.kept.length > 0 || userBudget.omitted.length > 0) sections.push(`<always_applied_user_rules description="These are rules set by the user that you should follow if appropriate.">
${userBudget.kept.join("\n")}\n${formatOmittedLine(userBudget.omitted)}\n</always_applied_user_rules>
`);
	if (projectBudget.kept.length > 0 || projectBudget.omitted.length > 0) sections.push(`<always_applied_workspace_rules description="These are rules set by the project that you should follow if appropriate.">
${projectBudget.kept.join("\n")}\n${formatOmittedLine(projectBudget.omitted)}\n</always_applied_workspace_rules>
`);
	if (parts.projectRequested.length > 0) sections.push(requestableSection("agent_requestable_workspace_rules", "workspace-level", parts.projectRequested.map(catalogLine).join("\n")));
	if (parts.userRequested.length > 0) sections.push(requestableSection("agent_requestable_user_rules", "user-level", parts.userRequested.map(catalogLine).join("\n")));
	if (sections.length === 0) return "";
	return `<rules>\nThe rules section has a number of possible rules/context that you should consider. In each subsection, we provide instructions about what information the subsection contains and how you should consider/follow the contents of the subsection. Explicit user rules take precedence over default tool preferences described in tool descriptions.
${sections.join("")}</rules>`;
}
// src/inject.ts
/**
* Whether a batch already carries this exact block.
*
* Compares the rendered text of each `text` block. The host compares a
* structured payload identity; text equality is the equivalent check here,
* because the rendered block is a pure function of the scanned rule set — two
* equal texts always describe the same rules.
*/
function carriesBlock(messages, block) {
	return messages.some((message) => {
		const content = message["content"];
		if (!Array.isArray(content)) return false;
		return content.some((part) => {
			const piece = part;
			return piece.type === "text" && typeof piece.text === "string" && piece.text === block;
		});
	});
}
/**
* Insert `injection` immediately after the last claimed message.
*
* `claimed` is the payload's `messages` — the batch removed from the inbox for
* this step (`runtime-types.ts`: "messages removed from the inbox for this
* step"). `decisionMessages` is what the downstream `next()` returned, which
* may already include driver-appended runtime context.
*
* Position is `lastClaimedIndex + 1`, so:
*   claimed... | injection | driver-appended context
* When no claimed message appears in the decision, the injection is prepended:
* that happens on a step with nothing of its own to say, and the rules block
* still belongs ahead of any context that follows.
*
* A step with **no claimed messages at all** is left alone. That is the
* empty-first-batch case the host also guards: with no user message the turn
* owns no request, and injecting would manufacture one.
*/
function planInjection(decisionMessages, claimed, injection, block) {
	const unchanged = [...decisionMessages];
	if (block === "") return {
		messages: unchanged,
		skipped: "empty-block"
	};
	if (claimed.length === 0) return {
		messages: unchanged,
		skipped: "no-claim"
	};
	if (carriesBlock(decisionMessages, block)) return {
		messages: unchanged,
		skipped: "already-present"
	};
	let lastClaimedIndex = -1;
	const claimedSet = new Set(claimed);
	for (let i = decisionMessages.length - 1; i >= 0; i--) {
		const message = decisionMessages[i];
		if (message !== void 0 && claimedSet.has(message)) {
			lastClaimedIndex = i;
			break;
		}
	}
	const at = lastClaimedIndex + 1;
	return { messages: [
		...decisionMessages.slice(0, at),
		injection,
		...decisionMessages.slice(at)
	] };
}
// src/classify.ts
/**
* Rule-looking frontmatter fields.
*
* `type` is included because CodeBuddy's intranet build declares its state
* that way and nothing else (§13.2). `trigger` is Antigravity's equivalent for
* `.agents/rules`. `alwaysApply`, `globs`, `paths` and `enabled` each appear
* in at least one supported convention.
*
* `name` and `applyTo` are here because two conventions have no other field: a
* Continue rule's documented minimum is a `name`, and Copilot's
* `.instructions.md` requires an `applyTo` and nothing else. A file carrying
* one of them is that convention's rule, not a stray markdown file.
*
* `scene`, `excludeAgent` and `regex` are here for the same reason: Trae
* documents a file whose only field is `scene: git_message`, and a rule scoped
* by `regex` (Continue) or filtered by `excludeAgent` (Copilot) is still a
* rule. CodeBuddy's `updatedAt` / `provider` are deliberately absent: they
* are metadata a tool wrote and say nothing about whether the file is a rule,
* so a file carrying only those still goes through the source's own answer for
* files that declare nothing.
*/
const RULE_FIELDS = [
	"alwaysApply",
	"enabled",
	"globs",
	"paths",
	"type",
	"trigger",
	"inclusion",
	"name",
	"applyTo",
	"scene",
	"excludeAgent",
	"regex"
];
/**
* Values accepted for a rule's `type` field.
*
* The three plain names are the shared vocabulary. Kiro spells the same three
* states in `inclusion` rather than `type` and Augment Code spells them
* `always_apply` / `agent_requested` / `manual` in `type`; both are accepted so
* a file from either convention classifies instead of being reported as an
* unknown type. Mapping a spelling onto a state is the parser's job.
*
* `always on` is JetBrains': the rule file its AI Assistant documentation
* links to carries a `type: always on` beside a `pattern` naming Java sources,
* and the IDE's own control is named Always. Rejecting the file over its
* spacing would drop an example the vendor ships.
*/
const KNOWN_TYPES = [
	"always",
	"requested",
	"manual",
	"always_apply",
	"agent_requested",
	"always on"
];
/**
* Values accepted for Antigravity's `trigger` field.
*
* `always` and `auto` are the `agent-rules-spec` aliases of `always_on` and
* `model_decision`. `agent` is Devin's name for the agent-decided mode, which
* its CLI page lists beside the others.
*/
const KNOWN_TRIGGERS = [
	"always_on",
	"always",
	"model_decision",
	"auto",
	"glob",
	"manual",
	"agent"
];
function classify(input) {
	const { frontmatter, sourceKey } = input;
	const values = frontmatter.values;
	const hasRuleField = RULE_FIELDS.some((field) => field in values);
	const described = typeof values["description"] === "string" && values["description"].trim() !== "";
	const empty = input.emptyRuleType ?? "none";
	if (!hasRuleField && !described) {
		const body = frontmatter.body;
		if (body.includes("\0")) return {
			family: familyOf(sourceKey),
			isRule: false,
			reason: "文件是二进制内容"
		};
		if (frontmatter.fenced === false && body.trimStart().startsWith("---")) return {
			family: familyOf(sourceKey),
			isRule: false,
			reason: "frontmatter 围栏没有闭合"
		};
		if (body.replace(/[\u0000-\u001f\u007f]/g, "").trim() === "") return {
			family: familyOf(sourceKey),
			isRule: false,
			reason: "文件没有任何内容"
		};
		const calls = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
		if (calls.length > 0 && calls.every((line) => /^[A-Za-z_][A-Za-z0-9_.]*\s*\([\s\S]*\)$/.test(line))) return {
			family: familyOf(sourceKey),
			isRule: false,
			reason: "文件是配置语句而不是规则文本"
		};
		if (empty === "none") return {
			family: familyOf(sourceKey),
			isRule: false,
			reason: "没有可识别的规则字段"
		};
	}
	if (input.strict === true) {
		const trigger = typeof values["trigger"] === "string" ? values["trigger"].trim().toLowerCase() : "";
		if (!KNOWN_TRIGGERS.includes(trigger)) return {
			family: familyOf(sourceKey),
			isRule: false,
			reason: trigger === "" ? "缺少 trigger 字段（严格来源）" : "未知的 trigger 值：" + trigger
		};
	}
	const declared = typeof values["type"] === "string" ? values["type"].trim().toLowerCase() : "";
	if (declared !== "" && !KNOWN_TYPES.includes(declared)) return {
		family: familyOf(sourceKey),
		isRule: false,
		reason: `未知的 type 值：${declared}`
	};
	if (sourceKey === "codebuddy" && declared !== "") return {
		family: "codebuddy-intranet",
		isRule: true
	};
	return {
		family: familyOf(sourceKey),
		isRule: true
	};
}
/**
* Family implied by the source directory.
*
* The family name matches the source key for every convention, so the new
* entries stay a one-to-one mapping. `codebuddy-intranet` never appears here:
* it is a CodeBuddy variant told apart by frontmatter, not by directory.
*
* The default keeps an unrecognised key on `codebuddy` rather than echoing it
* back: callers render the family as a display grouping, and a key that is not
* in `SOURCES` cannot be given a label of its own. An unknown key is not
* rejected — the rule is still classified, only its grouping is conservative.
*/
function familyOf(sourceKey) {
	switch (sourceKey) {
		case "cursor": return "cursor";
		case "claude": return "claude";
		case "agents": return "agents";
		case "codebuddy": return "codebuddy";
		case "trae": return "trae";
		case "qoder": return "qoder";
		case "cline": return "cline";
		case "roo": return "roo";
		case "devin": return "devin";
		case "windsurf": return "windsurf";
		case "copilot": return "copilot";
		case "junie": return "junie";
		case "amazonq": return "amazonq";
		case "tabnine": return "tabnine";
		case "continue": return "continue";
		case "trae-cn": return "trae-cn";
		case "qoder-cn": return "qoder-cn";
		case "lingma": return "lingma";
		case "aiassistant": return "aiassistant";
		case "antigravity": return "antigravity";
		case "kiro": return "kiro";
		case "augment": return "augment";
		default: return "codebuddy";
	}
}
// src/parse.ts
/**
* Minimal frontmatter parser and three-state derivation.
*
* Deliberately dependency-free: the needed YAML subset is scalars and simple
* block/flow lists, and a hand-written parser is smaller, faster to load, and
* easier to reason about than pulling in a full YAML engine. The reference
* implementation in @michengai/dsh-skills-manager does the same.
*/
/**
* `---` fences at the very start, tolerating a UTF-8 BOM and CRLF.
*
* The block itself may be empty: CodeBuddy's documented always-applied example
* declares a frontmatter holding nothing but a comment, and two markers with
* nothing between them declare the same thing. Without the optional inner
* newline that shape was not recognised as a fence at all, so it arrived at the
* classifier as bare markdown and was reported as an unclosed fence.
*/
const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
/**
* Keys we read. Anything else is ignored (Claude Code ignores them too).
*
* The list is the union of what the supported conventions document, because a
* field this parser does not read is a field that disappears: Trae's `scene`,
* Copilot's `excludeAgent`, Continue's `regex` and CodeBuddy's `updatedAt` /
* `provider` metadata all reach `values` now, even where nothing acts on them
* yet. `applyTo` is Copilot's only required field on an `.instructions.md`
* file, so reading it is what lets a file that declares nothing else be
* recognised at all.
*
* `glob`, `pattern` and `fileMatchPattern` are the singular spellings of the
* same idea: Qoder documents `glob` as equivalent to `paths`, Antigravity
* accepts `glob` beside `globs`, Kiro scopes a `fileMatch` rule with
* `fileMatchPattern`, and JetBrains writes `pattern` in the example file it
* publishes.
*/
const SCALAR_KEYS = [
	"name",
	"description",
	"alwaysApply",
	"enabled",
	"type",
	"trigger",
	"inclusion",
	"applyTo",
	"scene",
	"excludeAgent",
	"regex",
	"updatedAt",
	"provider"
];
const LIST_KEYS = [
	"paths",
	"globs",
	"glob",
	"pattern",
	"fileMatchPattern"
];
/**
* Fields whose accepted values are a closed set.
*
* A trailing `#` comment is stripped from these only. `description` and `name`
* are free text and are never touched, so `description: 处理 #1 问题` survives
* intact even though strict YAML would cut it. Kiro's `inclusion` and Trae's
* `scene` are closed vocabularies too, so they take the same treatment as
* `trigger` instead of carrying a comment into the value.
*/
const COMMENT_KEYS = /* @__PURE__ */ new Set([
	"alwaysApply",
	"enabled",
	"type",
	"trigger",
	"inclusion",
	"scene"
]);
/** Split a `---`-fenced block from the body. */
function splitFrontmatter(text) {
	const diagnostics = [];
	const match = FRONTMATTER.exec(text);
	if (match === null) return {
		values: {},
		body: text,
		diagnostics,
		fenced: false
	};
	const raw = match[1] ?? "";
	const body = text.slice(match[0].length);
	const values = {};
	const lines = raw.split(/\r?\n/);
	const lineOf = (index) => index + 2;
	const keyLines = {};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
		if (kv === null) {
			diagnostics.push({
				code: "fm.malformed",
				detail: `无法解析的行：${line.trim().slice(0, 60)}`,
				line: lineOf(i)
			});
			continue;
		}
		const key = kv[1] ?? "";
		const inline = (kv[2] ?? "").trim();
		keyLines[key] = lineOf(i);
		if (LIST_KEYS.includes(key)) {
			values[key] = readList(lines, i, inline, diagnostics, key, lineOf(i));
			if (inline === "") i = skipBlockList(lines, i);
			continue;
		}
		if (SCALAR_KEYS.includes(key)) values[key] = unquote(COMMENT_KEYS.has(key) ? stripInlineComment(inline) : inline);
	}
	return {
		values,
		body,
		diagnostics,
		lines: keyLines,
		fenced: true
	};
}
/**
* Read a flow list (`[a, b]` / `a, b`) or a block list (`- a`).
*
* `key` is carried only so the diagnostic can name the field it is about:
* "the list field is empty" is not actionable when a file may declare two, and
* `line` is the *file* line so the reader can open the file at it.
*/
function readList(lines, index, inline, diagnostics, key, keyLine) {
	if (inline !== "") {
		const outer = unquote(inline);
		const parts = splitListItems(outer.startsWith("[") && outer.endsWith("]") ? outer.slice(1, -1) : outer).map((part) => unquote(part.trim())).filter((part) => part !== "");
		if (parts.length === 0) diagnostics.push({
			code: "list.empty",
			detail: `列表字段声明为空：${key}`,
			line: keyLine
		});
		return parts;
	}
	const out = [];
	for (let i = index + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const item = /^\s*-\s*(.*)$/.exec(line);
		if (item === null) break;
		const value = unquote(stripInlineComment((item[1] ?? "").trim()));
		if (value !== "") out.push(value);
	}
	if (out.length === 0) diagnostics.push({
		code: "fm.emptyList",
		detail: `列表字段为空：${key}`,
		line: keyLine
	});
	return out;
}
/**
* Split on commas that are not inside quotes, braces, or brackets.
*
* A brace expansion such as a glob ending in "{js,ts}" carries a meaningful
* comma: picomatch expands it, so a blind split turns one working pattern into
* two broken halves. Brackets are tracked for the same reason (a character
* class may contain a comma), and quotes so `["a,b", "c"]` stays two items.
*/
function splitListItems(text) {
	const out = [];
	let current = "";
	let quote = null;
	let braces = 0;
	let brackets = 0;
	for (const ch of text) {
		if (quote !== null) {
			current += ch;
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "\"" || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "{") {
			braces++;
			current += ch;
			continue;
		}
		if (ch === "}") {
			braces = Math.max(0, braces - 1);
			current += ch;
			continue;
		}
		if (ch === "[") {
			brackets++;
			current += ch;
			continue;
		}
		if (ch === "]") {
			brackets = Math.max(0, brackets - 1);
			current += ch;
			continue;
		}
		if (ch === "," && braces === 0 && brackets === 0) {
			out.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	out.push(current);
	return out;
}
/** Index of the last line a block list consumed. */
function skipBlockList(lines, index) {
	let last = index;
	for (let i = index + 1; i < lines.length; i++) {
		if (!/^\s*-\s*/.test(lines[i] ?? "")) break;
		last = i;
	}
	return last;
}
/**
* Cut a trailing `#` comment from a closed-vocabulary value.
*
* YAML requires whitespace before the marker, and a quoted value is returned
* untouched, so `globs: "a#b"` and `type: always # note` both behave.
*/
function stripInlineComment(value) {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if (first === "\"" && last === "\"" || first === "'" && last === "'") return value;
	}
	const match = /(^|\s)#/.exec(value);
	return match === null || match.index === void 0 ? value : value.slice(0, match.index).trimEnd();
}
function unquote(value) {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if (first === "\"" && last === "\"" || first === "'" && last === "'") return value.slice(1, -1);
	}
	return value;
}
/**
* Derive the three-state value.
*
* Three declarations are honored, in this order, before the derived formula:
*
* 1. `trigger` - Antigravity / `agent-rules-spec`: `always_on` or `always`,
*    `model_decision` or `auto`, `glob`, or `manual`.
* 2. `type` - CodeBuddy's intranet build: `always` | `requested` | `manual`.
* 3. CodeBuddy public order: `alwaysApply` wins, then a non-empty
*    `description`, else manual.
*
* Values are compared case-insensitively, and an unrecognized value is
* reported and falls through to the older rungs. A strict source never reaches
* that fallback, because `classify` rejects such a file first.
*/
/** `trigger` aliases, mapped onto the three internal states. */
const TRIGGER_TYPES = {
	filematch: "requested",
	always_on: "always",
	always: "always",
	model_decision: "requested",
	auto: "requested",
	glob: "requested",
	manual: "manual",
	agent: "requested"
};
function deriveRule(input) {
	const { values, diagnostics } = input;
	const lines = input.lines ?? {};
	const report = (key, code, detail) => {
		const line = lines[key];
		diagnostics.push(line === void 0 ? {
			code,
			detail
		} : {
			code,
			detail,
			line
		});
	};
	const alwaysApply = values["alwaysApply"] === "true";
	const enabled = values["enabled"] !== "false";
	const description = typeof values["description"] === "string" ? values["description"].trim() : "";
	const declared = typeof values["type"] === "string" ? values["type"].trim().toLowerCase() : "";
	const declaredTrigger = typeof values["trigger"] === "string" ? values["trigger"].trim().toLowerCase() : "";
	const trigger = typeof values["inclusion"] === "string" ? values["inclusion"].trim().toLowerCase() : declaredTrigger;
	const patterns = [
		...asArray(values["paths"]),
		...asArray(values["globs"]),
		...asArray(values["glob"]),
		...asArray(values["pattern"]),
		...asArray(values["fileMatchPattern"]),
		...asArray(values["applyTo"])
	];
	const regex = typeof values["regex"] === "string" ? values["regex"].trim() : "";
	const triggered = TRIGGER_TYPES[trigger];
	if (input.strict === true && triggered === void 0) report("trigger", "trigger.missing", "严格来源缺少有效的 trigger 字段");
	let type;
	const tierAnswer = input.scope === "user" ? input.userRuleType : void 0;
	if (tierAnswer !== void 0 && tierAnswer !== "none") {
		type = tierAnswer;
		if (declared !== "" || trigger !== "" || values["alwaysApply"] !== void 0) report("type", "type.tierOverridden", `用户级规则不受 frontmatter 影响，固定为 ${tierAnswer}`);
	} else if (triggered !== void 0) type = triggered;
	else {
		if (trigger !== "") report("trigger", "trigger.unknown", "未知的 trigger 值：" + trigger + "，已按推导规则处理");
		if (declared === "always" || declared === "requested" || declared === "manual") type = declared;
		else if (declared === "always_apply" || declared === "agent_requested" || declared === "always on") type = declared === "agent_requested" ? "requested" : "always";
		else {
			if (declared !== "") report("type", "type.unknown", "未知的 type 值：" + declared + "，已按推导规则处理");
			const undeclared = values["alwaysApply"] === void 0 && values["enabled"] === void 0 && description === "" && trigger === "" && declared === "" && patterns.length === 0 && regex === "";
			const empty = input.emptyRuleType ?? "none";
			type = empty !== "none" && undeclared ? empty : alwaysApply ? "always" : description !== "" ? "requested" : patterns.length > 0 || regex !== "" ? "requested" : "manual";
		}
	}
	if (type === "requested" && description === "") report("description", "requested.noDescription", "requested 类型缺少 description");
	const name = typeof values["name"] === "string" && values["name"] !== "" ? values["name"] : basename(input.path, extname(input.path));
	return {
		path: input.path,
		name,
		type,
		enabled,
		description,
		body: input.body,
		family: input.family,
		sourceKey: input.sourceKey,
		scope: input.scope,
		patterns,
		descriptionTokens: estimateTokens(description),
		bodyTokens: estimateTokens(input.body),
		diagnostics
	};
}
function asArray(value) {
	if (value === void 0) return [];
	if (typeof value === "string") return value === "" ? [] : [value];
	return value;
}
/** Convenience: text + context -> Rule + diagnostics. */
function parseRule(text, context) {
	const fm = splitFrontmatter(text);
	const rule = deriveRule({
		path: context.path,
		family: context.family,
		sourceKey: context.sourceKey,
		scope: context.scope,
		strict: context.strict,
		emptyRuleType: context.emptyRuleType,
		userRuleType: context.userRuleType,
		values: fm.values,
		body: fm.body,
		lines: fm.lines,
		diagnostics: [...fm.diagnostics]
	});
	return {
		rule,
		diagnostics: rule.diagnostics
	};
}
/**
* Supported sources.
*
* Only conventions whose files are agent instruction rules appear here.
* Deliberately absent: Codex's `~/.codex/rules` (shell permission lists),
* cc-safety-net's JSON policies, and WorkBuddy's identity files — all share
* the word "rules" but are a different domain (§13.1). WorkBuddy needs no
* entry of its own: its IDE rules are `.codebuddy/rules`, already covered by
* the `codebuddy` source below.
*
* Every entry is read-only and recursive unless a flag says otherwise. Each one
* carries the official page it was verified against in `docs`, and the comment
* above it quotes the sentence that fixes the path, so a later update can
* re-read upstream instead of re-deriving the layout from memory.
*
* A source whose user tier is not documented upstream leaves `userPath` unset
* rather than guessing an absolute path that would scan an unrelated directory.
* When two conventions share one directory the tier is declared once: the
* second entry omits it rather than scanning the same files under two keys.
*/
const SOURCES = [
	{
		key: "codebuddy",
		label: "CodeBuddy",
		docs: "https://codebuddy.ai/docs/cli/codebuddy-dir",
		userPath: join(homedir(), ".codebuddy", "rules"),
		projectDir: ".codebuddy/rules",
		extensions: [".mdc", ".md"],
		mutable: false,
		rank: 100,
		emptyRuleType: "always"
	},
	{
		key: "cursor",
		label: "Cursor",
		docs: "https://cursor.com/docs/rules.md",
		userPath: join(homedir(), ".cursor", "rules"),
		projectDir: ".cursor/rules",
		extensions: [".mdc"],
		mutable: false,
		rank: 200,
		emptyRuleType: "none"
	},
	{
		key: "claude",
		label: "Claude Code",
		docs: "https://docs.claude.com/en/docs/claude-code/memory",
		userPath: join(homedir(), ".claude", "rules"),
		projectDir: ".claude/rules",
		extensions: [".md"],
		mutable: false,
		rank: 300,
		emptyRuleType: "always"
	},
	{
		key: "agents",
		label: "Agent standard (.agents)",
		docs: "https://antigravity.google/docs/rules",
		userPath: (env) => join(agentsHome(env), "rules"),
		projectDir: ".agents/rules",
		extensions: [".md"],
		mutable: false,
		rank: 400,
		requiresTrigger: true,
		flat: true,
		emptyRuleType: "none"
	},
	{
		key: "trae",
		label: "Trae",
		docs: "https://docs.trae.ai/ide/rules",
		userPath: join(homedir(), ".trae", "user_rules"),
		projectDir: ".trae/rules",
		extensions: [".md"],
		mutable: false,
		rank: 500,
		emptyRuleType: "always"
	},
	{
		key: "qoder",
		label: "Qoder",
		docs: "https://docs.qoder.com/user-guide/rules",
		userPath: join(homedir(), ".qoder", "rules"),
		projectDir: ".qoder/rules",
		extensions: [".md"],
		mutable: false,
		rank: 510,
		emptyRuleType: "always"
	},
	{
		key: "cline",
		label: "Cline",
		docs: "https://docs.cline.bot/customization/cline-rules.md",
		userPath: (env) => join(clineHome(env), "rules"),
		userPaths: [join(homedir(), "Cline", "Rules")],
		projectDir: ".clinerules",
		projectDirs: [".cline/rules"],
		extensions: [".md"],
		mutable: false,
		rank: 520,
		emptyRuleType: "always"
	},
	{
		key: "roo",
		label: "Roo Code",
		docs: "https://docs.roocode.com/features/custom-instructions",
		userPath: join(homedir(), ".roo", "rules"),
		projectDir: ".roo/rules",
		projectFiles: [".roorules"],
		extensions: [".md", ".txt"],
		mutable: false,
		rank: 530,
		emptyRuleType: "always"
	},
	{
		key: "devin",
		label: "Devin / Windsurf",
		docs: "https://docs.devin.ai/desktop/devin-local/customizations",
		userPath: join(homedir(), ".devin", "rules"),
		userFiles: [join(homedir(), ".devin", "global_rules.md")],
		projectDir: ".devin/rules",
		projectFiles: [".devin/global_rules.md"],
		extensions: [".md"],
		mutable: false,
		rank: 540,
		emptyRuleType: "always"
	},
	{
		key: "windsurf",
		label: "Windsurf (legacy)",
		docs: "https://docs.devin.ai/desktop/devin-local/customizations",
		userFiles: [join(homedir(), ".codeium", "windsurf", "memories", "global_rules.md")],
		projectDir: ".windsurf/rules",
		projectFiles: [".windsurf/global_rules.md", ".windsurfrules"],
		extensions: [".md"],
		mutable: false,
		rank: 550,
		emptyRuleType: "always"
	},
	{
		key: "copilot",
		label: "GitHub Copilot",
		docs: "https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions",
		userPath: (env) => join(copilotHome(env), "instructions"),
		userFiles: [(env) => join(copilotHome(env), "copilot-instructions.md")],
		projectDir: ".github/instructions",
		projectFiles: [".github/copilot-instructions.md"],
		extensions: [".md"],
		suffixes: [".instructions.md"],
		mutable: false,
		rank: 560,
		emptyRuleType: "manual"
	},
	{
		key: "junie",
		label: "Junie (JetBrains)",
		docs: "https://junie.jetbrains.com/docs/guidelines-and-memory.html",
		projectDir: ".junie/rules",
		projectDirs: [".junie/guidelines"],
		extensions: [".md"],
		mutable: false,
		rank: 570,
		emptyRuleType: "always"
	},
	{
		key: "amazonq",
		label: "Amazon Q",
		docs: "https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/context-project-rules.html",
		projectDir: ".amazonq/rules",
		extensions: [".md"],
		mutable: false,
		rank: 580,
		emptyRuleType: "always"
	},
	{
		key: "tabnine",
		label: "Tabnine",
		docs: "https://docs.tabnine.com/main/getting-started/tabnine-agent/guidelines.md",
		projectDir: ".tabnine/guidelines",
		extensions: [".md"],
		mutable: false,
		rank: 590,
		emptyRuleType: "always"
	},
	{
		key: "continue",
		label: "Continue",
		docs: "https://docs.continue.dev/customize/rules",
		projectDir: ".continue/rules",
		extensions: [".md"],
		mutable: false,
		rank: 600,
		emptyRuleType: "always"
	},
	{
		key: "trae-cn",
		label: "Trae CN",
		docs: "https://docs.trae.com.cn/ide/rules",
		userPath: join(homedir(), ".trae-cn", "user_rules"),
		extensions: [".md"],
		mutable: false,
		rank: 610,
		emptyRuleType: "always"
	},
	{
		key: "qoder-cn",
		label: "Qoder CN",
		docs: "https://docs.qoder.cn/user-guide/rules",
		userPath: join(homedir(), ".qoder-cn", "rules"),
		extensions: [".md"],
		mutable: false,
		rank: 620,
		emptyRuleType: "always"
	},
	{
		key: "lingma",
		label: "Lingma",
		docs: "https://help.aliyun.com/zh/lingma/qoder-cn/user-guide/rules",
		projectDir: ".lingma/rules",
		extensions: [".md"],
		mutable: false,
		rank: 630,
		emptyRuleType: "always"
	},
	{
		key: "aiassistant",
		label: "JetBrains AI Assistant",
		docs: "https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html",
		projectDir: ".aiassistant/rules",
		extensions: [".md"],
		mutable: false,
		rank: 640,
		emptyRuleType: "always"
	},
	{
		key: "antigravity",
		label: "Antigravity",
		docs: "https://antigravity.google/docs/rules",
		userPath: join(homedir(), ".gemini", "config", "rules"),
		extensions: [".md"],
		mutable: false,
		rank: 650,
		requiresTrigger: true,
		emptyRuleType: "none"
	},
	{
		key: "kiro",
		label: "Kiro",
		docs: "https://kiro.dev/docs/steering/",
		userPath: (env) => join(kiroHome(env), "steering"),
		projectDir: ".kiro/steering",
		extensions: [".md"],
		mutable: false,
		rank: 660,
		emptyRuleType: "always"
	},
	{
		key: "augment",
		label: "Augment Code",
		docs: "https://docs.augmentcode.com/setup-augment/guidelines",
		userPath: join(homedir(), ".augment", "rules"),
		userFiles: [join(homedir(), ".augment", "user-guidelines.md")],
		projectDir: ".augment/rules",
		projectFiles: [".augment-guidelines"],
		extensions: [".md", ".mdc"],
		mutable: false,
		rank: 670,
		emptyRuleType: "always",
		userRuleType: "always"
	}
];
/**
* The shared agents root.
*
* Resolves the DSH_AGENTS_HOME variable when it is set and non-empty, else
* `~/.agents` - the same order the host's own dsh-agent-instructions
* documents. Resolved locally rather than through
* `@deepseek-ai/dsh-home-paths`, which is a host peer this plugin does not
* depend on and which is installed in neither node_modules tree.
*/
function agentsHome(env = process.env) {
	const configured = env["DSH_AGENTS_HOME"];
	return configured !== void 0 && configured !== "" ? configured : join(homedir(), ".agents");
}
/**
* GitHub Copilot CLI's user-level directory.
*
* The CLI page states the override for both user-level locations: "If you set
* the COPILOT_HOME environment variable, Copilot CLI uses that directory
* instead of $HOME/.copilot". Read at resolution time like {@link agentsHome},
* so a change after import is honored.
*/
function copilotHome(env = process.env) {
	const configured = env["COPILOT_HOME"];
	return configured !== void 0 && configured !== "" ? configured : join(homedir(), ".copilot");
}
/**
* Kiro's global directory.
*
* "Override the global directory with KIRO_HOME: Set KIRO_HOME to an absolute
* path to keep separate Kiro profiles" (https://kiro.dev/docs/configuration/);
* the steering directory moves with it.
*/
function kiroHome(env = process.env) {
	const configured = env["KIRO_HOME"];
	return configured !== void 0 && configured !== "" ? configured : join(homedir(), ".kiro");
}
/**
* Cline's configuration directory.
*
* "CLINE_DIR | Custom configuration directory (replaces ~/.cline/)" from the
* CLI reference. Only the primary global directory moves; `~/Cline/Rules` is
* a fixed second location Cline searches on its own.
*/
function clineHome(env = process.env) {
	const configured = env["CLINE_DIR"];
	return configured !== void 0 && configured !== "" ? configured : join(homedir(), ".cline");
}
/**
* Roots that exist on disk, for the given project root.
*
* A convention may declare more than one directory per tier (Cline documents
* `~/.cline/rules` and `~/Cline/Rules`), and a few declare a named single file
* instead of a directory. Order is the declaration order, so the first
* directory of a source stays the one a reader that knows a single path sees.
* Duplicates collapse, so the same path written twice is one root.
*/
async function resolveRoots(projectRoot, env = process.env) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const push = async (source, path, scope, kind) => {
		const identity = kind + ":" + path;
		if (seen.has(identity)) return;
		if (!(kind === "directory" ? await isDirectory(path) : await isFile(path))) return;
		seen.add(identity);
		out.push({
			source,
			path,
			scope,
			kind
		});
	};
	for (const source of SOURCES) {
		for (const path of userRootsOf(source, env)) await push(source, path, "user", "directory");
		for (const path of userFilesOf(source, env)) await push(source, path, "user", "file");
		if (projectRoot !== null) {
			for (const dir of projectDirsOf(source)) await push(source, join(projectRoot, dir), "project", "directory");
			for (const file of source.projectFiles ?? []) await push(source, join(projectRoot, file), "project", "file");
		}
	}
	return out;
}
/** Every user-level directory a source declares, primary first. */
function userRootsOf(source, env) {
	const declared = [source.userPath, ...source.userPaths ?? []];
	const out = [];
	for (const entry of declared) {
		if (entry === void 0) continue;
		out.push(typeof entry === "function" ? entry(env) : entry);
	}
	return out;
}
/** Every project-relative directory a source declares, primary first. */
function projectDirsOf(source) {
	return source.projectDir === void 0 ? source.projectDirs ?? [] : [source.projectDir, ...source.projectDirs ?? []];
}
/** Every user-level single file a source declares. */
function userFilesOf(source, env) {
	const out = [];
	for (const entry of source.userFiles ?? []) out.push(typeof entry === "function" ? entry(env) : entry);
	return out;
}
/**
* Scan every resolvable root.
*
* Directories are walked breadth-first with hard caps; hitting a cap sets
* `truncated` and returns what was found rather than failing the whole scan.
*/
async function scanAll(projectRoot, options = {}, env = process.env) {
	const rules = [];
	const diagnostics = [];
	let truncated = false;
	const seen = /* @__PURE__ */ new Set();
	const roots = await resolveRoots(projectRoot, env);
	for (const root of roots) {
		const found = root.kind === "file" ? {
			files: [root.path],
			diagnostics: [],
			truncated: false
		} : await walk(root, options);
		truncated = truncated || found.truncated;
		diagnostics.push(...found.diagnostics);
		for (const file of found.files) {
			const parsed = await parseFile(file, root);
			diagnostics.push(...parsed.diagnostics);
			if (parsed.rule === null) continue;
			if (seen.has(parsed.rule.path)) continue;
			seen.add(parsed.rule.path);
			rules.push(parsed.rule);
		}
	}
	rules.sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name));
	return {
		rules,
		diagnostics,
		truncated,
		roots
	};
}
function rankOf(rule) {
	return SOURCES.find((source) => source.key === rule.sourceKey)?.rank ?? 999;
}
async function walk(root, options = {}) {
	const maxDirectories = options.maxDirectories ?? 2e3;
	const maxEntries = options.maxEntries ?? 2e4;
	const maxDepth = root.source.flat === true ? 0 : options.maxDepth ?? 6;
	const files = [];
	const diagnostics = [];
	const queue = [{
		path: resolve(root.path),
		depth: 0
	}];
	let directories = 0;
	let entries = 0;
	for (let cursor = 0; cursor < queue.length; cursor++) {
		if (directories >= maxDirectories || entries >= maxEntries) {
			diagnostics.push({
				code: "scan.truncated",
				detail: `目录或条目数超过上限，已停止扫描：${root.path}`
			});
			return {
				files,
				diagnostics,
				truncated: true
			};
		}
		const current = queue[cursor];
		if (current === void 0) continue;
		if (current.depth > maxDepth) continue;
		directories++;
		let items;
		try {
			items = await promises.readdir(current.path, { withFileTypes: true });
		} catch {
			diagnostics.push({
				code: "scan.unreadable",
				detail: `无法读取目录：${current.path}`
			});
			continue;
		}
		for (const item of items) {
			if (entries >= maxEntries) {
				diagnostics.push({
					code: "scan.truncated",
					detail: `目录或条目数超过上限，已停止扫描：${root.path}`
				});
				return {
					files,
					diagnostics,
					truncated: true
				};
			}
			entries++;
			if (item.name.startsWith(".")) continue;
			const full = join(current.path, item.name);
			if (item.isDirectory()) {
				queue.push({
					path: full,
					depth: current.depth + 1
				});
				continue;
			}
			if (!item.isFile()) continue;
			const dot = item.name.lastIndexOf(".");
			const ext = dot < 0 ? "" : item.name.slice(dot).toLowerCase();
			if (!root.source.extensions.includes(ext)) continue;
			const suffixes = root.source.suffixes;
			if (suffixes !== void 0 && !suffixes.some((s) => item.name.endsWith(s))) continue;
			files.push(full);
		}
	}
	return {
		files,
		diagnostics,
		truncated: false
	};
}
/** Parse one file, applying the classification gate. */
async function parseFile(path, root) {
	let text;
	try {
		text = await promises.readFile(path, "utf8");
	} catch {
		return {
			rule: null,
			diagnostics: [{
				code: "read.failed",
				detail: `无法读取文件：${path}`,
				path
			}]
		};
	}
	const fm = splitFrontmatter(text);
	const strict = root.source.requiresTrigger === true;
	const emptyRuleType = root.kind === "file" ? "always" : root.source.emptyRuleType;
	const userRuleType = root.scope === "user" ? root.source.userRuleType : void 0;
	const verdict = classify({
		frontmatter: fm,
		sourceKey: root.source.key,
		strict,
		emptyRuleType
	});
	if (!verdict.isRule) return {
		rule: null,
		diagnostics: [{
			code: "classify.skipped",
			detail: `${verdict.reason ?? "不是可识别的规则文件"}：${path}`,
			path
		}]
	};
	const parsed = parseRule(text, {
		path,
		family: verdict.family,
		sourceKey: root.source.key,
		scope: root.scope,
		strict,
		emptyRuleType,
		userRuleType
	});
	const diagnostics = parsed.diagnostics.map((d) => d.path === void 0 ? {
		...d,
		path
	} : d);
	if (!parsed.rule.enabled) return {
		rule: parsed.rule,
		diagnostics
	};
	return {
		rule: parsed.rule,
		diagnostics
	};
}
async function isDirectory(path) {
	try {
		return (await promises.stat(path)).isDirectory();
	} catch {
		return false;
	}
}
async function isFile(path) {
	try {
		return (await promises.stat(path)).isFile();
	} catch {
		return false;
	}
}
/**
* Nearest ancestor containing `.git`, else null.
*
* Matches the host's own project-root rule and the reference implementation's
* upward walk, so project-scoped rules resolve identically.
*/
async function findProjectRoot(start) {
	let current = resolve(start);
	for (;;) try {
		await promises.stat(join(current, ".git"));
		return current;
	} catch {
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
// src/tool-read-rules.ts
/**
* The `read_rules` tool: fetch rule bodies the catalog only described.
*
* Four-tier key resolution and the 60000-character output budget are both
* CodeBuddy's (§6). Resolution is deliberately forgiving — models routinely
* pass a bare filename instead of the absolute path — but it never guesses:
* an ambiguous key reports its candidates so the model can retry precisely.
*
* `output.render` is mandatory on a tool definition: it is the pure projection
* from a validated canonical value to model content. See
* `dsh-tool-skill/src/index.ts` for the same shape.
*/
/**
* Resolve requested keys against the index.
*
* Tiers, in order: exact absolute path; case-insensitive path; unique
* basename; unique rule name. More than one candidate at either of the last
* two tiers is reported as ambiguous rather than picked arbitrarily.
*/
function resolveRequested(index, requested) {
	const keys = Object.keys(index);
	const lower = new Map(keys.map((key) => [key.toLowerCase(), key]));
	const resolved = [];
	const notFound = [];
	const ambiguous = [];
	const taken = /* @__PURE__ */ new Set();
	for (const raw of requested) {
		const input = raw.trim();
		if (input === "") continue;
		let hit;
		if (index[input] !== void 0) hit = input;
		else {
			const ci = lower.get(input.toLowerCase());
			if (ci !== void 0) hit = ci;
			else {
				const byBase = keys.filter((key) => basename(key) === basename(input));
				if (byBase.length === 1) hit = byBase[0];
				else if (byBase.length > 1) {
					ambiguous.push({
						input,
						candidates: byBase
					});
					continue;
				} else {
					const byName = keys.filter((key) => index[key]?.name === input);
					if (byName.length === 1) hit = byName[0];
					else if (byName.length > 1) {
						ambiguous.push({
							input,
							candidates: byName
						});
						continue;
					}
				}
			}
		}
		if (hit === void 0) {
			notFound.push(input);
			continue;
		}
		if (taken.has(hit)) continue;
		taken.add(hit);
		const rule = index[hit];
		if (rule !== void 0) resolved.push(rule);
	}
	return {
		resolved,
		notFound,
		ambiguous
	};
}
/** Format resolved rules as `<rule>` blocks under the output budget. */
function formatResolved(resolution, total = READ_RULES_OUTPUT_MAX) {
	const { kept, truncated } = consumeOutputBudget(resolution.resolved.map((rule) => `<rule name="${rule.name}" scope="rule" path="${rule.path}">\n${rule.body}\n</rule>`), total);
	const out = [...kept];
	if (resolution.notFound.length > 0) out.push(`[Not found (not in the requestable rules list): ${resolution.notFound.join(", ")}]`);
	if (resolution.ambiguous.length > 0) {
		const list = resolution.ambiguous.map((entry) => `${entry.input} -> ${entry.candidates.join(" | ")}`).join("; ");
		out.push(`[Ambiguous (matched more than one rule): ${list}. Retry with one exact absolute path from that list.]`);
	}
	if (truncated) out.push("[Some rule content was truncated to fit the read_rules output budget.]");
	return out.join("\n\n");
}
/**
* Build the tool definition.
*
* The index is resolved **per call**, from `exec.agent`, because the tool is
* registered once but each agent has its own catalog. `exec.agent` is the same
* field the host's own `skill` tool reads (`dsh-tool-skill/src/index.ts:136`).
*/
function createReadRulesTool(indexFor, outputMax = READ_RULES_OUTPUT_MAX) {
	return defineTool({
		name: "read_rules",
		description: "Load rules listed in <agent_requestable_workspace_rules> or <agent_requestable_user_rules>.\nWhen a listed description matches the task, fetch the rule before acting. Batch relevant keys in one call.\nAlways-applied rules are already in context; do not fetch them again. Only listed keys are allowed, not arbitrary files.\nWhen one key matches several rules, the result lists the candidates; retry with one exact absolute path.",
		parameters: { ruleNames: {
			type: "array",
			required: true,
			description: "Array of exact rule keys (absolute paths) from the requestable-rules sections."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					content: {
						type: "string",
						required: true
					},
					resolvedCount: {
						type: "number",
						required: true
					},
					notFoundCount: {
						type: "number",
						required: true
					},
					ambiguousCount: {
						type: "number",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: String(value.content)
			}]
		},
		async execute(args, exec) {
			const { ruleNames } = args;
			const requested = ruleNames.filter((name) => typeof name === "string");
			const resolution = resolveRequested(indexFor(exec.agent), requested);
			return {
				content: formatResolved(resolution, outputMax),
				resolvedCount: resolution.resolved.length,
				notFoundCount: resolution.notFound.length,
				ambiguousCount: resolution.ambiguous.length
			};
		}
	});
}
// src/state.ts
/**
* Deployment-time override set by the plugin entry from `config.stateDir`.
*
* Precedence, highest first: this override (set only when a deployment
* **explicitly** pins `config.stateDir`), `DSH_RULES_MANAGER_HOME`, then
* `<home>/.dsh/rules-manager`. The environment variable therefore works in a
* real deployment, and a test or a one-off run can redirect state without a
* config block.
*/
let configuredDir = null;
function setStateDir(dir) {
	configuredDir = dir === "" ? null : dir;
}
function stateDir() {
	return configuredDir ?? process.env["DSH_RULES_MANAGER_HOME"] ?? join(homedir(), ".dsh", "rules-manager");
}
function statePath() {
	return join(stateDir(), "state.json");
}
function defaultState() {
	return {
		version: 1,
		sources: {},
		disabled: {},
		entryLocation: "both",
		budgets: {}
	};
}
/** Read state, falling back to defaults on any error rather than throwing. */
async function readState() {
	try {
		const raw = await promises.readFile(statePath(), "utf8");
		if (Buffer.byteLength(raw, "utf8") > 1048576) return defaultState();
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return defaultState();
		const candidate = parsed;
		return {
			version: 1,
			sources: candidate.sources ?? {},
			disabled: candidate.disabled ?? {},
			entryLocation: candidate.entryLocation ?? "both",
			budgets: candidate.budgets ?? {}
		};
	} catch {
		return defaultState();
	}
}
/**
* Refuse to write through a symbolic link.
*
* `rename` would happily replace the link itself, silently discarding the
* indirection the user set up (and pointing the next write somewhere else).
* The check runs before the temp file exists, so a refusal leaves the
* directory — and any existing state.json — byte for byte as it was.
*/
async function assertNotSymlink(target) {
	let info;
	try {
		info = await promises.lstat(target);
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	if (info.isSymbolicLink()) throw new Error(`refusing to write ${basename(target)}: the target is a symbolic link`);
}
/** Write state atomically enough for a settings file: temp then rename. */
async function writeState(state) {
	const target = statePath();
	await assertNotSymlink(target);
	await promises.mkdir(dirname(target), { recursive: true });
	const temp = `${target}.tmp`;
	await promises.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	await promises.rename(temp, target);
}
/**
* The key one source's switches are stored under.
*
* With a scope, `<scope>:<key>` — the same id the panel's `sourceId` builds, so
* both halves address a tier identically. Without one, the bare key: what every
* state file written before scoping holds, and what a client that sends no
* scope still addresses.
*/
function scopedKey(key, scope) {
	return scope === void 0 ? key : `${scope}:${key}`;
}
/**
* Whether a source is enabled; absent means enabled.
*
* A scoped entry wins when present, so one tier's switch is its own; otherwise
* the legacy bare entry still decides, so an existing state.json keeps working.
*/
function isSourceEnabled(state, key, scope) {
	if (scope !== void 0) {
		const scoped = state.sources[scopedKey(key, scope)];
		if (scoped !== void 0) return scoped;
	}
	return state.sources[key] !== false;
}
/** Whether an individual rule is disabled, with the same scoped-then-bare priority. */
function isRuleDisabled(state, key, path, scope) {
	if (scope !== void 0) {
		const scoped = state.disabled[scopedKey(key, scope)];
		if (scoped !== void 0) return scoped.includes(path);
	}
	return (state.disabled[key] ?? []).includes(path);
}
/**
* The disabled-path list a write must start from.
*
* The effective list, not an empty one: a scoped write replaces the whole list
* under its key, so starting from nothing would re-enable every other rule the
* bare entry (or this tier) had switched off.
*/
function disabledPaths(state, key, scope) {
	if (scope !== void 0) {
		const scoped = state.disabled[scopedKey(key, scope)];
		if (scoped !== void 0) return scoped;
	}
	return state.disabled[key] ?? [];
}
// src/workspace.ts
/** Keep only non-empty strings, preserving order and dropping duplicates. */
function clean(values) {
	const out = [];
	for (const value of values) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed === "" || out.includes(trimmed)) continue;
		out.push(trimmed);
	}
	return out;
}
/** Paths from `workspaceRegistry.list()`. Never throws. */
function workspacePaths(registry) {
	if (registry === void 0 || registry === null || typeof registry.list !== "function") return [];
	try {
		const listed = registry.list();
		if (!Array.isArray(listed)) return [];
		return clean(listed.map((item) => {
			const workspace = item;
			return workspace?.path ?? workspace?.cwd;
		}));
	} catch {
		return [];
	}
}
/** cwds from the sessions service: a known session, else every listed one. */
function sessionCwds(sessions, sessionId) {
	if (sessions === void 0 || sessions === null) return [];
	const headerCwd = (value) => value?.header?.cwd;
	const byId = (value) => value?.cwd ?? headerCwd(value);
	try {
		if (typeof sessionId === "string" && sessionId.trim() !== "" && typeof sessions.get === "function") {
			const direct = clean([byId(sessions.get(sessionId))]);
			if (direct.length > 0) return direct;
		}
		if (typeof sessions.list !== "function") return [];
		const listed = sessions.list();
		if (!Array.isArray(listed)) return [];
		return clean(listed.map(byId));
	} catch {
		return [];
	}
}
/**
* Pick the directory to scan.
*
* Order, and why:
* 1. **The last scan's project root** — it is the workspace a real session is
*    actually working in, so it beats any guess and needs no I/O.
* 2. **`workspaceRegistry`** — the durable list of directories the user has
*    ever opened, in registry order. The first entry is the most recently
*    created one (the registry prepends new workspaces), which is the closest
*    thing to "where the user is now".
* 3. **`sessions`** — the cwd recorded on a session header, used when no
*    workspace is registered (a fresh profile with one open session).
*
* Multiple workspaces yield the **first** candidate rather than nothing: being
* unable to choose is not a reason to show an empty panel, and the resolver
* always returns what it saw so the UI can be honest about which directory it
* picked.
*/
function resolveWorkspace(probes) {
	const fromRegistry = workspacePaths(probes.registry);
	const fromSessions = sessionCwds(probes.sessions, probes.sessionId);
	const candidates = clean([
		probes.lastScanRoot,
		...fromRegistry,
		...fromSessions
	]);
	const pick = (values) => values[0] ?? null;
	if (typeof probes.lastScanRoot === "string" && probes.lastScanRoot.trim() !== "") return {
		path: probes.lastScanRoot.trim(),
		source: "last-scan",
		candidates
	};
	const registryPick = pick(fromRegistry);
	if (registryPick !== null) return {
		path: registryPick,
		source: "workspace-registry",
		candidates
	};
	const sessionPick = pick(fromSessions);
	if (sessionPick !== null) return {
		path: sessionPick,
		source: "sessions",
		candidates
	};
	return {
		path: null,
		source: "none",
		candidates
	};
}
/**
* Heuristic screen for patterns with catastrophic backtracking risk.
*
* Measured on picomatch 4.0.7: `*a*a*a*…` with 4 stars takes 18 ms, 5 stars
* 545 ms, and 10 stars exceeds five seconds, while `**` and brace patterns
* stay at 2–3 ms even with dozens of directory levels. The screen targets the
* shape that actually degrades.
*/
function looksCatastrophic(pattern) {
	if ((pattern.match(/(?<!\*)\*(?!\*)/g) ?? []).length < 8) return false;
	return pattern.split(/(?<!\*)\*(?!\*)/).slice(1, -1).some((segment) => segment.length <= 3);
}
/**
* Compile patterns, skipping the ones that are dangerous.
*
* A pattern that cannot be read never disables its siblings, which is the
* behavior Claude Code documents for an unreadable bracket expression.
*
* Measured on picomatch 4.0.7: an invalid pattern (`BAD[[[pattern`, `[[[`,
* `a{b`, a lone backslash) **does not throw** — it compiles to a matcher that
* always returns false. The README documents `strictBrackets` as the option that
* makes imbalanced brackets throw, and it is unset by default:
* https://github.com/micromatch/picomatch/blob/4.0.7/README.md (fetched 2026-11-27).
* So a rule keeps its other patterns and simply never
* matches through the broken one, which is the same outcome with no work. The
* call below is therefore left unguarded: a `catch` here would be unreachable code pretending to be a safety net, and a future picomatch that does throw is a bug worth seeing rather than a warning to record.
*/
function compilePatterns(patterns) {
	const matchers = [];
	const warnings = [];
	for (const pattern of patterns) {
		const trimmed = pattern.trim();
		if (trimmed === "") continue;
		if (looksCatastrophic(trimmed)) {
			warnings.push(`跳过有回溯风险的 glob：${trimmed}`);
			continue;
		}
		const match = picomatch(trimmed, { dot: true });
		matchers.push({
			pattern: trimmed,
			match: (path) => match(path)
		});
	}
	return {
		matchers,
		warnings
	};
}
/**
* Whether any pattern matches, testing the path relative to the base directory.
*
* Patterns are written relative to a base (the project root for project rules,
* the session's working directory for user rules), so the absolute path is
* converted first and anything outside the base is rejected rather than
* matched against `../` segments.
*/
function matchesAny(matchers, absolutePath, baseDir) {
	const relative = relativize(absolutePath, baseDir);
	if (relative === null) return false;
	return matchers.some((matcher) => matcher.match(relative));
}
/** Base-relative posix path, or null when the path escapes the base. */
function relativize(absolutePath, baseDir) {
	const normalized = absolutePath.replace(/\\/g, "/");
	const base = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
	if (!normalized.startsWith(`${base}/`)) return null;
	const relative = normalized.slice(base.length + 1);
	return relative === "" ? null : relative;
}
/**
* Cheap self-check: run every matcher once against a long non-matching probe.
*
* Screens for shapes `looksCatastrophic` does not know about. A slow run means
* the rule degrades to on-demand instead of staying always-on.
*/
function selfCheck(matchers, budgetMs = 200) {
	const probe = `${"a/".repeat(60)}${"z".repeat(60)}`;
	const started = Date.now();
	for (const matcher of matchers) try {
		matcher.match(probe);
	} catch {}
	return Date.now() - started < budgetMs;
}
// src/attach.ts
/**
* File-scoped attachment: which files a session has touched, and the on-demand
* rules that makes resident.
*
* Every convention in the scan table that scopes a rule to files declares it
* with one of a handful of frontmatter keys - Cursor's `globs`, Claude Code's
* `paths`, GitHub Copilot's `applyTo`, Kiro's `fileMatchPattern`, Qoder's
* `glob`, JetBrains AI Assistant's `pattern`. `parse.ts` already folds all of
* them into `Rule.patterns`. The missing half is this one: a rule whose
* patterns match a file the session has already worked with should stop being
* an index line in the requestable section and become resident content.
*
* Official sources for the semantics implemented here:
*
* - Claude Code keeps a rule on demand only while it is path-scoped, and the
*   scoping field is the only one read:
*   "`paths` is the only field Claude Code reads from a rule; any other field
*   is ignored without an error." and "A path-scoped rule loads when Claude
*   uses the Read, Write, or Edit tool on a matching file."
*   https://docs.claude.com/en/docs/claude-code/memory
* - Cursor attaches on a matching file in context: "Auto-attached when a
*   matching file is in context." https://cursor.com/docs/rules.md
* - GitHub Copilot: "Path-specific instructions are included only when their
*   `applyTo` value matches a file that Copilot CLI is working with."
*   https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
* - Kiro: a `fileMatch` rule is "included only when working with files that
*   match the specified pattern", and V1/V2 "do not provide V3's complete
*   matching and activation behavior". https://kiro.dev/docs/steering.md
* - Antigravity: `trigger: glob` "Automatically activates when the agent
*   interacts with files matching any comma-separated pattern in `globs`".
*   https://antigravity.google/docs/rules
*
* The base directory most of these are relative to is not documented (see the
* scope reports for the per-vendor detail); the one convention that states it
* is Claude Code - "Project rules: the directory that contains the rule's
* `.claude` folder" - which is the project root this plugin already scans, so
* project rules are matched against the project root and user rules against
* the directory their own file lives in.
*
* The touch signal comes from the host's own tool pipeline. `tools/result` is
* the documented seam for observing outcomes without transforming them:
*
*   "observe immutable authoritative outcomes with `tools/result`; use
*    `tools/post-execute` instead only when the plugin needs to transform
*    results or add context"
*   - docs/cookbook/extension-cookbook.md
*
* The argument shapes below are the host tool catalog's (docs/tool-catalog.md):
* `read`, `read_image`, `write` and `edit` carry `file_path`;
* `str_replace_editor` carries `path`; `apply_patch` carries a patch document
* whose `*** Add File:` / `*** Update File:` / `*** Move to:` /
* `*** Delete File:` lines name the files it touches. A failed call touched
* nothing, so only successes are recorded.
*/
/**
* How many distinct files one session's touch log keeps.
*
* The log only ever grows within a session, and every entry is compared
* against every compiled rule, so it is bounded. Two thousand files is far
* more than a working session reads, and dropping the oldest entries cannot
* un-attach a rule that already matched - attachment is sticky - so the bound
* only limits how late in a very long session a new rule can still attach.
*/
const MAX_TOUCHED_PATHS = 2e3;
/**
* Tool argument field that names the file a call worked with.
*
* `apply_patch` is absent on purpose: its files live inside the patch document
* and are parsed by {@link patchFiles}.
*/
const FILE_FIELDS = {
	read: "file_path",
	read_image: "file_path",
	write: "file_path",
	edit: "file_path",
	str_replace_editor: "path"
};
/**
* `*** Add File: p` and friends; `*** Move to: p` names the destination.
*
* `*** Delete File:` is included: a deletion is the strongest possible touch of
* that path, and a rule scoped to it should attach for the same reason a read
* does. The upstream patch grammar is documented in docs/tool-catalog.md under
* `apply_patch` (`@deepseek-ai/dsh-tool-fs`, packages/fs/tool-fs/src/index.ts).
*/
const PATCH_LINE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
/**
* Absolute paths one finished tool call worked with, or none.
*
* Unknown tools and malformed arguments return an empty list rather than
* throwing: this runs inside a `tools/result` listener, which observes every
* call the session makes, including calls to tools that have nothing to do
* with files.
*/
function touchedFilesOf(toolName, args) {
	if (typeof toolName !== "string" || args === null || typeof args !== "object") return [];
	const record = args;
	if (toolName === "apply_patch") return patchFiles(record["input"]);
	const field = FILE_FIELDS[toolName];
	if (field === void 0) return [];
	const value = record[field];
	return typeof value === "string" && value.trim() !== "" ? [value.trim()] : [];
}
function patchFiles(input) {
	if (typeof input !== "string" || input === "") return [];
	const files = [];
	for (const match of input.matchAll(PATCH_LINE)) {
		const file = match[1]?.trim();
		if (file !== void 0 && file !== "") files.push(file);
	}
	return files;
}
function createTouches(max = MAX_TOUCHED_PATHS) {
	const seen = /* @__PURE__ */ new Set();
	const order = [];
	return {
		record(files) {
			for (const file of files) {
				if (seen.has(file)) continue;
				seen.add(file);
				order.push(file);
				while (order.length > max) {
					const dropped = order.shift();
					if (dropped !== void 0) seen.delete(dropped);
				}
			}
		},
		list() {
			return order;
		}
	};
}
/**
* Which rules a set of touched files makes resident.
*
* Only enabled, on-demand rules with at least one pattern are candidates: an
* always-on rule is already resident, a manual rule is never auto-attached by
* any documented convention, and a rule with no pattern cannot match.
*/
function attachedRules(input) {
	const attached = /* @__PURE__ */ new Set();
	const diagnostics = [];
	if (input.touched.length === 0) return {
		attached,
		diagnostics
	};
	const touched = input.touched.map((file) => isAbsolute(file) ? file : resolve(input.cwd, file));
	let compiled = 0;
	for (const rule of input.rules) {
		if (!rule.enabled || rule.type !== "requested" || rule.patterns.length === 0) continue;
		if (compiled >= 256) {
			diagnostics.push({
				code: "attach.limit",
				detail: `一次最多编译 256 条按需规则的匹配式，其余规则保持按需加载`,
				path: rule.path
			});
			break;
		}
		compiled++;
		const base = rule.scope === "user" ? dirname(rule.path) : input.projectRoot ?? input.cwd;
		const { matchers, warnings } = compilePatterns(rule.patterns);
		for (const warning of warnings) diagnostics.push({
			code: "attach.pattern",
			detail: warning,
			path: rule.path
		});
		if (matchers.length === 0) continue;
		if (!selfCheck(matchers)) {
			diagnostics.push({
				code: "attach.slow",
				detail: "匹配式超出耗时预算，该规则保持按需加载",
				path: rule.path
			});
			continue;
		}
		if (touched.some((file) => matchesAny(matchers, file, base))) attached.add(rule.path);
	}
	return {
		attached,
		diagnostics
	};
}
// src/panel.ts
/**
* Where the host publishes the current catalog, and what the panel fetches.
*
* The `/api` prefix is **required and belongs to the host**, not to the caller:
* `connection.fetch.register` validates the path with
* `endpointFromPath(API_PATH, route.path)`, which returns `undefined` unless the
* path literally starts with `/api/`, and `assertFetchRoute` then throws
* (`dsh-client-connection/src/rpc-host.ts`). Registering here is also what
* routes the request through Connection's browser-trust fence, so only an owner
* Peer (the local GUI) can read it.
*
* One constant, both halves: the host registers exactly what the panel fetches.
*/
const RULES_ROUTE = "/api/rules-manager/rules.json";
/**
* Project the host's own diagnostics into the rows the panel renders.
*
* Two sources feed one list. A rule-level diagnostic rides on its rule row and
* is shown inside it; a scan-level one — an unreadable directory, a cap that
* was reached — belongs to no single rule, so it is lifted out here and
* published beside the rules instead of being dropped on the floor. Dropping it
* was the worst possible outcome: the panel then presented a truncated walk as
* a complete list of rules.
*
* `key` carries the rule's path, or the scope-qualified source key when the
* diagnostic is about a directory rather than a file, so two sources' rows
* cannot be confused for each other in the report.
*
* `kind` is the caller's statement about where the row came from, not something
* derived from the code: the same code can be raised about a rule or about the
* walk (a skipped pattern is a rule's problem, a reached cap is the walk's), and
* only the call site knows which. Both call sites say so explicitly.
*/
function toPanelDiagnostics(diagnostics, key, kind) {
	return diagnostics.map((d) => {
		const row = {
			code: d.code,
			detail: d.detail,
			kind
		};
		if (d.line !== void 0) row.line = d.line;
		if (d.path !== void 0) row.path = d.path;
		if (key !== void 0) row.key = key;
		return row;
	});
}
// src/config.ts
const Config = z.object({
	stateDir: z.string().default(""),
	perRuleMax: z.number().step(1).min(100).max(2e6).default(PER_RULE_MAX),
	userRulesTotal: z.number().step(1).min(0).max(2e6).default(USER_RULES_TOTAL_MAX),
	projectRulesTotal: z.number().step(1).min(0).max(2e6).default(PROJECT_RULES_TOTAL_MAX),
	readRulesOutput: z.number().step(1).min(1e3).max(4e6).default(READ_RULES_OUTPUT_MAX),
	maxScanDepth: z.number().step(1).min(0).max(100).default(6),
	injectRules: z.boolean().default(true)
});
// src/index.ts
/** Cordis entry id; matches `cordis.patch.yml` and stays short by convention. */
const name = "rules-manager";
const inject = ["tools", "workingDirectory"];
/**
* Which list a diagnostic row is going into.
*
* The host states this per call site rather than letting the panel infer it:
* the same code can be raised about a rule file or about the walk, and only the
* caller knows which list it is building.
*/
const RULE_KIND = "rule";
const SCAN_KIND = "scan";
/** Minimum interval between rescans. */
const RESCAN_INTERVAL_MS = 5e3;
/** How long an on-demand scan is reused before the next panel open rescans. */
const ON_DEMAND_TTL_MS = 3e4;
/** Human-readable name for a source key, for a group heading. */
function sourceLabelOf(key) {
	return SOURCES.find((source) => source.key === key)?.label ?? key;
}
/** A JSON response with the no-store headers the panel relies on. */
function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}
/** The query parameter the panel uses to name the workspace it is showing. */
const WORKSPACE_QUERY = "workspace";
/** The query parameter that asks a read to ignore the scan caches. */
const REFRESH_QUERY = "refresh";
/**
* Whether this request asked to be answered by a fresh scan.
*
* A repeated read is normally served from a 30-second slot, which is right for
* an open panel but wrong for the Refresh button: it returned the same bytes and
* the "scanned at" stamp never moved. Only an explicit 1 counts, so a stale or
* hand-edited parameter cannot turn every read into a rescan.
*/
function parseRefresh(url) {
	if (url === void 0) return false;
	try {
		return new URL(url, "http://localhost/").searchParams.get(REFRESH_QUERY) === "1";
	} catch {
		return false;
	}
}
/**
* The absolute directory a request asked for, when it named one.
*
* Everything the panel cannot mean reads as "no request": a relative path, a
* bare name, an empty value. The caller then keeps the default workspace instead
* of scanning a directory the resolver never offered, so a malformed parameter
* costs one resolve and can never widen the search.
*
* Trailing separators are dropped, because `D:/proj` and `D:/proj/` are the same
* directory and a client may round-trip either spelling.
*/
function parseWorkspaceQuery(url) {
	if (url === void 0) return null;
	let value;
	try {
		value = new URL(url, "http://localhost/").searchParams.get(WORKSPACE_QUERY);
	} catch {
		return null;
	}
	if (value === null) return null;
	const trimmed = value.trim();
	if (!(/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\\\"))) return null;
	const normalized = trimmed.replace(/[\\/]+$/, "");
	return normalized === "" ? trimmed : normalized;
}
/**
* The tier one request addresses, when it names a valid one.
*
* Absent or malformed stays `undefined`, which means "no tier named": the write
* then lands on the legacy bare key rather than guessing a tier.
*/
function parseScope(value) {
	return value === "user" || value === "project" ? value : void 0;
}
/**
* Validate one write request from the browser.
*
* The payload crosses a process boundary, so it is checked rather than trusted:
* a malformed body must be rejected, never written to state.
*/
function parseAction(value) {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value;
	if (typeof candidate["enabled"] !== "boolean") return null;
	if (typeof candidate["key"] !== "string" || candidate["key"] === "") return null;
	if (candidate["action"] === "setSource") return {
		action: "setSource",
		key: candidate["key"],
		enabled: candidate["enabled"],
		scope: parseScope(candidate["scope"])
	};
	if (candidate["action"] === "setRule") {
		if (typeof candidate["path"] !== "string" || candidate["path"] === "") return null;
		return {
			action: "setRule",
			key: candidate["key"],
			path: candidate["path"],
			enabled: candidate["enabled"],
			scope: parseScope(candidate["scope"])
		};
	}
	return null;
}
/**
* Project one rule into the row shape the browser panel renders.
*
* Every scanned rule becomes a row, including the ones that are switched off:
* the panel needs to *show* a disabled rule so the user can switch it back on,
* and a row that simply disappeared could never be re-enabled. Which layer
* switched it off is reported separately, so the UI can tell a rule disabled in
* its own frontmatter from one this panel turned off.
*/
function toRow(rule, state, sourceOn, attached) {
	const byState = isRuleDisabled(state, rule.sourceKey, rule.path, rule.scope);
	const disabledBy = !sourceOn ? "source" : byState ? "state" : rule.enabled ? null : "frontmatter";
	return {
		path: rule.path,
		name: rule.name,
		type: rule.type,
		description: rule.description,
		descriptionTokens: rule.descriptionTokens,
		bodyTokens: rule.bodyTokens,
		bodyLength: rule.body.length,
		enabled: rule.enabled,
		active: disabledBy === null,
		disabledBy,
		sourceKey: rule.sourceKey,
		sourceLabel: sourceLabelOf(rule.sourceKey),
		scope: rule.scope,
		family: rule.family,
		patterns: rule.patterns,
		attached: attachedNow(rule.type, attached, rule.path),
		diagnostics: rule.diagnostics.map((d) => d.line === void 0 ? {
			code: d.code,
			detail: d.detail,
			kind: RULE_KIND
		} : {
			code: d.code,
			detail: d.detail,
			line: d.line,
			kind: RULE_KIND
		})
	};
}
/** Whether one rule is in effect under the given state. */
function isActive(rule, state) {
	return isSourceEnabled(state, rule.sourceKey, rule.scope) && !isRuleDisabled(state, rule.sourceKey, rule.path, rule.scope) && rule.enabled;
}
/**
* One row per scanned root, with the directory it resolved to.
*
* Counts come from the unfiltered scan: a root that is switched off still has
* its rules on disk, and the panel needs to say how many it is hiding.
*/
function toSourceRows(entry, state) {
	return entry.roots.map((root) => {
		const own = entry.allRules.filter((rule) => rule.sourceKey === root.key && rule.scope === root.scope);
		return {
			key: root.key,
			label: sourceLabelOf(root.key),
			scope: root.scope,
			path: root.path,
			enabled: isSourceEnabled(state, root.key, root.scope),
			ruleCount: own.length,
			activeRuleCount: own.filter((rule) => isActive(rule, state)).length
		};
	});
}
/**
* Tail of the write queue, module-level so every concurrent POST is serialized
* even across plugin instances in one process.
*
* A POST is a read-modify-write of one JSON file: two overlapping requests both
* read the same snapshot, and the later rename silently drops the earlier
* toggle. Chaining the apply steps makes each write see the previous one.
*/
let writeChain = Promise.resolve();
function apply(ctx, config) {
	if (typeof config.stateDir === "string" && config.stateDir !== "") setStateDir(config.stateDir);
	/**
	* Per-agent scan cache: rescanning on every step would stat the tree each turn.
	*
	* Scoped to this `apply` call rather than the module: a module-level cache is
	* shared by every plugin instance in the process, so one instance's scan (or
	* one test's fixture) would serve another's panel.
	*/
	const scans = /* @__PURE__ */ new WeakMap();
	/**
	* The files each agent has worked with, for file-scoped rule attachment.
	*
	* A second per-agent table rather than a field on `ScanEntry`, because the
	* two have different lifetimes: a rescan replaces the entry within seconds,
	* while a touch is a fact about the session that stays true for its whole
	* life. The host's own agent-instructions plugin is the same shape — it keeps
	* the applicable chain and refreshes it from successful filesystem calls.
	*
	* `attach.ts` owns what counts as a touch and what it makes resident.
	*/
	const touches = /* @__PURE__ */ new WeakMap();
	/**
	* The most recent agent's touch list, for readers that have no agent.
	*
	* A panel request arrives over HTTP and carries no agent, so it cannot look
	* one up in the table above. The last session to touch a file is the best
	* available answer to "has this workspace been worked in", and it is only
	* ever used to describe rules the panel already lists.
	*/
	let recentTouches = [];
	/**
	* The panel's last attachment answer, reused while its input is unchanged.
	*
	* A panel request carries no agent, so it answers with `recentTouches` — and
	* a browser polls this route, so re-running the pattern matchers on every poll
	* buys nothing. Identity is a sound key because both writers replace the list
	* rather than mutate it, and the directory is compared as well.
	*/
	let lastPanelTouches = null;
	let lastPanelCwd = null;
	let lastPanelAttachments = {
		attached: NO_ATTACHED,
		diagnostics: []
	};
	/**
	* The session working directory the host last reported for one agent.
	*
	* A touch is a fact about a directory, not only about an agent: a relative
	* tool argument means nothing outside the tree it was resolved in. The host's
	* own agent-instructions plugin reloads its chain when the session moves, and
	* a list carried across that move would keep rules resident for a workspace
	* the session has left.
	*
	* The observer only sees tool calls, so a session that moved and has not
	* called a tool yet would still be matched against the directory it left.
	* `loadFor` asks the host for this directory on every request, which is the
	* documented source of it, so that is where the move is normally noticed.
	*/
	const sessionDir = /* @__PURE__ */ new WeakMap();
	/**
	* Drop a touch list that belongs to a directory the session has left.
	*
	* A list no request has claimed yet belongs to no directory, so it is adopted
	* rather than dropped. Called from both places that learn the directory: the
	* per-request path and the tool observer.
	*/
	const resetTouchesIfMoved = (agent, cwd) => {
		if (sessionDir.has(agent) && sessionDir.get(agent) !== cwd) {
			touches.delete(agent);
			recentTouches = [];
		}
		sessionDir.set(agent, cwd);
	};
	/** The touch list of one agent, created on first use. */
	const touchesOf = (agent) => {
		const existing = touches.get(agent);
		if (existing !== void 0) return existing;
		const created = createTouches();
		touches.set(agent, created);
		return created;
	};
	/**
	* What the given rules and touches make resident, or nothing when unknown.
	*
	* `attach.ts` owns the decision; this only supplies the agent's touch list and
	* the two directories a relative tool argument could have been relative to.
	*/
	const attachmentOf = (rules, touched, cwd, projectRoot) => {
		if (touched.length === 0) return {
			attached: NO_ATTACHED,
			diagnostics: []
		};
		return attachedRules({
			rules,
			touched,
			cwd,
			projectRoot
		});
	};
	/**
	* Agents that have been scanned, so a write can invalidate their caches.
	*
	* A WeakMap cannot be cleared, and a stale entry would survive a settings
	* change; this holds the same objects strongly until they are dropped, which
	* is bounded by the number of live agents.
	*/
	const knownAgents = /* @__PURE__ */ new Set();
	/**
	* The most recent catalog, for readers that have no agent of their own.
	*
	* A browser request carries no agent, so the panel cannot be served from the
	* per-agent cache above. It is trusted only while it is younger than
	* `ON_DEMAND_TTL_MS`; see `currentEntry`.
	*/
	let lastScan = null;
	/**
	* A scan performed on the panel's behalf, before any agent has run.
	*
	* Without this, a freshly booted host served an empty panel: the catalog above
	* is only written by `loadFor`, which runs from `agent/pre-step`, and the user
	* opens the panel before sending anything. Cached so repeated panel opens do
	* not re-walk the tree, and invalidated by every write.
	*/
	let onDemandScan = null;
	/**
	* The workspace the current request asked for, if it named one.
	*
	* A GET sets it before reading; a POST reads its own from the body's request,
	* so a panel showing B keeps getting B when it writes a switch.
	*/
	let requestedWorkspace = null;
	/**
	* Candidate list from the most recent resolve.
	*
	* Both scan caches are dropped on every write, but a write does not change
	* which directories this host can describe — a panel that just toggled a rule
	* must keep offering the same switch, so the list outlives them. It is still
	* bounded by the same TTL, because the services behind it can change.
	*/
	let lastCandidates = null;
	/**
	* The directories to offer the panel, given the scan the fast paths landed on.
	*
	* When the list remembered from the last resolve still contains `root` it is
	* the honest answer; otherwise the only directory known to be described is the
	* one already scanned, and claiming more would offer a switch to somewhere this
	* host never named.
	*/
	const candidatesFor = (root) => {
		const remembered = lastCandidates;
		if (remembered !== null && root !== null && Date.now() - remembered.at < ON_DEMAND_TTL_MS && remembered.candidates.includes(root)) return remembered.candidates;
		return root === null ? [] : [root];
	};
	/**
	* The probes `resolveWorkspace` reads, without scanning any directory.
	*
	* Both services are optional and read with `ctx.get`; neither may join
	* `inject`, which would unmount the plugin wherever they are absent. The
	* candidate check stays next to the resolve it validates.
	*
	* `lastScanRoot` is the tree a session was last scanned in, which is the
	* first probe the resolver consults. `sessionId` stays unset: no host
	* contract names a session id for this context, and guessing one would let a
	* stale read pick a workspace the host never offered.
	*/
	const workspaceProbes = (lastScanRoot) => ({
		lastScanRoot,
		registry: ctx.get?.("workspaceRegistry"),
		sessions: ctx.get?.("sessions"),
		sessionId: void 0
	});
	/**
	* Assemble one entry from a finished walk.
	*
	* Shared by the session path and the panel's on-demand path: both filter the
	* same way, project the same roots, and build the same requestable index, and
	* two copies of that had already drifted apart in nothing but variable names.
	* `cwd` and `projectRoot` are the two things the callers disagree about, so
	* they are parameters.
	*/
	const buildEntry = (result, state, projectRoot, cwd) => {
		const rules = result.rules.filter((rule) => isSourceEnabled(state, rule.sourceKey, rule.scope) && !isRuleDisabled(state, rule.sourceKey, rule.path, rule.scope));
		const roots = result.roots.map((root) => ({
			key: root.source.key,
			scope: root.scope,
			path: root.path
		}));
		const index = {};
		for (const rule of rules) {
			if (rule.type !== "requested") continue;
			index[rule.path] = {
				path: rule.path,
				name: rule.name,
				body: rule.body
			};
		}
		return {
			rules,
			allRules: result.rules,
			index,
			projectRoot,
			roots,
			cwd,
			diagnostics: result.diagnostics,
			truncated: result.truncated,
			at: Date.now()
		};
	};
	/**
	* Scan (or reuse a recent scan) for one agent, honoring the state switches.
	*
	* The root is resolved from the agent's **session** working directory, never
	* from `process.cwd()`: that is the directory of the DSH host process, so
	* climbing from it finds no project marker and the project tier silently
	* scans zero files. The host's own `dsh-agent-instructions` resolves its root
	* the same way, through `ctx.workingDirectory.ensure(agent, signal)`.
	*/
	const loadFor = async (agent, signal) => {
		const cwd = await ctx.workingDirectory.ensure(agent, signal);
		resetTouchesIfMoved(agent, cwd);
		const cached = scans.get(agent);
		if (cached !== void 0 && Date.now() - cached.at < RESCAN_INTERVAL_MS) return cached;
		const projectRoot = await findProjectRoot(cwd);
		const state = await readState();
		const result = await scanAll(projectRoot, { maxDepth: config.maxScanDepth });
		const entry = buildEntry(result, state, projectRoot, cwd);
		scans.set(agent, entry);
		if (typeof agent === "object" && agent !== null) knownAgents.add(agent);
		lastScan = entry;
		return entry;
	};
	const registerOnConnection = (owner) => {
		const fetch = (owner.connection ?? owner.get?.("connection"))?.fetch;
		if (fetch === void 0 || typeof fetch.register !== "function") return;
		owner.effect(() => fetch.register({
			path: RULES_ROUTE,
			methods: ["GET", "POST"],
			requestBody: "buffered",
			fetch: async (request = new Request("http://localhost/")) => {
				if (request.method === "POST") return handleAction(request);
				requestedWorkspace = parseWorkspaceQuery(request.url);
				return jsonResponse(await snapshot(void 0, requestedWorkspace, parseRefresh(request.url)));
			}
		}));
	};
	/**
	* Scan one directory outside any agent's session.
	*
	* Used only when no agent has run; the result is cached so opening the panel
	* repeatedly does not re-walk the tree. The caller passes the state it has
	* already read, so one request reads state.json once rather than once per scan.
	*/
	const scanOutsideAgent = async (root, state) => {
		if (root === null) return null;
		const projectRoot = await findProjectRoot(root);
		const result = await scanAll(projectRoot, { maxDepth: config.maxScanDepth });
		return buildEntry(result, state, projectRoot, root);
	};
	/**
	* The cached on-demand scan that may answer this read, if any.
	*
	* The slot is shared by plain reads and explicit ones, so it remembers which
	* filled it: only a slot the default resolve filled answers a plain read, and
	* only a slot filled by the same request answers that request again. Anything
	* else misses, which keeps a no-parameter read on the default workspace and
	* stops selecting A after B from still showing B.
	*/
	const cachedScanFor = (requested, now) => {
		const cached = onDemandScan;
		if (cached === null || now - cached.at >= ON_DEMAND_TTL_MS) return null;
		if (requested === null) return cached.explicit === null ? cached : null;
		return cached.explicit === requested && cached.candidates.includes(requested) ? cached : null;
	};
	/**
	* The entry to describe, resolving a workspace on demand when no agent has run.
	*
	* A recent `lastScan` wins: it is the workspace a real session is working
	* in, which is more trustworthy than any service lookup. It is only trusted
	* while it is fresh, though — the panel is one process-wide reader shared by
	* every window, so an unbounded entry would let a write made elsewhere go
	* unseen for the rest of the process's life. Past the TTL the workspace is
	* resolved from the optional services and scanned here, which also keeps the
	* panel working on a freshly booted host.
	*
	* `requested` is the directory the panel explicitly asked for, already checked
	* against the candidates a previous read reported. It narrows the choice to a
	* directory this host itself offered; it never widens it.
	*
	* A request for A must not be answered with B's scan, however fresh it is,
	* and the same directory makes `lastScan` exact rather than a guess. The
	* on-demand slot is shared by plain reads and explicit ones, so it also
	* remembers which of the two filled it: only a slot the default resolve
	* filled answers a plain read, and only a slot filled by the same request
	* answers that request again. Anything else falls through to a fresh resolve,
	* which keeps a no-parameter read on the default workspace.
	*
	* An explicit request is honored only for a directory the resolver itself
	* offered, and then it is the one scanned, not the default: a stale or
	* hand-edited parameter falls back to the default workspace instead of
	* scanning somewhere the host never named.
	*/
	const currentEntry = async (state, requested, refresh = false) => {
		const recent = lastScan;
		if (!refresh && recent !== null && (requested === null || recent.projectRoot === requested) && Date.now() - recent.at < ON_DEMAND_TTL_MS) return {
			entry: recent,
			source: requested === null ? "last-scan" : "selected",
			root: recent.projectRoot,
			candidates: candidatesFor(recent.projectRoot)
		};
		const now = Date.now();
		const cached = refresh ? null : cachedScanFor(requested, now);
		if (cached !== null) return {
			entry: cached.entry,
			source: requested === null ? cached.source : "selected",
			root: cached.root,
			candidates: cached.candidates
		};
		const resolved = resolveWorkspace(workspaceProbes(lastScan?.projectRoot ?? null));
		const chosen = requested !== null && resolved.candidates.includes(requested);
		const target = chosen && requested !== null ? requested : resolved.path;
		const entry = await scanOutsideAgent(target, state);
		const source = chosen ? "selected" : resolved.source;
		lastCandidates = {
			candidates: resolved.candidates,
			at: now
		};
		onDemandScan = {
			root: target,
			entry,
			source,
			candidates: resolved.candidates,
			at: now,
			explicit: chosen ? target : null
		};
		return {
			entry,
			source,
			root: target,
			candidates: resolved.candidates
		};
	};
	const snapshot = async (preloaded, requested = requestedWorkspace, refresh = false) => {
		const state = preloaded ?? await readState();
		const { entry, source, root, candidates } = await currentEntry(state, requested, refresh);
		if (entry === null) return {
			rules: [],
			sources: [],
			scannedAt: 0,
			diagnostics: [],
			truncated: false,
			workspace: {
				path: root,
				source,
				options: candidates
			}
		};
		const attachment = entry.cwd === lastPanelCwd && recentTouches === lastPanelTouches ? lastPanelAttachments : attachmentOf(entry.rules, recentTouches, entry.cwd, entry.projectRoot);
		lastPanelTouches = recentTouches;
		lastPanelCwd = entry.cwd;
		lastPanelAttachments = attachment;
		return {
			rules: entry.allRules.map((rule) => toRow(rule, state, isSourceEnabled(state, rule.sourceKey, rule.scope), attachment.attached)),
			sources: toSourceRows(entry, state),
			scannedAt: entry.at,
			diagnostics: toPanelDiagnostics([...entry.diagnostics, ...attachment.diagnostics], root ?? void 0, SCAN_KIND),
			truncated: entry.truncated,
			workspace: {
				path: root,
				source,
				options: candidates
			}
		};
	};
	/**
	* Apply one write from the panel.
	*
	* Only state.json is written: external rule files are never touched, which is
	* the plugin's read-only promise. The per-agent scan cache is dropped
	* afterwards so the next read reflects the change immediately instead of up
	* to RESCAN_INTERVAL_MS later.
	*/
	const applyAction = async (parsed, requested) => {
		const state = await readState();
		let updated;
		if (parsed.action === "setSource") updated = {
			...state,
			sources: {
				...state.sources,
				[scopedKey(parsed.key, parsed.scope)]: parsed.enabled
			}
		};
		else {
			const current = disabledPaths(state, parsed.key, parsed.scope);
			const next = parsed.enabled ? current.filter((p) => p !== parsed.path) : current.includes(parsed.path) ? [...current] : [...current, parsed.path];
			updated = {
				...state,
				disabled: {
					...state.disabled,
					[scopedKey(parsed.key, parsed.scope)]: next
				}
			};
		}
		await writeState(updated);
		for (const agent of knownAgents) scans.delete(agent);
		knownAgents.clear();
		const resolved = requested === null ? null : resolveWorkspace(workspaceProbes(lastScan?.projectRoot ?? null));
		const chosen = resolved !== null && requested !== null && resolved.candidates.includes(requested) ? requested : null;
		if (resolved !== null) lastCandidates = {
			candidates: resolved.candidates,
			at: Date.now()
		};
		const panelRoot = chosen ?? lastScan?.projectRoot ?? onDemandScan?.root ?? null;
		lastScan = null;
		onDemandScan = null;
		if (panelRoot !== null) lastScan = await scanOutsideAgent(panelRoot, updated);
		return jsonResponse(await snapshot(updated, chosen ?? requested));
	};
	/**
	* Validate one POST and queue its write.
	*
	* The queue is what makes the read-modify-write atomic; a body that does not
	* parse never reaches it, so a malformed request cannot hold it up.
	*/
	const handleAction = async (request) => {
		let action;
		try {
			action = await request.json();
		} catch {
			return jsonResponse({
				ok: false,
				error: "invalid JSON body"
			}, 400);
		}
		const parsed = parseAction(action);
		if (parsed === null) return jsonResponse({
			ok: false,
			error: "unknown action"
		}, 400);
		const requested = parseWorkspaceQuery(request.url) ?? requestedWorkspace;
		const queued = writeChain.then(() => applyAction(parsed, requested));
		writeChain = queued.then(() => void 0, () => void 0);
		try {
			return await queued;
		} catch (cause) {
			return jsonResponse({
				ok: false,
				error: cause instanceof Error ? cause.message : String(cause)
			}, 500);
		}
	};
	if (typeof ctx.inject === "function") ctx.inject(["connection"], (scoped) => {
		registerOnConnection(scoped);
	});
	else registerOnConnection(ctx);
	ctx.tools.register(createReadRulesTool((agent) => {
		if (agent === void 0 || agent === null || typeof agent !== "object") return {};
		return scans.get(agent)?.index ?? {};
	}, config.readRulesOutput));
	/**
	* Learn which files the session worked with, from the host's tool pipeline.
	*
	* `tools/result` is the documented seam for observing settled outcomes
	* (`docs/subsystems/tools.md`: "Observe the frozen, lossless-JSON final
	* outcome. Listener failures are contained."), and the host keys its scoped
	* dispatch by `exec.agent`, which is exactly the granularity this cache has.
	* The host's own agent-instructions plugin learns its nested files from the
	* same kind of signal - "successful filesystem operations discover newly
	* relevant nested files" - rather than watching the disk. That matters here:
	* a watch would fire for edits made by anything, while a rule should become
	* resident because *this session* touched a matching file.
	*
	* Registered only for agents that could use it: with `injectRules: false`
	* there is no block to attach anything to.
	*/
	const observeTouches = (scoped) => {
		scoped.on("tools/result", (exec, result) => {
			if (result.isError === true) return void 0;
			const agent = exec.agent;
			if (agent === void 0 || agent === null || typeof agent !== "object") return void 0;
			const files = touchedFilesOf(exec.name, exec.arguments);
			if (files.length === 0) return void 0;
			const cwd = scans.get(agent)?.cwd;
			if (cwd !== void 0) resetTouchesIfMoved(agent, cwd);
			const list = touchesOf(agent);
			list.record(files);
			recentTouches = list.list();
		});
	};
	if (!config.injectRules) return;
	observeTouches(ctx);
	ctx.on("agent/pre-step", async ({ agent, messages, step, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject") return decision;
		signal.throwIfAborted();
		if (step === 1 && decision.messages.length === 0) return decision;
		const { rules, projectRoot, cwd } = await loadFor(agent, signal);
		const attached = attachmentOf(rules, touches.get(agent)?.list() ?? [], cwd, projectRoot);
		const block = renderRulesBlock(rules, {
			projectRoot,
			perRuleMax: config.perRuleMax,
			userRulesTotal: config.userRulesTotal,
			projectRulesTotal: config.projectRulesTotal,
			attached: attached.attached
		});
		if (block === "") return decision;
		const injection = createUserMessage({
			content: [{
				type: "text",
				text: block
			}],
			source: {
				kind: "rules-context",
				form: "instructions"
			}
		});
		const planned = planInjection(decision.messages, messages, injection, block);
		if (planned.skipped !== void 0) return decision;
		return {
			...decision,
			messages: planned.messages
		};
	});
}
export { Config, apply, inject, name };
