window.__ModuleLoader__.load({
	id: "@one-dragon/dsh-rules-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/client/styles.ts
		/**
		* Panel styles, injected as one `<style>` element.
		*
		* A `<style>` element rather than a CSS import: the client bundle is a single
		* lazy CJS factory, and the reference plugin (`@michengai/dsh-skills-manager`)
		* injects its styles the same way. No build step parses CSS, so nothing has to
		* be declared in `tsdown.config.ts`.
		*
		* Colors come from DSH's own alias tokens with literal fallbacks, so the panel
		* follows the active theme and still renders if a token is ever renamed.
		*/
		const STYLE_ID = "dsh-rules-manager-style";
		const PANEL_CSS = `
/* ---- shell ---- */
/* The panel is the scroller, and the only one.
   The host renders a panel slot inside .mainPanel (a fixed-height flex column
   with min-height:0) which itself sits in .centerCol{overflow:hidden}. A panel
   that grows to its content height is therefore clipped and cannot be reached:
   measured in the real app at 1222px of viewport against 1619px of content,
   397px cut off with no scrollbar anywhere. Filling the parent and scrolling
   internally is the same shape the host's own plugin-manager page uses
   (PluginManagerPage.module.css: .page{height:100%} + .pageBody{overflow-y:auto}). */
.dshrm-panel{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:14px;height:100%;padding:20px clamp(16px,4vw,36px) 36px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,inherit);overflow-x:hidden;overflow-y:auto}
/* flex:none so a short parent cannot squash the header, tabs or cards. */
.dshrm-panel>*{box-sizing:border-box;flex:none;width:100%;max-width:960px;min-width:0}
.dshrm-head{display:flex;flex-direction:column;gap:2px}
.dshrm-title{margin:0;font-size:19px;font-weight:600;line-height:1.3;color:var(--dsw-alias-label-primary,inherit)}
.dshrm-sub{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dshrm-btn{flex:none;padding:5px 12px;font-size:12px;cursor:pointer;border-radius:var(--dsw-radius-sm,8px);border:0.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-primary,inherit)}
.dshrm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.dshrm-btn:disabled{opacity:.6;cursor:progress}
/* ---- stat bar ---- */
.dshrm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));overflow:hidden;border:0.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-layer-1,transparent)}
.dshrm-stat{min-width:0;display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:0;font:inherit;text-align:left;background:transparent;color:inherit}
/* The diagnostics cell is a button: clicking its number filters the list down to
   the rules that carry one, which is the only way the count means anything.
   It needs the same reset as its inert sibling: a bare <button> keeps the UA's
   own grey plate (buttonface) behind the cell, which is what made this one
   number read as a broken, disabled control. It also must not add padding of
   its own: the cell is already padded, so the second inset pushed this number
   and its label out of line with the other three.
   Nothing decorates the number either — no dotted underline and no hover plate.
   One of four equal cells is not a different kind of widget, and a mark under
   the digits read as a rule hanging below the cell. Selection stays a separate
   signal: a bold, brand-coloured number. */
.dshrm-stat-btn{min-width:0;display:flex;flex-direction:column;gap:2px;padding:0;border:0;font:inherit;text-align:left;background:transparent;color:inherit;cursor:pointer}
.dshrm-stat-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,rgba(77,107,254,.6));outline-offset:-2px}
.dshrm-stat-btn.on .dshrm-stat-n{color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:700}
.dshrm-stat+.dshrm-stat{border-left:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
.dshrm-stat-n{font-size:20px;font-weight:600;line-height:1.15;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,inherit)}
.dshrm-stat.on .dshrm-stat-n{color:var(--dsw-alias-state-success-primary,#51b976)}
.dshrm-stat.off .dshrm-stat-n{color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-stat.warn .dshrm-stat-n{color:var(--dsw-alias-state-warn-primary,#e0a03a)}
.dshrm-stat-l{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary,#8b8b8b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:760px){
.dshrm-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
.dshrm-stat:nth-child(odd){border-left:0}
.dshrm-stat:nth-child(n+3){border-top:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
}
/* ---- cost line ---- */
.dshrm-cost{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:0}
.dshrm-cost-n{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dshrm-cost-l{font-size:12px;color:var(--dsw-alias-label-secondary,#b9b9b9)}
/* ---- token breakdown ---- */
/* The cost line states a total; this is the receipt behind it. The link is a
   real button so it is reachable by keyboard, and the dialog is a fixed overlay
   so it never widens the panel. */
.dshrm-link{padding:0;font:inherit;font-size:12px;cursor:pointer;border:0;background:transparent;color:var(--dsw-alias-state-business-primary,#3b82f6);text-decoration:underline}
.dshrm-link:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,rgba(77,107,254,.6));outline-offset:2px}
.dshrm-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.4);max-width:none}
.dshrm-modal-card{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:100%;max-width:640px;max-height:80vh;padding:16px;border:0.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv1,0 8px 24px rgba(0,0,0,.25))}
.dshrm-modal-head{display:flex;align-items:center;gap:8px}
.dshrm-modal-title{flex:1 1 auto;margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.dshrm-modal-body{min-height:0;overflow-y:auto;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#b9b9b9)}
.dshrm-cost-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.dshrm-cost-th{position:sticky;top:0;padding:6px 8px;text-align:left;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8b8b8b);border-bottom:0.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-1,#fff)}
.dshrm-cost-td{padding:5px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}
.dshrm-cost-total .dshrm-cost-td{font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
/* The fixed scaffolding row: it is not a rule, so it must not read like one. */
.dshrm-cost-fixed .dshrm-cost-td{color:var(--dsw-alias-label-tertiary,#8b8b8b);font-style:italic}
/* Budget and scan notices under the table: the same shape as a row note, but
   they belong to the total rather than to any single rule. */
.dshrm-cost-note{margin:8px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-warn-primary,#e0a03a)}
.dshrm-cost-hint{margin:8px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
/* Scan-level diagnostics sit above the cards, because they are about the walk
   that produced the cards and not about any one of them. */
.dshrm-scan-note{margin:0;color:var(--dsw-alias-state-warn-primary,#e0a03a)}
.dshrm-scan-note+.dshrm-scan-note{margin-top:4px}
/* The findings list under that note: same shape as a rule's diagnostics, because
   it is the same kind of information and only the owner differs. */
.dshrm-scan-diag{margin-top:4px}
.dshrm-cost-note-p{margin:0}
.dshrm-diag-path{display:block;color:var(--dsw-alias-label-tertiary,#8b8b8b);overflow-wrap:anywhere}
/* ---- segmented tabs ---- */
/* Two tablists sit close together and used to be indistinguishable. Each one now
   carries a visible label (the aria-label alone is only for screen readers), and
   the container is a real border rather than the weakest alias at half a pixel:
   at 0.5px/18% the outline simply did not read on either theme. */
.dshrm-tabgroup{display:flex;flex-direction:column;gap:4px}
.dshrm-tabs{display:flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
.dshrm-tab{flex:1 1 0;min-width:0;padding:6px 8px;font-size:13px;line-height:18px;cursor:pointer;background:transparent;border:0;border-radius:var(--dsw-radius-xs,4px);color:var(--dsw-alias-label-secondary,#b9b9b9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .15s ease,color .15s ease}
.dshrm-tab:hover{color:var(--dsw-alias-label-primary,inherit)}
/* No box-shadow: the 2px-down 4px-blur drop shadow landed on the capsule's own
   bottom edge and read as a grey line stuck under the selected tab, which is
   what the "ugly grey line" was. The fill and the brand colour carry selection. */
.dshrm-tab.on{background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.16));color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}
/* The scope strip holds exactly two short segments, so with only the 2px gap
   between them the pair read as one blob. A hairline on the following segment
   gives each half an edge while the filled selected half keeps the shape it
   had; no gap change, so nothing moves. nowrap is doubled into the selector so
   the narrow-screen flex-wrap:wrap rule (which comes later in this sheet)
   can never push the divider to the start of a wrapped row. */
.dshrm-tabs.dshrm-tabs-seg{flex-wrap:nowrap}
.dshrm-tabs-seg .dshrm-tab+.dshrm-tab{border-left:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
/* ---- filters ---- */
.dshrm-filters{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.dshrm-field{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 160px}
.dshrm-field-l{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-select,.dshrm-search{box-sizing:border-box;width:100%;padding:6px 10px;font-size:13px;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-2,transparent);border:0.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:var(--dsw-radius-sm,8px);outline:none}
.dshrm-select{cursor:pointer}
.dshrm-search:focus,.dshrm-select:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 var(--dsw-focus-ring-width,2px) var(--dsw-focus-ring-color,rgba(77,107,254,.25))}
/* ---- source cards ---- */
.dshrm-groups{display:flex;flex-direction:column;gap:12px}
.dshrm-group{display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1,transparent);overflow:hidden}
.dshrm-group-head{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 12px}
.dshrm-fold{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;overflow:hidden;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dshrm-fold:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,rgba(77,107,254,.6));outline-offset:2px}
.dshrm-caret{flex:none;width:12px;font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-badge{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:var(--dsw-radius-sm,8px);font-size:11px;font-weight:600;color:var(--dsw-alias-label-on-color,#fff);background:var(--dsw-alias-brand-primary,#4d6bfe)}
.dshrm-badge.s-codebuddy{background:var(--dsw-static-violet-600,#7c5cff)}
.dshrm-badge.s-cursor{background:var(--dsw-alias-state-business-primary,#3b82f6)}
.dshrm-badge.s-claude{background:var(--dsw-alias-state-warn-primary,#d98a2b)}
.dshrm-badge.s-agents{background:var(--dsw-alias-state-success-primary,#3f9e63)}
/* A card that carries real artwork drops the chip: the mark is its own colour
   and a coloured plate behind it would misread the brand. This has to come
   after the .s-* plates above — both selectors are two classes, so source
   order is what decides, and the plates used to win. */
.dshrm-badge.has-brand{background:transparent;color:var(--dsw-alias-label-primary,inherit)}
/* Monochrome glyphs (simple-icons and friends) ship with no fill of their own
   and are meant to be tinted by the page. Without this they kept SVG's default
   black and vanished against the dark surface. Marks that declare their own
   colours keep them: the attribute is on the child, this rule only sets the
   default it would otherwise inherit. */
.dshrm-brand{display:block;width:100%;height:100%;fill:currentColor}
.dshrm-group-label{flex:none;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
/* The tier of a card has to be readable at a glance: 10px on a 12% wash was
   below the noise floor, so "全部" showed the same source twice with nothing to
   tell the two cards apart. */
.dshrm-scope-tag{flex:none;padding:0 6px;font-size:10px;line-height:16px;font-weight:600;white-space:nowrap;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.22));color:var(--dsw-alias-label-primary,inherit)}
.dshrm-group-count{flex:none;margin-left:2px;font-size:11px;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-group-path{display:block;flex:1 1 auto;min-width:0;margin:0;padding:0 12px 8px;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;color:var(--dsw-alias-label-tertiary,#8b8b8b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrm-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
/* ---- rule rows ---- */
.dshrm-row{display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border-top:0.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}
.dshrm-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06))}
.dshrm-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
.dshrm-row-top{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.dshrm-name{flex:1 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.dshrm-type{flex:none;padding:0 6px;font-size:10px;line-height:16px;white-space:nowrap;border-radius:var(--dsw-radius-xs,4px);border:0.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));color:var(--dsw-alias-label-secondary,#b9b9b9)}
.dshrm-always .dshrm-type{color:var(--dsw-alias-brand-primary,#4d6bfe);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dshrm-requested .dshrm-type{color:var(--dsw-alias-state-business-primary,#3b82f6);border-color:var(--dsw-alias-state-business-primary,#3b82f6)}
.dshrm-manual .dshrm-type{color:var(--dsw-alias-label-tertiary,#8b8b8b)}
/* An on-demand rule that this session made resident: still requestable, but paid for. */
.dshrm-type.is-attached{color:var(--dsw-alias-state-success-primary,#3f9e63);border-color:var(--dsw-alias-state-success-primary,#3f9e63)}
.dshrm-tokens{flex:none;padding:0 6px;font-size:10px;line-height:16px;white-space:nowrap;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));color:var(--dsw-alias-label-tertiary,#8b8b8b);font-variant-numeric:tabular-nums}
.dshrm-desc{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#a9a9a9);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dshrm-row-note{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
/* Diagnostics fold open in place: a row whose trouble cannot be read is a row
   nobody can act on. The count stays a <summary>, the details are <li>s. */
.dshrm-diag{margin:2px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-warn-primary,#e0a03a)}
.dshrm-diag summary{cursor:pointer}
.dshrm-diag-list{margin:4px 0 0;padding:0 0 0 16px;list-style:disc;color:var(--dsw-alias-label-secondary,#a9a9a9)}
.dshrm-diag-list li{overflow-wrap:anywhere}
.dshrm-diag-code{color:var(--dsw-alias-state-warn-primary,#e0a03a)}
/* A diagnostic without its line is a sentence about a file the reader still has
   to search. The line number rides beside the code; the meaning of the code
   rides under it, because "fm.emptyList" alone says nothing actionable. */
.dshrm-diag-line{margin-left:6px;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-diag-help{display:block;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-off{opacity:.6}
.dshrm-off .dshrm-name{text-decoration:line-through}
/* ---- iOS-style switch ---- */
.dshrm-switch{position:relative;flex:none;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.dshrm-switch input{position:absolute;width:1px;height:1px;margin:0;padding:0;opacity:0;pointer-events:none}
.dshrm-track{position:relative;flex:none;width:32px;height:18px;border-radius:9px;background:var(--dsw-alias-border-l3,rgba(127,127,127,.45));transition:background .15s ease}
.dshrm-track::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-on-color,#fff);box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(0,0,0,.3));transition:transform .15s ease}
.dshrm-switch input:checked+.dshrm-track{background:var(--dsw-alias-brand-primary,#4d6bfe)}
.dshrm-switch input:checked+.dshrm-track::after{transform:translateX(14px)}
.dshrm-switch input:disabled+.dshrm-track{opacity:.45;cursor:not-allowed}
.dshrm-switch input:focus-visible+.dshrm-track{box-shadow:0 0 0 var(--dsw-focus-ring-width,2px) var(--dsw-focus-ring-color,rgba(77,107,254,.4))}
/* ---- states ---- */
.dshrm-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary,#ef7272)}
.dshrm-note{margin:0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-empty{margin:0;padding:24px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#8b8b8b)}
.dshrm-full{padding:20px 12px;text-align:center}
.dshrm-retry{padding:3px 12px;font-size:12px;cursor:pointer;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);border:1px solid var(--dsw-alias-brand-primary,#4d6bfe)}
/* Narrow containers: the overrides live at the END of the sheet, because a
   media query does not outrank the base rule it is written before. Measured at
   415px: five status tabs totalled ~380px inside a 379px bar and every count
   clipped ("全部（1…"), and the two filter fields stayed side by side at 186px. */
@media (max-width:760px){
.dshrm-tabs{flex-wrap:wrap}
.dshrm-tab{flex:0 1 auto;min-width:max-content}
.dshrm-field{flex-basis:100%}
}
`;
		/**
		* Install the stylesheet once per document.
		*
		* Idempotent by id, so a reload or a second `register` call does not append a
		* duplicate `<style>`. Harmless when no document exists (a server render).
		*/
		function installPanelStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = PANEL_CSS;
			(document.head ?? document.documentElement).appendChild(style);
		}
		// src/client/brand-icons.ts
		const BRAND_ICONS = {
			"codebuddy": {
				viewBox: "0 0 40 40",
				title: "CodeBuddy",
				body: "<g clip-path=\"url(#codebuddyClip0)\"><rect width=\"40\" height=\"40\" rx=\"20\" fill=\"url(#codebuddyFill0)\"/><g filter=\"url(#codebuddyBlur0)\"><circle cx=\"13\" cy=\"35\" r=\"14\" fill=\"#32E6B9\" fill-opacity=\"0.4\"/></g><g filter=\"url(#codebuddyBlur1)\"><circle cx=\"33\" cy=\"44\" r=\"13\" fill=\"#32E6B9\"/></g><path d=\"M28 3C28 3 28 3 28 3C29 3 29 3 30 4C31 5 34 8 35 11L36 12L36 12C37 12 38 13 39 14C39 14 39 14 39 14C40 13 42 14 43 15C44 16 45 18 46 20C46 20 46 21 46 21C46 23 46 24 45 24C45 24 45 24 45 25C45 27 44 29 43 32C41 34 39 36 36 39C34 40 30 43 28 43C24 45 20 46 17 46C15 46 13 45 12 44C11 44 11 44 11 44C10 44 8 43 6 42C6 41 5 39 4 39C4 37 4 35 5 34C5 33 5 33 5 33C5 32 5 31 5 30L5 30L4 28C2 25 1 22 1 21C1 20 1 19 1 19C1 19 2 18 2 18C4 18 7 18 11 19L11 19L12 18C14 17 15 16 16 15C18 14 20 13 23 12L23 12L24 11C25 7 27 4 28 3ZM15 23C14 24 13 25 12 25C10 27 9 31 10 34C10 35 11 35 12 37C13 39 13 40 14 40C16 43 19 44 22 42C23 42 24 42 26 41L35 35C37 34 38 34 38 33C41 31 42 28 41 25C40 24 40 23 39 21C38 20 37 19 37 18C35 16 31 15 28 16C27 16 27 17 25 18L15 23Z\" fill=\"url(#codebuddyFill1)\"/><rect x=\"16\" y=\"30\" width=\"4\" height=\"8\" rx=\"2\" transform=\"rotate(-30 15.8816 30.0273)\" fill=\"white\"/><rect x=\"27\" y=\"24\" width=\"4\" height=\"8\" rx=\"2\" transform=\"rotate(-30 26.6978 23.7812)\" fill=\"white\"/></g><defs><filter id=\"codebuddyBlur0\" x=\"-15\" y=\"7\" width=\"55\" height=\"55\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"/><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"/><feGaussianBlur stdDeviation=\"6.7\" result=\"effect1_foregroundBlur_5110_14771\"/></filter><filter id=\"codebuddyBlur1\" x=\"9\" y=\"20\" width=\"48\" height=\"48\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"/><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"/><feGaussianBlur stdDeviation=\"5.5\" result=\"effect1_foregroundBlur_5110_14771\"/></filter><linearGradient id=\"codebuddyFill0\" x1=\"20\" y1=\"0\" x2=\"20\" y2=\"40\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#6C4DFF\"/><stop offset=\"1\" stop-color=\"#583ED3\"/></linearGradient><linearGradient id=\"codebuddyFill1\" x1=\"15\" y1=\"11\" x2=\"32\" y2=\"41\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"white\" stop-opacity=\"0.8\"/><stop offset=\".44\" stop-color=\"white\"/></linearGradient><clipPath id=\"codebuddyClip0\"><rect width=\"40\" height=\"40\" rx=\"20\" fill=\"white\"/></clipPath></defs>"
			},
			"codebuddy-intranet": {
				viewBox: "0 0 24 24",
				title: "CodeBuddy (intranet)",
				body: "<path d=\"M18.636.289a1 1 0 0 0-.11 0c-.18.01-.195.02-.442.24-.716.636-1.722 2.546-2.703 5.137l-.274.72-.499.16c-1.554.498-2.934 1.128-4.157 1.893-1.174.73-1.81 1.207-2.768 2.056l-.578.51-.262-.045c-2.528-.447-4.8-.612-5.843-.43-.414.077-.757.216-.862.35-.092.12-.138.263-.138.474 0 .182.034.414.098.727.265 1.236.952 2.854 2.035 4.78l.7 1.236-.023.466c-.027.499 0 1.27.06 1.793.036.319.031.327-.135.516-.565.647-.708 1.676-.408 2.84h5.364l-.33-.57c-.64-1.108-.96-1.663-1.134-2.177a5.46 5.46 0 0 1 1.564-5.84c.408-.358.962-.678 2.072-1.32l6.38-3.683c1.11-.64 1.665-.96 2.18-1.134A5.46 5.46 0 0 1 24 10.275V6.462l-.117-.06-.504-.25-.357-.662c-.924-1.702-2.41-3.696-3.477-4.666-.4-.364-.655-.517-.91-.535M11.57 17.634a1.26 1.26 0 0 1 1.722.462l1.358 2.35c.842 1.455-1.341 2.717-2.183 1.262l-1.358-2.352a1.26 1.26 0 0 1 .461-1.722m6.802-3.926a1.26 1.26 0 0 1 1.721.46l1.358 2.352c.84 1.455-1.343 2.715-2.183 1.26l-1.358-2.35a1.26 1.26 0 0 1 .462-1.722\"/>"
			},
			"cursor": {
				viewBox: "0 0 512 512",
				title: "Cursor",
				body: "<path d=\"m512 325.5c0 7.1 0 14.2 0 21.4 0 6-.1 12-.3 18-.4 13.1-1.1 26.2-3.4 39.2-2.4 13.1-6.2 25.3-12.3 37.2-6 11.7-13.7 22.4-23 31.7-9.3 9.3-20 17.1-31.7 23-11.9 6.1-24.1 9.9-37.2 12.3-12.9 2.3-26.1 3.1-39.2 3.4-6 .2-12 .2-18 .3-7.1 0-14.2 0-21.4 0h-139c-7.1 0-14.2 0-21.4 0-6 0-12-.1-18-.3-13.1-.4-26.2-1.1-39.2-3.4-13.1-2.4-25.3-6.2-37.2-12.3-11.7-6-22.4-13.7-31.7-23-9.3-9.3-17.1-20-23-31.7-6.1-11.9-9.9-24.1-12.3-37.2-2.3-12.9-3.1-26.1-3.4-39.2-.2-6-.2-12-.3-18 0-7.1 0-14.2 0-21.4v-139c0-7.1 0-14.2 0-21.4 0-6 .1-12 .3-18 .4-13.1 1.1-26.2 3.4-39.2 2.4-13.1 6.2-25.3 12.3-37.2 6-11.7 13.7-22.4 23-31.7 9.3-9.3 20-17.1 31.7-23 11.9-6.1 24.1-9.9 37.2-12.3 12.9-2.3 26.1-3.1 39.2-3.4 6-.2 12-.2 18-.3 7.1 0 14.2 0 21.4 0h139c7.1 0 14.2 0 21.4 0 6 0 12 .1 18 .3 13.1 .4 26.2 1.1 39.2 3.4 13.1 2.4 25.3 6.2 37.2 12.3 11.7 6 22.4 13.7 31.7 23 9.3 9.3 17.1 20 23 31.7 6.1 11.9 9.9 24.1 12.3 37.2 2.3 12.9 3.1 26.1 3.4 39.2 .2 6 .2 12 .3 18 0 7.1 0 14.2 0 21.4v139z\" fill=\"#14120b\"/><path d=\"m186.5 4h139c7.1 0 14.2 0 21.3 0 6 0 12 .1 17.9 .3h0c13 .4 25.9 1.1 38.6 3.4 12.8 2.3 24.6 6 36.1 11.9v0c11 5.6 21.1 12.8 29.8 21.5l.8 .8c9 9 16.5 19.4 22.3 30.7v0c5.7 11.2 9.4 22.6 11.7 34.9l.2 1.2c2.1 11.8 2.9 23.9 3.3 36.1l.1 2.4c.2 6 .2 11.9 .3 17.9v0c0 7.1 0 14.2 0 21.3v129.3l0 0v9.7c0 7.1 0 14.2 0 21.3 0 6-.1 12-.3 17.9v0c-.4 13-1.1 25.9-3.4 38.6-2.2 12.4-5.8 23.9-11.4 35l-.5 1.1c-5.8 11.3-13.3 21.7-22.3 30.7-9 9-19.4 16.5-30.7 22.3-11.5 5.9-23.3 9.6-36.1 11.9-11.8 2.1-23.9 2.9-36.1 3.3l-2.4 .1c-6 .2-11.9 .2-17.9 .3h0c-7.1 0-14.2 0-21.3 0h-139c-7.1 0-14.2 0-21.3 0-6 0-12-.1-17.9-.3h0c-13-.4-25.9-1.1-38.6-3.4-12.8-2.3-24.6-6-36.1-11.9h0c-11-5.6-21.1-12.8-29.8-21.5l-.8-.8c-8.7-8.7-16.1-18.7-21.7-29.6l-.5-1.1-.5-1.1c-5.4-10.8-8.9-21.9-11.1-33.8l-.2-1.2c-2.3-12.6-3-25.6-3.4-38.6v0c-.2-6-.2-11.9-.3-17.9 0-7.1 0-14.2 0-21.3v-139c0-7.1 0-14.2 0-21.3 0-6 .1-12 .3-17.9v0c.4-13 1.1-25.9 3.4-38.6 2.3-12.8 6-24.6 11.9-36.1l0 0c5.8-11.3 13.3-21.7 22.3-30.7 9-9 19.4-16.5 30.7-22.3 11.5-5.9 23.3-9.6 36.1-11.9 11.8-2.1 24-2.9 36.1-3.3l2.4-.1c6-.2 11.9-.2 17.9-.3l0 0c7.1 0 14.2 0 21.3 0z\" fill=\"none\" stroke=\"#edecec\" stroke-opacity=\".2\" stroke-width=\"8\"/><path d=\"m415 156.3-151.5-87.5c-4.9-2.8-10.9-2.8-15.7 0l-151.5 87.5c-4.1 2.4-6.6 6.7-6.6 11.5v176.4c0 4.7 2.5 9.1 6.6 11.5l151.5 87.5c4.9 2.8 10.9 2.8 15.7 0l151.5-87.5c4.1-2.4 6.6-6.7 6.6-11.5v-176.4c0-4.7-2.5-9.1-6.6-11.5zm-9.5 18.5-146.3 253.3c-1 1.7-3.6 1-3.6-1v-165.9c0-3.3-1.8-6.4-4.6-8l-143.6-82.9c-1.7-1-1-3.6 1-3.6h292.5c4.2 0 6.8 4.5 4.7 8.1h0z\" fill=\"#edecec\"/>"
			},
			"claude": {
				viewBox: "0 0 248 248",
				title: "Claude Code",
				body: "<path d=\"M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z\" fill=\"#D97757\"/>"
			},
			"qoder": {
				viewBox: "0 0 206 206",
				title: "Qoder",
				body: "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"m104 36 50 27q9 4 13 13 5 8 5 19v63q0 9-7 13-6 4-14 1l-9-4-1 1h-1l-1 1h-1l-1 1h-2l-2 1h-1l-2 1-3 1h-2l-1 1h-16l-1-1h-1l-2-1h-2l-1-1h-1l-49-26-1-1-7-4-2-3-1-2q-8-9-8-23V90l1-8v-1l1-4 1-3 2-4v-1l1-4h1v-1l2-3v-1l2-2 1-1 1-1v-1l3-3v-1l1-1 1-1 4-3 5-4h1l3-3h1l3-2h2l5-2 3-1 6-1h13l1 1h1l3 1zm1 127 1 1h2l1 1h4l1 1h3l1-1h5l1-1 4-1h2l1-1h2l1-1h1l1-1 1-1h1l1-1h5l11 5 5-1 2-4V95q0-16-13-24l-2-1h-2l-1-1h-11l-3 1-3 1h-2l-1 1-2 1h-1v21l-1 3v2l-1 4v2l-1 2-1 3-1 2v1l-1 1v1l-1 2v1l-1 1-1 2-1 1-1 1v1h-1l-1 2v1l-2 1-3 3-1 2h-1l-1 2h-1l-1 1v1h-1l-3 2-2 1q0 16 12 23m-20-11-2-13v-22l1-8v-1l1-3 1-4v-1l3-7 1-2 1-2v-1h1l1-2 3-5h1v-1l1-1 7-7 3-2 1-1 1-1h1l4-2v-1h1l2-1h1l3-2h1l2-1 3-1h1L99 45h-1l-1-1h-1l-1-1h-5v-1h-2l-2 1h-2l-4 1-3 1-4 1h-2v1h-1l-1 1h-1l-3 2-1 1-2 1-5 5h-1v1l-1 1-2 2-1 1v1h-1v1l-2 2v1l-1 2-1 1v1l-1 2v1l-1 1-1 4v1l-1 1v3l-1 5v24a28 28 0 0 0 6 19l2 1 5 4zm8-24v-1l2-1 4-4 1-2 1-1 1-1v-1l1-1v-1l1-1 1-1v-1l1-2 1-1v-1l1-1v-1l1-2v-2l1-2v-3l1-1V79l-1 1-5 6h-1l-1 1-3 4-1 2v1l-2 3-2 4-1 3-1 4v2l-1 4v14\" clip-rule=\"evenodd\"/><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.5\" d=\"m42 61-2 4h-1l-1 5-2 4v1l-1 2v2l-1 2v1l-1 8v23a38 38 0 0 0 9 25l2 3 8 5 49 26h1l1 1h2v1h3l1 1h16l1-1h2l3-1 3-1 2-1h2l1-1h1l1-1h1l1-1 9 4q8 3 14-1t7-13V95q0-11-5-19a32 32 0 0 0-13-13l-50-27h-1l-2-1-3-1h-1l-1-1H84l-6 1-3 1-5 2h-2l-3 2h-1l-4 3-5 4-5 4-1 1v1l-3 3v1l-2 2zm0 0Zm63 11-7 7-1 1v1h-1l-4 7h-1v1l-2 4-3 7v1l-1 4-1 3v1l-1 8v22l2 13-29-15-5-4-3-3q-5-7-5-17V90l1-7v-2l1-2 1-4 1-2v-1l1-2 1-1 1-3 1-1 1-1v-1h1v-1l1-1 2-2 1-1 1-1v-1l5-4 3-2 3-2h1l1-1h1v-1h1l5-1 3-1 4-1h2l4-1v1h5l1 1h1l2 1 29 15h-1l-3 1-2 1h-1l-3 2h-1l-3 1v1h-1l-4 2-1 1-1 1zm0 0Zm-4-37Zm4 128h1l1 1h2l1 1h4l1 1h3l1-1h5l1-1 4-1h2l1-1h2l1-1h1l1-1 1-1h1l1-1h5l11 5 5-1 2-4V95q0-16-13-24l-2-1h-2l-1-1h-11l-3 1-3 1h-2l-1 1-2 1h-1v21l-1 3v2l-1 4v2l-1 2-1 3-1 2v1l-1 1v1l-1 2v1l-1 1-1 2-1 1-1 1v1h-1l-1 2v1l-2 1-3 3-1 2h-1l-1 2h-1l-1 1v1h-1l-3 2-2 1q0 16 12 23Zm-12-35h1v-1l2-1 4-4 1-2 1-1 1-1v-1l1-1v-1l1-1 1-1v-1l1-2 1-1v-1l1-1v-1l1-2v-2l1-2v-3l1-1V79l-1 1-5 6h-1l-1 1-3 4-1 2v1l-2 3-2 4-1 3-1 4v2l-1 4z\"/>"
			},
			"trae": {
				viewBox: "0 0 24 24",
				title: "TRAE",
				body: "<path d=\"M24 20.5H3.5V17H0V3.5h24ZM3.5 17h17V7h-17Zm8.5-5-2.5 2.5L7 12l2.5-2.5Zm7 0-2.5 2.5L14 12l2.5-2.5z\"/>"
			},
			"trae-cn": {
				viewBox: "0 0 24 24",
				title: "Trae CN",
				body: "<path d=\"M24 20.5H3.5V17H0V3.5h24ZM3.5 17h17V7h-17Zm8.5-5-2.5 2.5L7 12l2.5-2.5Zm7 0-2.5 2.5L14 12l2.5-2.5z\"/>"
			},
			"cline": {
				viewBox: "0 0 24 24",
				title: "Cline",
				body: "<path d=\"m23.365 13.556-1.442-2.895V8.994c0-2.764-2.218-5.002-4.954-5.002h-2.464c.178-.367.276-.779.276-1.213A2.77 2.77 0 0 0 12.018 0a2.77 2.77 0 0 0-2.763 2.779c0 .434.098.846.276 1.213H7.067c-2.736 0-4.954 2.238-4.954 5.002v1.667L.64 13.549c-.149.29-.149.636 0 .927l1.472 2.855v1.667C2.113 21.762 4.33 24 7.067 24h9.902c2.736 0 4.954-2.238 4.954-5.002V17.33l1.44-2.865c.143-.286.143-.622.002-.91m-12.854 2.36a2.27 2.27 0 0 1-2.261 2.273 2.27 2.27 0 0 1-2.261-2.273v-4.042A2.27 2.27 0 0 1 8.249 9.6a2.267 2.267 0 0 1 2.262 2.274zm7.285 0a2.27 2.27 0 0 1-2.26 2.273 2.27 2.27 0 0 1-2.262-2.273v-4.042A2.267 2.267 0 0 1 15.535 9.6a2.267 2.267 0 0 1 2.261 2.274z\"/>"
			},
			"windsurf": {
				viewBox: "0 0 24 24",
				title: "Windsurf",
				body: "<path d=\"M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z\"/>"
			},
			"copilot": {
				viewBox: "0 0 24 24",
				title: "GitHub Copilot",
				body: "<path d=\"M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z\"/>"
			},
			"junie": {
				viewBox: "0 0 40 40",
				title: "Junie",
				body: "<path d=\"M25 15H35V16.75C35 29 30.5001 35 16.5001 35H15V25H16.5001C22.6251 25 25 22.875 25 16.75V15Z\" fill=\"#48E054\"/><rect x=\"5\" y=\"15\" width=\"10\" height=\"10\" fill=\"#48E054\"/><rect x=\"15\" y=\"5\" width=\"10\" height=\"10\" fill=\"#48E054\"/>"
			},
			"amazonq": {
				viewBox: "0 0 40 40",
				title: "Amazon Q",
				body: "<g clip-path=\"url(#amazonqClip0)\"><path d=\"M17.2353 2.73969L6.43534 8.975C4.72534 9.96219 3.67065 11.7875 3.67065 13.7647V26.2353C3.67065 28.2125 4.72534 30.0378 6.43534 31.025L17.2353 37.2603C18.9453 38.2475 21.0547 38.2475 22.7647 37.2603L33.5647 31.025C35.2747 30.0378 36.3294 28.2125 36.3294 26.2353V13.7647C36.3294 11.7903 35.2747 9.96219 33.5647 8.975L22.7647 2.73969C21.0547 1.7525 18.9453 1.7525 17.2353 2.73969Z\" fill=\"url(#amazonqFill0)\"/><path d=\"M30.4006 11.8859L21.8253 6.93594C21.3219 6.64625 20.6609 6.5 19.9972 6.5C19.3334 6.5 18.6725 6.64625 18.1691 6.93594L9.59375 11.8859C8.58969 12.4653 7.76562 13.8913 7.76562 15.05V24.95C7.76562 26.1116 8.58688 27.5347 9.59375 28.1141L18.1691 33.0641C18.6725 33.3537 19.3334 33.5 19.9972 33.5C20.6609 33.5 21.3219 33.3537 21.8253 33.0641L30.4006 28.1141C31.4047 27.5347 32.2288 26.1087 32.2288 24.95V15.05C32.2288 13.8884 31.4075 12.4653 30.4006 11.8859ZM20.7003 31.1178C20.6216 31.1628 20.3713 31.2528 19.9972 31.2528C19.6231 31.2528 19.3756 31.1656 19.2941 31.1178L10.7188 26.1678C10.4094 25.9906 10.0156 25.3072 10.0156 24.9528V15.0528C10.0156 14.6956 10.4094 14.015 10.7188 13.8378L19.2941 8.88781C19.3728 8.84281 19.6231 8.75281 19.9972 8.75281C20.3713 8.75281 20.6187 8.84 20.7003 8.88781L29.2756 13.8378C29.585 14.015 29.9788 14.6984 29.9788 15.0528V24.4662L22.25 20.0056V19.0803C22.25 18.8497 22.1262 18.6359 21.9266 18.5178L20.3234 17.5925C20.2222 17.5334 20.1125 17.5053 20 17.5053C19.8875 17.5053 19.775 17.5334 19.6766 17.5925L18.0734 18.5178C17.8738 18.6331 17.75 18.8469 17.75 19.0803V20.9309C17.75 21.1616 17.8738 21.3753 18.0734 21.4934L19.6766 22.4187C19.7778 22.4778 19.8875 22.5059 20 22.5059C20.1125 22.5059 20.225 22.4778 20.3234 22.4187L21.125 21.9575L28.8538 26.4181L20.7031 31.1234L20.7003 31.1178Z\" fill=\"white\"/></g><defs><linearGradient id=\"amazonqFill0\" x1=\"34.49\" y1=\"-0.691563\" x2=\"7.3044\" y2=\"38.1294\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#A7F8FF\"/><stop offset=\"0.03\" stop-color=\"#9DF1FF\"/><stop offset=\"0.08\" stop-color=\"#84E1FF\"/><stop offset=\"0.15\" stop-color=\"#5AC7FF\"/><stop offset=\"0.22\" stop-color=\"#21A2FF\"/><stop offset=\"0.26\" stop-color=\"#008DFF\"/><stop offset=\"0.66\" stop-color=\"#7F33FF\"/><stop offset=\"0.99\" stop-color=\"#39127D\"/></linearGradient><clipPath id=\"amazonqClip0\"><rect width=\"36\" height=\"36\" fill=\"white\" transform=\"translate(2 2)\"/></clipPath></defs>"
			},
			"tabnine": {
				viewBox: "0 0 30 34",
				title: "Tabnine",
				body: "<path fill=\"none\" d=\"M29.1527 17L8.03818 29M29.1527 17L7.96201 5.04375M29.1527 17V9L15.0764 1L7.96201 5.04375M29.1527 17L29.1527 25L15.0764 33L8.03818 29M8.03818 29L7.96201 5.04375M8.03818 29L1 25L1 9L7.96201 5.04375\" stroke=\"#FF4E40\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/>"
			},
			"continue": {
				viewBox: "0 0 13 13",
				title: "Continue",
				body: "<path d=\"M10.4742 1.6668L9.77141 2.88516L11.5477 5.95951C11.5607 5.98283 11.5685 6.01135 11.5685 6.03728C11.5685 6.0632 11.5607 6.09172 11.5477 6.11505L9.77141 9.19199L10.4742 10.4104L13 6.03728L10.4742 1.66421V1.6668ZM9.4991 2.72702L10.2019 1.50867H8.79634L8.09357 2.72702H9.5017H9.4991ZM8.09097 3.0433L9.73249 5.88173H11.138L9.4991 3.0433H8.09097ZM9.4991 9.03645L11.138 6.19542H9.73249L8.09097 9.03645H9.4991ZM8.09097 9.35273L8.79374 10.5659H10.1993L9.4965 9.35273H8.08837H8.09097ZM3.32716 10.8666C3.29864 10.8666 3.27271 10.8588 3.24939 10.8458C3.22599 10.8329 3.20527 10.8122 3.19227 10.7889L1.41332 7.71183H0.00777705L2.53362 12.0824H7.58267L6.87991 10.8666H3.32976H3.32716ZM7.15222 10.7085L7.85498 11.9242L8.55775 10.7059L7.85498 9.48755L7.15222 10.7059V10.7085ZM7.58267 9.33201H4.30484L3.60207 10.5503H6.87991L7.58267 9.33201ZM4.02992 9.17647L2.38841 6.33536L1.68562 7.55376L3.32716 10.3948L4.02992 9.17647ZM0.00518489 7.39562H1.41073L2.1135 6.17729H0.71055L0.00518489 7.39562ZM3.18454 1.29611C3.19746 1.27278 3.21826 1.25205 3.24159 1.23908C3.26491 1.22612 3.29344 1.21834 3.31936 1.21834H6.87471L7.57747 0H2.52582L0 4.37305H1.40555L3.17934 1.29871L3.18454 1.29611ZM2.1135 5.90506L1.41073 4.68673H0.00518489L0.707957 5.90506H2.1135ZM3.32196 1.69013L1.68303 4.52859L2.38581 5.74699L4.02472 2.90848L3.32196 1.69013ZM6.87731 1.532H3.59427L4.29704 2.75034H7.58007L6.87731 1.532ZM7.85498 2.5922L8.55515 1.37647L7.85498 0.158126L7.15222 1.37388L7.85498 2.5922Z\" fill=\"#6C707E\"/>"
			},
			"lingma": {
				viewBox: "0 0 32 32",
				title: "Lingma",
				body: "<defs><clipPath id=\"lingmaClip0\"><rect x=\"0\" y=\"0\" width=\"32\" height=\"32\" rx=\"0\"/></clipPath></defs><g clip-path=\"url(#lingmaClip0)\"><g><g><g><path d=\"M13.62132,26.8786Q14.5,27.7574,14.5,29L14.5,30L17.5,30L17.5,10Q17.5,7.5147200000000005,15.7426,5.75736Q13.98528,4,11.5,4L4,4L4,26L11.5,26Q12.74264,26,13.62132,26.8786Z\" fill-rule=\"evenodd\" fill=\"#1366EC\" fill-opacity=\"1\" style=\"mix-blend-mode:passthrough\"/></g></g><g><g><path d=\"M17.5,9.99788Q17.49931,7.70312,16,6.02912Q16.123589,5.89113,16.257359,5.75736Q18.01472,4,20.5,4L28,4L28,26L20.5,26L20.5,23L25,23L25,7L20.5,7Q19.25736,7,18.37868,7.87868Q17.50075,8.75662,17.5,9.99788Z\" fill-rule=\"evenodd\" fill=\"#FF6A00\" fill-opacity=\"1\" style=\"mix-blend-mode:passthrough\"/></g></g></g></g>"
			},
			"aiassistant": {
				viewBox: "0 0 40 40",
				title: "JetBrains AI Assistant",
				body: "<path fill=\"url(#aiassistantFill0)\" d=\"M6.48 9.44C9.36 7.8 13.32 7 16.72 7 26.68 7 33 11.64 33 17.92c0 5-4.36 8.08-10.16 8.08-4.68 0-8.16-1.72-8.16-4 0-2.16 2.2-3.2 5.32-2l.8-2.44c-4.84-1.56-8.84.64-8.84 4.44 0 3.8 4.72 6.52 11.04 6.52 7.52 0 13-4.16 13-10.6C36 9.88 28.4 4 16.72 4c-3.76 0-8 .96-11.48 2.84l1.24 2.6Zm27.04 21.12C30.64 32.2 26.68 33 23.28 33 13.32 33 7 28.36 7 22.08c0-5 4.36-8.08 10.16-8.08 4.68 0 8.16 1.72 8.16 4 0 2.16-2.2 3.2-5.32 2l-.8 2.44c4.84 1.56 8.84-.64 8.84-4.44 0-3.8-4.72-6.52-11.04-6.52-7.52 0-13 4.16-13 10.6C4 30.12 11.6 36 23.28 36c3.76 0 8-.96 11.48-2.84l-1.24-2.6Z\"/><defs><linearGradient id=\"aiassistantFill0\" x1=\"7.164\" x2=\"51.071\" y1=\"9.757\" y2=\"43.832\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#955AE0\"/><stop offset=\"1\" stop-color=\"#4D67F0\"/></linearGradient></defs>"
			},
			"antigravity": {
				viewBox: "0 0 180 180",
				title: "Google Antigravity",
				body: "<path d=\"M144.2 149.1C151.7 154.7 163 150.9 152.7 140.6C121.7 110.6 128.3 28.1 89.9 28.1C51.4 28.1 58 110.6 27.1 140.6C15.8 151.9 28 154.7 35.5 149.1C64.6 129.4 62.7 94.7 89.9 94.7C117.1 94.7 115.2 129.4 144.2 149.1Z\" fill=\"#3186FF\"/><mask id=\"antigravityMask0\" style=\"mask-type:alpha\" maskUnits=\"userSpaceOnUse\" x=\"22\" y=\"28\" width=\"136\" height=\"125\"><path d=\"M144.2 149.1C151.7 154.7 163 150.9 152.7 140.6C121.7 110.6 128.3 28.1 89.9 28.1C51.4 28.1 58 110.6 27.1 140.6C15.8 151.9 28 154.7 35.5 149.1C64.6 129.4 62.7 94.7 89.9 94.7C117.1 94.7 115.2 129.4 144.2 149.1Z\" fill=\"white\"/></mask><g mask=\"url(#antigravityMask0)\"><g filter=\"url(#antigravityBlur0)\"><ellipse cx=\"36.6\" cy=\"43.1\" rx=\"36.6\" ry=\"43.1\" transform=\"matrix(-0.1 1 -1 -0.1 106.6 -26.5)\" fill=\"#FFE432\"/></g><g filter=\"url(#antigravityBlur1)\"><ellipse cx=\"155.2\" cy=\"54.9\" rx=\"47.4\" ry=\"48.5\" transform=\"rotate(76.9 155.2 54.9)\" fill=\"#FC413D\"/></g><g filter=\"url(#antigravityBlur2)\"><ellipse cx=\"14.6\" cy=\"65.4\" rx=\"49.6\" ry=\"64.2\" transform=\"rotate(74.1 14.6 65.4)\" fill=\"#00B95C\"/></g><g filter=\"url(#antigravityBlur3)\"><ellipse cx=\"14.6\" cy=\"65.4\" rx=\"49.6\" ry=\"64.2\" transform=\"rotate(74.1 14.6 65.4)\" fill=\"#00B95C\"/></g><g filter=\"url(#antigravityBlur4)\"><ellipse cx=\"18.1\" cy=\"67.4\" rx=\"48.6\" ry=\"53.5\" transform=\"rotate(45.6 18.1 67.4)\" fill=\"#00B95C\"/></g><g filter=\"url(#antigravityBlur5)\"><ellipse cx=\"121.8\" cy=\"166.9\" rx=\"46.6\" ry=\"44.9\" transform=\"rotate(76.9 121.8 166.9)\" fill=\"#3186FF\"/></g><g filter=\"url(#antigravityBlur6)\"><ellipse cx=\"53.9\" cy=\"56.9\" rx=\"53.9\" ry=\"56.9\" transform=\"matrix(-0.4 0.9 -0.9 -0.4 162.8 -25.9)\" fill=\"#FBBC04\"/></g><g filter=\"url(#antigravityBlur7)\"><path d=\"M4.2 239.1C-25.3 227.5 25.2 132.1 37.7 100.1C50.3 68.1 84.4 51.6 113.9 63.2C143.5 74.8 178.5 138.7 165.9 170.6C153.4 202.6 33.8 250.7 4.2 239.1Z\" fill=\"#3186FF\"/></g><g filter=\"url(#antigravityBlur8)\"><path d=\"M183.2 120.3C175.3 129.5 154.7 124.8 137.1 109.8C119.6 94.8 111.7 75.1 119.6 65.9C127.6 56.6 148.2 61.3 165.7 76.4C183.3 91.4 191.1 111.1 183.2 120.3Z\" fill=\"#749BFF\"/></g><g filter=\"url(#antigravityBlur9)\"><ellipse cx=\"148.9\" cy=\"36.7\" rx=\"71.1\" ry=\"44.2\" transform=\"rotate(34.1 148.9 36.7)\" fill=\"#FC413D\"/></g><g filter=\"url(#antigravityBlur10)\"><ellipse cx=\"37.8\" cy=\"46\" rx=\"38.1\" ry=\"22.2\" transform=\"rotate(112.5 37.8 46)\" fill=\"#FFEE48\"/></g></g><defs><filter id=\"antigravityBlur0\" x=\"4.1\" y=\"-44.2\" width=\"111\" height=\"98.4\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"6.3\"/></filter><filter id=\"antigravityBlur1\" x=\"46.3\" y=\"-53\" width=\"217.7\" height=\"215.9\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"30.2\"/></filter><filter id=\"antigravityBlur2\" x=\"-100\" y=\"-36.8\" width=\"229.2\" height=\"204.4\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"25.7\"/></filter><filter id=\"antigravityBlur3\" x=\"-100\" y=\"-36.8\" width=\"229.2\" height=\"204.4\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"25.7\"/></filter><filter id=\"antigravityBlur4\" x=\"-84.4\" y=\"-35\" width=\"205\" height=\"204.8\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"25.7\"/></filter><filter id=\"antigravityBlur5\" x=\"28\" y=\"71.5\" width=\"187.7\" height=\"190.8\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"24.4\"/></filter><filter id=\"antigravityBlur6\" x=\"-11.9\" y=\"-98.7\" width=\"201.4\" height=\"197.4\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"22.1\"/></filter><filter id=\"antigravityBlur7\" x=\"-44.4\" y=\"20\" width=\"252.5\" height=\"260.4\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"19.8\"/></filter><filter id=\"antigravityBlur8\" x=\"81.2\" y=\"25.8\" width=\"140.5\" height=\"134.6\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"17.7\"/></filter><filter id=\"antigravityBlur9\" x=\"55.1\" y=\"-47.3\" width=\"187.6\" height=\"168\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"14.9\"/></filter><filter id=\"antigravityBlur10\" x=\"-24.3\" y=\"-27.2\" width=\"124.2\" height=\"146.4\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feGaussianBlur stdDeviation=\"18.5\"/></filter></defs>"
			},
			"kiro": {
				viewBox: "0 0 1200 1200",
				title: "Kiro",
				body: "<rect width=\"1200\" height=\"1200\" rx=\"260\" fill=\"#9046FF\"/><mask id=\"kiroMask0\" style=\"mask-type:luminance\" maskUnits=\"userSpaceOnUse\" x=\"272\" y=\"202\" width=\"655\" height=\"796\"><path d=\"M926.578 202.793H272.637V997.857H926.578V202.793Z\" fill=\"white\"/></mask><g mask=\"url(#kiroMask0)\"><path d=\"M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z\" fill=\"white\"/><path d=\"M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z\" fill=\"black\"/><path d=\"M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z\" fill=\"black\"/></g>"
			},
			"augment": {
				viewBox: "0 0 25 25",
				title: "Augment Code",
				body: "<rect width=\"25\" height=\"25\" fill=\"#233A3E\"/><path d=\"M5.51 21.16C5.17 21.16 4.89 21.11 4.66 20.99C4.44 20.88 4.26 20.71 4.15 20.48C4.03 20.25 3.97 19.97 3.97 19.64V16.25C3.97 15.83 3.89 15.52 3.72 15.33C3.56 15.14 3.26 15.04 2.83 15.04C2.7 15.04 2.6 14.99 2.52 14.89C2.43 14.79 2.39 14.67 2.39 14.54C2.39 14.4 2.43 14.29 2.52 14.2C2.6 14.11 2.7 14.06 2.83 14.05C3.26 14.04 3.56 13.94 3.72 13.75C3.89 13.56 3.97 13.26 3.97 12.85V9.46C3.97 8.96 4.1 8.58 4.37 8.33C4.63 8.07 5.01 7.94 5.51 7.94H9.56C9.71 7.94 9.84 7.98 9.94 8.07C10.04 8.16 10.09 8.28 10.09 8.41C10.09 8.54 10.05 8.66 9.96 8.75C9.88 8.85 9.76 8.89 9.62 8.89H5.86C5.64 8.89 5.48 8.95 5.37 9.06C5.26 9.17 5.2 9.34 5.2 9.57V12.98C5.2 13.27 5.14 13.55 5.02 13.79C4.9 14.03 4.74 14.23 4.54 14.37C4.33 14.51 4.1 14.57 3.82 14.57V14.51C4.1 14.51 4.33 14.58 4.54 14.72C4.74 14.86 4.9 15.06 5.02 15.3C5.14 15.54 5.2 15.82 5.2 16.11V19.54C5.2 19.77 5.26 19.94 5.37 20.05C5.48 20.16 5.65 20.21 5.86 20.21H9.62C9.76 20.21 9.88 20.26 9.96 20.35C10.05 20.45 10.09 20.56 10.09 20.69C10.09 20.82 10.04 20.93 9.94 21.03C9.84 21.12 9.71 21.17 9.56 21.17H5.51V21.16V21.16Z\" fill=\"#F8F7F7\" stroke=\"#F8F7F7\" stroke-width=\"0.26\" stroke-miterlimit=\"10\"/><path d=\"M15.44 21.16C15.29 21.16 15.16 21.12 15.06 21.02C14.96 20.93 14.91 20.81 14.91 20.69C14.91 20.56 14.95 20.44 15.04 20.35C15.12 20.25 15.24 20.21 15.38 20.21H19.14C19.36 20.21 19.52 20.15 19.63 20.04C19.74 19.93 19.8 19.76 19.8 19.53V16.11C19.8 15.81 19.86 15.54 19.98 15.3C20.1 15.05 20.26 14.86 20.47 14.72C20.67 14.58 20.91 14.51 21.18 14.51V14.57C20.91 14.57 20.67 14.5 20.47 14.36C20.26 14.22 20.1 14.03 19.98 13.79C19.86 13.54 19.8 13.27 19.8 12.97V9.56C19.8 9.33 19.74 9.17 19.63 9.05C19.52 8.95 19.36 8.89 19.14 8.89H15.38C15.24 8.89 15.13 8.84 15.04 8.75C14.95 8.65 14.91 8.54 14.91 8.41C14.91 8.27 14.96 8.16 15.06 8.07C15.16 7.98 15.29 7.93 15.44 7.93H19.49C19.99 7.93 20.37 8.06 20.63 8.32C20.9 8.58 21.03 8.96 21.03 9.46V12.85C21.03 13.26 21.11 13.56 21.28 13.75C21.45 13.94 21.74 14.04 22.17 14.05C22.3 14.06 22.41 14.1 22.49 14.19C22.57 14.28 22.61 14.4 22.61 14.54C22.61 14.67 22.57 14.78 22.49 14.88C22.41 14.98 22.3 15.03 22.17 15.03C21.74 15.04 21.45 15.14 21.28 15.33C21.11 15.52 21.03 15.82 21.03 16.24V19.63C21.03 19.96 20.97 20.24 20.85 20.47C20.74 20.7 20.57 20.87 20.34 20.99C20.11 21.1 19.83 21.16 19.49 21.16H15.44V21.16V21.16Z\" fill=\"#F8F7F7\" stroke=\"#F8F7F7\" stroke-width=\"0.26\" stroke-miterlimit=\"10\"/><path d=\"M16.48 15.84C17.22 15.84 17.82 15.25 17.82 14.53C17.82 13.8 17.22 13.21 16.48 13.21C15.75 13.21 15.15 13.8 15.15 14.53C15.15 15.25 15.75 15.84 16.48 15.84Z\" fill=\"#F8F7F7\" stroke=\"#F8F7F7\" stroke-width=\"0.26\" stroke-miterlimit=\"10\"/><path d=\"M9 15.84C9.74 15.84 10.34 15.25 10.34 14.53C10.34 13.8 9.74 13.21 9 13.21C8.26 13.21 7.66 13.8 7.66 14.53C7.66 15.25 8.26 15.84 9 15.84Z\" fill=\"#F8F7F7\" stroke=\"#F8F7F7\" stroke-width=\"0.26\" stroke-miterlimit=\"10\"/><path d=\"M12.04 4.13L11.94 6.82C11.94 6.97 11.8 7.05 11.51 7.05C11.22 7.05 11.07 6.97 11.07 6.82C11.05 6.15 11.03 5.63 11.01 5.26C11 4.89 10.99 4.62 10.99 4.46C10.98 4.3 10.97 4.2 10.97 4.17V4.12C10.97 3.93 11.15 3.83 11.51 3.83C11.87 3.83 12.04 3.93 12.04 4.13ZM14.21 4.13L14.11 6.82C14.11 6.97 13.97 7.05 13.68 7.05C13.39 7.05 13.24 6.97 13.24 6.82C13.22 6.15 13.2 5.63 13.18 5.26C13.17 4.89 13.16 4.62 13.15 4.46C13.15 4.3 13.14 4.2 13.14 4.17V4.12C13.14 3.93 13.32 3.83 13.68 3.83C14.03 3.83 14.21 3.93 14.21 4.13Z\" fill=\"#F8F7F7\" stroke=\"#F8F7F7\" stroke-width=\"0.26\" stroke-miterlimit=\"10\"/>"
			},
			"roo": {
				viewBox: "0 0 106 69",
				title: "Roo Code",
				body: "<path d=\"M88.4719 2.87946L86.5306 9.89906C86.4278 10.2707 86.0399 10.4854 85.6704 10.3752L53.106 0.659112C52.8894 0.594492 52.6549 0.640312 52.4786 0.781722L20.2279 26.6445C20.1338 26.72 20.0214 26.7694 19.9021 26.7878L0.713159 29.745C0.357849 29.7998 0.10453 30.1187 0.13164 30.4772L0.21502 31.5798C0.24165 31.932 0.53052 32.2069 0.88359 32.216L23.1724 32.7922L23.4266 32.7993L39.8958 24.0019C40.1264 23.8788 40.4068 23.8968 40.6197 24.0486L52.2875 32.3659C52.4705 32.4963 52.5783 32.7078 52.5762 32.9325L52.4778 43.9686C52.4765 44.1114 52.5197 44.2511 52.6014 44.3683L69.0144 67.9188C69.1431 68.1034 69.354 68.2135 69.5791 68.2135H74.7748C75.2932 68.2135 75.6255 67.6623 75.3836 67.2039L63.6853 45.0427C63.5709 44.8259 63.5804 44.5647 63.7101 44.3568L69.8094 34.5861C69.8758 34.4797 69.97 34.3935 70.0819 34.3367L91.8879 23.2712C92.1095 23.1588 92.3744 23.1745 92.5812 23.3123L98.8125 27.4657C98.9256 27.5411 99.0584 27.5813 99.1943 27.5813H104.856C105.404 27.5813 105.732 26.9716 105.43 26.514L89.7099 2.6839C89.3844 2.19053 88.6294 2.30979 88.4719 2.87946Z\" fill=\"currentColor\"/>"
			},
			"qoder-cn": {
				viewBox: "0 0 206 206",
				title: "Qoder CN",
				body: "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"m104 36 50 27q9 4 13 13 5 8 5 19v63q0 9-7 13-6 4-14 1l-9-4-1 1h-1l-1 1h-1l-1 1h-2l-2 1h-1l-2 1-3 1h-2l-1 1h-16l-1-1h-1l-2-1h-2l-1-1h-1l-49-26-1-1-7-4-2-3-1-2q-8-9-8-23V90l1-8v-1l1-4 1-3 2-4v-1l1-4h1v-1l2-3v-1l2-2 1-1 1-1v-1l3-3v-1l1-1 1-1 4-3 5-4h1l3-3h1l3-2h2l5-2 3-1 6-1h13l1 1h1l3 1zm1 127 1 1h2l1 1h4l1 1h3l1-1h5l1-1 4-1h2l1-1h2l1-1h1l1-1 1-1h1l1-1h5l11 5 5-1 2-4V95q0-16-13-24l-2-1h-2l-1-1h-11l-3 1-3 1h-2l-1 1-2 1h-1v21l-1 3v2l-1 4v2l-1 2-1 3-1 2v1l-1 1v1l-1 2v1l-1 1-1 2-1 1-1 1v1h-1l-1 2v1l-2 1-3 3-1 2h-1l-1 2h-1l-1 1v1h-1l-3 2-2 1q0 16 12 23m-20-11-2-13v-22l1-8v-1l1-3 1-4v-1l3-7 1-2 1-2v-1h1l1-2 3-5h1v-1l1-1 7-7 3-2 1-1 1-1h1l4-2v-1h1l2-1h1l3-2h1l2-1 3-1h1L99 45h-1l-1-1h-1l-1-1h-5v-1h-2l-2 1h-2l-4 1-3 1-4 1h-2v1h-1l-1 1h-1l-3 2-1 1-2 1-5 5h-1v1l-1 1-2 2-1 1v1h-1v1l-2 2v1l-1 2-1 1v1l-1 2v1l-1 1-1 4v1l-1 1v3l-1 5v24a28 28 0 0 0 6 19l2 1 5 4zm8-24v-1l2-1 4-4 1-2 1-1 1-1v-1l1-1v-1l1-1 1-1v-1l1-2 1-1v-1l1-1v-1l1-2v-2l1-2v-3l1-1V79l-1 1-5 6h-1l-1 1-3 4-1 2v1l-2 3-2 4-1 3-1 4v2l-1 4v14\" clip-rule=\"evenodd\"/><path fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.5\" d=\"m42 61-2 4h-1l-1 5-2 4v1l-1 2v2l-1 2v1l-1 8v23a38 38 0 0 0 9 25l2 3 8 5 49 26h1l1 1h2v1h3l1 1h16l1-1h2l3-1 3-1 2-1h2l1-1h1l1-1h1l1-1 9 4q8 3 14-1t7-13V95q0-11-5-19a32 32 0 0 0-13-13l-50-27h-1l-2-1-3-1h-1l-1-1H84l-6 1-3 1-5 2h-2l-3 2h-1l-4 3-5 4-5 4-1 1v1l-3 3v1l-2 2zm0 0Zm63 11-7 7-1 1v1h-1l-4 7h-1v1l-2 4-3 7v1l-1 4-1 3v1l-1 8v22l2 13-29-15-5-4-3-3q-5-7-5-17V90l1-7v-2l1-2 1-4 1-2v-1l1-2 1-1 1-3 1-1 1-1v-1h1v-1l1-1 2-2 1-1 1-1v-1l5-4 3-2 3-2h1l1-1h1v-1h1l5-1 3-1 4-1h2l4-1v1h5l1 1h1l2 1 29 15h-1l-3 1-2 1h-1l-3 2h-1l-3 1v1h-1l-4 2-1 1-1 1zm0 0Zm-4-37Zm4 128h1l1 1h2l1 1h4l1 1h3l1-1h5l1-1 4-1h2l1-1h2l1-1h1l1-1 1-1h1l1-1h5l11 5 5-1 2-4V95q0-16-13-24l-2-1h-2l-1-1h-11l-3 1-3 1h-2l-1 1-2 1h-1v21l-1 3v2l-1 4v2l-1 2-1 3-1 2v1l-1 1v1l-1 2v1l-1 1-1 2-1 1-1 1v1h-1l-1 2v1l-2 1-3 3-1 2h-1l-1 2h-1l-1 1v1h-1l-3 2-2 1q0 16 12 23Zm-12-35h1v-1l2-1 4-4 1-2 1-1 1-1v-1l1-1v-1l1-1 1-1v-1l1-2 1-1v-1l1-1v-1l1-2v-2l1-2v-3l1-1V79l-1 1-5 6h-1l-1 1-3 4-1 2v1l-2 3-2 4-1 3-1 4v2l-1 4z\"/>"
			},
			"devin": {
				viewBox: "0 0 425 425",
				title: "Devin",
				body: "<path d=\"M70 159.333V91.3471C70 88.3592 71.594 85.5983 74.1816 84.1044L133.043 50.1205C135.631 48.6265 138.819 48.6265 141.407 50.1205L200.269 84.1044C202.856 85.5983 204.45 88.3592 204.45 91.3471V126.068C204.708 137.606 210.806 148.734 221.531 154.926C232.256 161.117 244.942 160.834 255.063 155.289L285.132 137.929C287.719 136.435 290.907 136.435 293.495 137.929L352.357 171.913C354.944 173.406 356.538 176.167 356.538 179.155V247.123C356.538 250.111 354.944 252.872 352.357 254.366L293.495 288.35C290.907 289.844 287.719 289.844 285.132 288.35L255.306 271.13C245.146 265.456 232.344 265.117 221.534 271.358C210.809 277.55 204.711 288.678 204.453 300.215V334.926C204.453 337.914 202.859 340.675 200.271 342.169L141.41 376.153C138.822 377.647 135.634 377.647 133.046 376.153L74.1845 342.169C71.5969 340.675 70.0028 337.914 70.0028 334.926V266.959C70.0029 263.971 71.5969 261.21 74.1845 259.716L133.046 225.732C135.634 224.238 138.822 224.238 141.41 225.732L171.547 243.132C181.656 248.638 194.306 248.906 205.005 242.729C215.815 236.488 221.922 225.231 222.088 213.595C221.83 202.057 215.732 189.737 205.008 183.545C194.283 177.353 181.597 177.636 171.476 183.181L141.269 200.72C138.67 202.229 135.461 202.228 132.864 200.716L74.1576 166.562C71.5835 165.065 70 162.311 70 159.333Z\" fill=\"currentColor\"/>"
			}
		};
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
		* Resolve a plugin route against the document base.
		*
		* A bare \`fetch('/api/...')\` resolves against the *origin* root, which drops
		* the directory the GUI is actually mounted at; the window URL may also be a
		* \`file://\` URL under Electron. Resolving against \`document.baseURI\` keeps the
		* mount point, which is what the reference plugin does. The launch token in the
		* query is deliberately not carried over: by the time the panel runs, the
		* window has been redirected to the clean URL and authentication rides the
		* signed cookie the browser attaches to same-origin requests anyway.
		*
		* \`base\` is a parameter so the behavior is testable without a DOM. A base whose
		* last segment looks like a file name is reduced to its directory.
		*/
		function resolveUrl(path, base) {
			if (!path.startsWith("/") || path.startsWith("//")) return path;
			const resolved = base ?? (typeof document === "undefined" ? void 0 : document.baseURI);
			if (resolved === void 0 || resolved === "") return path;
			try {
				const rooted = new URL(resolved);
				if (!rooted.pathname.endsWith("/")) rooted.pathname = rooted.pathname.slice(rooted.pathname.lastIndexOf("/") + 1).includes(".") ? rooted.pathname.slice(0, rooted.pathname.lastIndexOf("/") + 1) : rooted.pathname + "/";
				return new URL(path.slice(1), rooted.href).href;
			} catch {
				return path;
			}
		}
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
		/** Per-rule cap when rendering a rule body inline. */
		const PER_RULE_MAX = 8e3;
		/** Total cap for always-on rules whose scope is the user. */
		const USER_RULES_TOTAL_MAX = 6e3;
		/** Total cap for always-on rules whose scope is the project. */
		const PROJECT_RULES_TOTAL_MAX = 12e3;
		// src/cost.ts
		/**
		* What the rules block actually costs.
		*
		* The numbers here mirror what the host really injects. A per-rule guess is
		* wrong in both directions, so the shape of each type matters:
		*
		* - `always` puts the rule's *body* in the prompt. Its `description` is never
		*   read for that bucket (see `partition()` in render.ts).
		* - `requested` puts one catalog line — the absolute path plus the description
		*   — in the prompt; the body arrives later through `read_rules`.
		* - `manual` is never injected at all.
		*
		* Past that, `applyBudget` truncates an always-on body beyond the per-rule cap
		* and drops whole rules once a tier's running total is spent, so a rule may
		* cost less than its own length, or nothing at all. The budget is charged in
		* *characters*, exactly as `applyBudget` charges it, while the figures the
		* panel shows are tokens; `bodyLength` carries the first and `bodyTokens` the
		* second.
		*
		* The module is pure and cannot see `state.json` or the source switches: it
		* has no way to tell a rule disabled in its own frontmatter from one switched
		* off in the panel or through a disabled source. `active` is therefore the
		* caller's final verdict, already folded from `enabled`, the source switch and
		* the disabled list. An inactive rule costs nothing here.
		*
		* One caveat the caller should know about: a body clipped by the per-rule cap
		* really costs a little less than `bodyTokens`, and the clipped text is not
		* available to this module. `truncated` marks those rules, and their
		* `bodyTokens` is an upper bound.
		*/
		/** Per-rule cap on an always-on body, mirroring `PER_RULE_MAX`. */
		const CATALOG_PER_RULE_MAX = PER_RULE_MAX;
		/** Running cap for always-on user rules, mirroring `USER_RULES_TOTAL_MAX`. */
		const CATALOG_USER_TOTAL_MAX = USER_RULES_TOTAL_MAX;
		/** Running cap for always-on project rules, mirroring `PROJECT_RULES_TOTAL_MAX`. */
		const CATALOG_PROJECT_TOTAL_MAX = PROJECT_RULES_TOTAL_MAX;
		/**
		* Which of the two always-on tiers a rule is charged to.
		*
		* An explicit {@link CostRule.scope} wins: it is the host's own verdict, taken
		* from the scan root, and it stays right when the caller's `projectRoot` is not
		* the root the rule was scanned under - or is null, which a scope-carrying
		* caller passes. Only a caller with no scope of its own falls back to the
		* path-prefix test `partition()` uses: under the project root means project.
		*/
		function isProjectRule(rule, projectRoot) {
			if (rule.scope !== void 0) return rule.scope === "project";
			return projectRoot !== null && rule.path.startsWith(projectRoot);
		}
		/**
		* The characters an always-on body charges against its tier total.
		*
		* `applyBudget` truncates first and then measures what the truncated content
		* costs, marker included — so a clipped body is charged slightly more than the
		* cap, not slightly less. That order is what decides whether a following rule
		* fits, so it is reproduced exactly.
		*/
		function alwaysCharge(rule, perRuleMax) {
			if (rule.bodyLength <= perRuleMax) return {
				chars: rule.bodyLength,
				truncated: false
			};
			return {
				chars: perRuleMax + truncationMarker(perRuleMax).length,
				truncated: true
			};
		}
		/**
		* The cost of a single rule, on its own.
		*
		* No tier accounting happens here: `omitted` is always false, because whether a
		* rule was dropped depends on the rules before it. `costOfRules` layers that on
		* top by calling this function, so the per-rule figures the panel shows and the
		* totals it sums can never drift apart.
		*/
		function costOfRule(rule, projectRoot, overrides) {
			const scope = isProjectRule(rule, projectRoot) ? "project" : "user";
			const type = attachedNow(rule.type, overrides?.attached, rule.path) ? "always" : rule.type;
			const base = {
				key: rule.path,
				name: rule.name,
				type,
				scope
			};
			if (!rule.active) return {
				...base,
				active: false,
				resident: 0,
				onDemand: 0,
				truncated: false,
				omitted: false
			};
			if (type === "always") {
				const charge = alwaysCharge(rule, overrides?.perRuleMax ?? CATALOG_PER_RULE_MAX);
				return {
					...base,
					active: true,
					resident: rule.bodyTokens,
					onDemand: 0,
					truncated: charge.truncated,
					omitted: false
				};
			}
			if (type === "requested") return {
				...base,
				active: true,
				resident: estimateTokens(catalogLine(rule)),
				onDemand: rule.bodyTokens,
				truncated: false,
				omitted: false
			};
			return {
				...base,
				active: true,
				resident: 0,
				onDemand: 0,
				truncated: false,
				omitted: false
			};
		}
		/** Fixed cost of one non-empty tier: the whole section minus its rows. */
		function scaffoldCost(part) {
			if (part.rows === "") return 0;
			return Math.max(0, estimateTokens(part.section) - estimateTokens(part.rows));
		}
		/**
		* Cost every rule in `rules` as the host would inject it.
		*
		* `always` rules go through the same order `applyBudget` uses: truncate past
		* the per-rule cap first, then charge the truncated length against the tier
		* total and drop the rule whole if it would not fit. A dropped rule does not
		* advance the total, so a later, smaller rule can still be kept. The two tiers
		* keep independent counters, and within a tier the order is input order.
		*
		* The tier each rule is charged to comes from `rule.scope` when the caller
		* supplies it, and from a path-prefix test against `projectRoot` otherwise.
		*
		* `requested` and `manual` rules are never budgeted: the former is charged its
		* catalog line as resident and its body as on-demand, the latter on-demand
		* only. `catalog` then carries just the scaffolding both requestable sections
		* add on top of their rows, so `catalog` plus the per-rule residents is exactly
		* what the requestable index costs.
		*/
		function costOfRules(rules, projectRoot, overrides) {
			const perRuleMax = overrides?.perRuleMax ?? CATALOG_PER_RULE_MAX;
			const totals = {
				user: overrides?.userTotal ?? CATALOG_USER_TOTAL_MAX,
				project: overrides?.projectTotal ?? CATALOG_PROJECT_TOTAL_MAX
			};
			const used = {
				user: 0,
				project: 0
			};
			const lines = [];
			const truncated = [];
			const omitted = [];
			let resident = 0;
			let onDemand = 0;
			for (const rule of rules) {
				const line = costOfRule(rule, projectRoot, overrides);
				if (!line.active) {
					lines.push(line);
					continue;
				}
				onDemand += line.onDemand;
				if (line.truncated) truncated.push(line.key);
				if (line.type !== "always") {
					resident += line.resident;
					lines.push(line);
					continue;
				}
				const charge = alwaysCharge(rule, perRuleMax);
				if (used[line.scope] + charge.chars > totals[line.scope]) {
					omitted.push(line.key);
					lines.push({
						...line,
						resident: 0,
						omitted: true
					});
					continue;
				}
				used[line.scope] += charge.chars;
				resident += line.resident;
				lines.push(line);
			}
			const onDemandRule = (rule) => rule.active && rule.type === "requested" && overrides?.attached?.has(rule.path) !== true;
			const projectRequested = rules.filter((rule) => onDemandRule(rule) && isProjectRule(rule, projectRoot));
			const userRequested = rules.filter((rule) => onDemandRule(rule) && !isProjectRule(rule, projectRoot));
			const projectRows = projectRequested.map(catalogLine).join("\n");
			const userRows = userRequested.map(catalogLine).join("\n");
			const catalog = scaffoldCost({
				rows: projectRows,
				section: requestableSection("agent_requestable_workspace_rules", "workspace-level", projectRows)
			}) + scaffoldCost({
				rows: userRows,
				section: requestableSection("agent_requestable_user_rules", "user-level", userRows)
			});
			return {
				lines,
				resident,
				onDemand,
				catalog,
				truncated,
				omitted
			};
		}
		// src/client/group.ts
		/**
		* Which bucket a rule belongs in.
		*
		* Three states came from the file's own `type`; `'off'` is the fourth and is
		* decided by {@link RuleRow.active}, so a rule switched off from this panel
		* lands here rather than disappearing.
		*/
		function statusOf(rule) {
			return rule.active ? rule.type : "off";
		}
		/**
		* Tokens one requestable rule contributes as its catalog line.
		*
		* The line is `- <path>: <description>` — the path is the key the agent passes
		* to `read_rules`, and the description is its only basis for deciding whether
		* to. Counting the description alone under-reported the real line, and the
		* absolute path is often the longer half.
		*
		* Built through the same helper the host renders with (`catalogLine` in
		* rule-layout.ts, which the injected block and the host cost model both use),
		* so a change there is a change to the same measured thing here.
		*/
		function catalogLineTokens(rule) {
			return estimateTokens(catalogLine(rule));
		}
		/**
		* Token cost of one rule, split the way the panel explains it.
		*
		* `resident` is what sits in the prompt on every request; `onDemand` is what
		* is only paid for when the model actually reads the rule. The split mirrors
		* what `partition()` and `requestableSection()` in render.ts really inject:
		*
		* - `always` puts the rule's **body** in the prompt. Its description is not
		*   injected at all for that bucket, so adding it here (as this function once
		*   did) overstated every always-on rule.
		* - `requested` puts one catalog line — path plus description — in the prompt,
		*   and the body arrives only if the model asks.
		* - `manual` is never injected by anything: it is not in the render block and
		*   not in the requestable index, so it costs nothing until a person calls the
		*   tool by name. Reporting its body as "on demand" promised a load that no
		*   agent path can trigger.
		*
		* The fixed scaffolding around the requestable sections is deliberately not
		* here: it belongs to no single rule. `TokenBreakdown` adds it once, through
		* `costOfRules`.
		*/
		function ruleCost(rule) {
			if (!rule.active) return {
				resident: 0,
				onDemand: 0
			};
			if (rule.type === "always" || rule.attached === true) return {
				resident: rule.bodyTokens,
				onDemand: 0
			};
			if (rule.type === "requested") return {
				resident: catalogLineTokens(rule),
				onDemand: rule.bodyTokens
			};
			return {
				resident: 0,
				onDemand: 0
			};
		}
		/**
		* One row as the cost model takes it.
		*
		* The scope is the host's own verdict, carried from the scan root, and is
		* handed over explicitly: the model's fallback (a path prefix of the project
		* root) is only a guess, and the two tiers it decides between are budgeted
		* separately (6000 characters for user rules, 12000 for project rules).
		*/
		function toCostRule(rule) {
			return {
				path: rule.path,
				name: rule.name,
				type: rule.type,
				active: rule.active,
				description: rule.description,
				descriptionTokens: rule.descriptionTokens,
				bodyTokens: rule.bodyTokens,
				bodyLength: rule.bodyLength,
				scope: rule.scope
			};
		}
		/**
		* The full cost report for a set of rules, budget included.
		*
		* The per-rule figures are the same maths the rows print, but the report also
		* carries what no single rule owns: the fixed scaffolding of the requestable
		* index (`catalog`), which rules the 8000-character cap clipped, and which
		* ones a tier total dropped entire. Without those the panel's total was an
		* upper bound that no real request ever matched.
		*/
		function costReport(rules) {
			const attached = new Set(rules.filter((rule) => rule.attached === true).map((rule) => rule.path));
			return costOfRules(rules.map(toCostRule), null, attached.size === 0 ? void 0 : { attached });
		}
		/**
		* Total tokens that stay in the prompt for this set of rules.
		*
		* Summed the way a request is actually built: the budgeted per-rule residents
		* plus the requestable index's scaffolding. The headline and the breakdown
		* table therefore agree by construction, instead of by two arithmetics
		* happening to coincide.
		*/
		function totalResidentTokens(rules) {
			const report = costReport(rules);
			return report.resident + report.catalog;
		}
		/**
		* Legacy figure: the description text of enabled always-on rules.
		*
		* Kept because it is what the pre-grouping summary reported and a test pins it.
		* New UI should prefer {@link totalResidentTokens}, which also counts an
		* always-on rule's *body* — the thing that actually costs the most.
		*/
		function residentTokens(rules) {
			return rules.reduce((total, rule) => rule.enabled && rule.type === "always" ? total + rule.descriptionTokens : total, 0);
		}
		/**
		* Case-insensitive search over name, description and path.
		*
		* The path is searched because that is how a user identifies a rule they only
		* half-remember ("the one under .cursor").
		*/
		function filterRules(rules, query) {
			const needle = query.trim().toLowerCase();
			if (needle === "") return rules;
			return rules.filter((rule) => rule.name.toLowerCase().includes(needle) || rule.description.toLowerCase().includes(needle) || rule.path.toLowerCase().includes(needle));
		}
		/**
		* The two tab axes, applied one at a time.
		*
		* The panel runs scope first because *every* number it prints — the stat bar,
		* the tab labels, the source dropdown — describes the rows underneath the tabs.
		* Counting the unscoped catalog left "全局" showing an empty list next to
		* "全部（14）": a tab that looked like it did nothing at all.
		*/
		function scopeIn(rules, scope) {
			return scope === "all" ? rules : rules.filter((rule) => rule.scope === scope);
		}
		/** Narrow a scope-filtered list to one status bucket. */
		function statusIn(rules, status) {
			return status === "all" ? rules : rules.filter((rule) => statusOf(rule) === status);
		}
		/** How many rules fall in each bucket, for the tab labels. */
		/**
		* One source's identity across both tiers.
		*
		* The same key exists under \`~\` and under the project (\`codebuddy\` twice), so a
		* bare key addresses nothing in particular. Every rule-to-source match — the
		* group list, the source dropdown — compares this scoped id instead.
		*/
		function sourceId(source) {
			return source.scope + ":" + source.key;
		}
		/** The scoped source id a rule belongs to, matching \`sourceId\` above. */
		function ruleSourceId(rule) {
			return rule.scope + ":" + rule.sourceKey;
		}
		/**
		* The bare source key behind a scope-qualified id (user:codebuddy becomes
		* codebuddy).
		*
		* A group's id is {@link sourceId}'s \<scope>:\<key>, but the wire action carries
		* the key and the scope as two fields, so the id has to be taken apart again.
		* One place for that split keeps the badge and the switch from drifting apart.
		*/
		function sourceKeyOf(groupKey) {
			const colon = groupKey.indexOf(":");
			return colon === -1 ? groupKey : groupKey.slice(colon + 1);
		}
		/**
		* Which tab an arrow, Home or End press moves to; null for any other key.
		*
		* Pure so the keyboard contract is testable without a DOM. The caller selects
		* the tab at the returned index and moves focus to it, which is APG's automatic
		* activation - the same behavior the packaged SegmentedTabs implements.
		*/
		function tabStep(key, index, length) {
			if (length <= 0 || index < 0) return null;
			if (key === "ArrowLeft") return (index - 1 + length) % length;
			if (key === "ArrowRight") return (index + 1) % length;
			if (key === "Home") return 0;
			if (key === "End") return length - 1;
			return null;
		}
		/**
		* Narrow a source list to one scope tab.
		*
		* Handing the unscoped list to \`groupBySource\` kept the other tier's cards on
		* screen after a tab switch — as empty "0 rules" groups, which read as "the tab
		* did nothing". The panel filters through here before both the dropdown and the
		* groups.
		*/
		function filterByScope(sources, scope) {
			return scope === "all" ? sources : sources.filter((source) => source.scope === scope);
		}
		function statusCounts(rules) {
			const counts = {
				always: 0,
				requested: 0,
				manual: 0,
				off: 0
			};
			for (const rule of rules) counts[statusOf(rule)] += 1;
			return counts;
		}
		/**
		* Group rules by source, in the host's source order.
		*
		* The host's `sources` list is the ordering authority (it is already sorted by
		* rank) and the only place the real absolute path exists. A source that
		* contributed no matching rule is **kept** when it exists on disk, so the panel
		* can still show its path and its switch — hiding an empty source would remove
		* the only place to turn it back on.
		*/
		function groupBySource(rules, sources) {
			const groups = [];
			const seen = /* @__PURE__ */ new Set();
			for (const source of sources) {
				const key = source.scope + ":" + source.key;
				if (seen.has(key)) continue;
				seen.add(key);
				groups.push({
					key,
					label: source.label,
					scope: source.scope,
					path: source.path,
					enabled: source.enabled,
					rules: rules.filter((rule) => rule.sourceKey === source.key && rule.scope === source.scope)
				});
			}
			for (const rule of rules) {
				const key = rule.scope + ":" + rule.sourceKey;
				if (seen.has(key)) continue;
				seen.add(key);
				groups.push({
					key,
					label: rule.sourceLabel,
					scope: rule.scope,
					path: "",
					enabled: true,
					rules: rules.filter((r) => r.sourceKey === rule.sourceKey && r.scope === rule.scope)
				});
			}
			return groups;
		}
		/**
		* Order rules by what they cost, most expensive first.
		*
		* Ties break on name so the order is stable between renders. Cheap rules sink
		* to the bottom, which is where a user looking for savings expects to find
		* nothing worth acting on.
		*/
		function sortByCost(rules) {
			return [...rules].sort((a, b) => {
				const diff = ruleCost(b).resident - ruleCost(a).resident;
				return diff !== 0 ? diff : a.name.localeCompare(b.name);
			});
		}
		/** Why a rule is not in effect, for the row's explanation. */
		function disabledReasonKey(rule) {
			if (rule.active) return null;
			if (rule.disabledBy === "frontmatter") return "offReason.frontmatter";
			if (rule.disabledBy === "source") return "offReason.source";
			return "offReason.state";
		}
		/** The explanation key that goes with a rule's current state. */
		function noteKeyOf(rule) {
			if (!rule.active) return "note.off";
			if (rule.attached === true) return "note.attached";
			if (rule.type === "always") return "note.always";
			if (rule.type === "requested") return "note.requested";
			return "note.manual";
		}
		/** Scope match: an action that names no tier addresses every tier (legacy). */
		const sameScope = (scope, target) => scope === void 0 || scope === target;
		/**
		* The payload as it will look once the host accepts this action.
		*
		* Only the switched field moves; everything else is copied, so a failed write
		* cannot leave a half-updated list behind. Pure, so the rollback path (restore
		* the last confirmed payload) is trivially correct.
		*/
		function optimistic(payload, action) {
			if (action.action === "setSource") return {
				...payload,
				sources: payload.sources.map((source) => source.key === action.key && sameScope(action.scope, source.scope) ? {
					...source,
					enabled: action.enabled
				} : source),
				rules: payload.rules.map((rule) => {
					if (rule.sourceKey !== action.key || !sameScope(action.scope, rule.scope)) return rule;
					if (!action.enabled) return {
						...rule,
						active: false,
						disabledBy: "source"
					};
					const blocked = rule.disabledBy === "frontmatter" ? "frontmatter" : rule.disabledBy === "state" ? "state" : rule.enabled ? null : "frontmatter";
					return {
						...rule,
						active: blocked === null,
						disabledBy: blocked
					};
				})
			};
			return {
				...payload,
				rules: payload.rules.map((rule) => {
					if (rule.sourceKey !== action.key || rule.path !== action.path || !sameScope(action.scope, rule.scope)) return rule;
					if (!action.enabled) return {
						...rule,
						active: false,
						disabledBy: "state"
					};
					const blocked = rule.disabledBy === "frontmatter" ? "frontmatter" : rule.disabledBy === "source" ? "source" : rule.enabled ? null : "frontmatter";
					return {
						...rule,
						active: blocked === null,
						disabledBy: blocked
					};
				})
			};
		}
		/** Fill `{name}`-style interpolations in one pass. */
		function format(template, values) {
			return template.replace(/\{(\w+)\}/g, (match, name) => name in values ? String(values[name]) : match);
		}
		// src/client/index.tsx
		/**
		* Browser entry: the settings section, the sidebar entry, and the main panel.
		*
		* The client half must **return a plugin object**, not a bag of named exports:
		* DSH's own loader rejects anything else.
		* \`dsh-cordis-client-runner/src/client/evaluator.ts\` guards the closure's
		* return value with \`isDynamicCordisPlugin\` and throws
		* "client half must \`return\` a plugin: a function, or an object with an
		* \`apply(ctx)\` method" otherwise. Without an \`apply\` export every
		* registration below is dead code: no settings section, no sidebar entry.
		*
		* \`inject\` lists only \`slots\`. Cordis has no optional-dependency syntax
		* (\`docs/cordis-tutorial/03-services.zh.md\`): a missing injected service
		* unmounts the whole plugin, so \`locale\` — a nice-to-have — is probed at
		* use time through \`ctx.get('locale')\` instead.
		*/
		const SECTION_ID = "dsh-rules-manager";
		const PANEL_ID = "dsh-rules-manager";
		const NS = "dshRulesManager";
		/** DOM id of one tab, so a tablist's roving tab stop has a stable target. */
		const tabId = (list, key) => SECTION_ID + "-" + list + "-tab-" + key;
		/** The one region both tablists filter; every tab points at it via aria-controls. */
		const PANEL_BODY_ID = SECTION_ID + "-panel-body";
		/**
		* Move selection and focus inside one tablist, per the APG tabs pattern.
		*
		* Automatic activation: the arrow key selects the tab and moves focus to it,
		* which is what the packaged SegmentedTabs does too. Only the keys the pattern
		* defines are consumed, so typing or scrolling inside the panel is untouched.
		*/
		function onTabKey(keys, value, select) {
			return (event) => {
				const next = tabStep(event.key, keys.indexOf(value), keys.length);
				if (next === null) return;
				const target = keys[next];
				if (target === void 0) return;
				event.preventDefault();
				select(target);
				event.currentTarget.parentElement?.querySelectorAll("[role=\"tab\"]")[next]?.focus();
			};
		}
		/**
		* The panel body, laid out like the reference skills-manager.
		*
		* Information density is the point: a titled header, a stat bar, full-width
		* tabs, labelled filter fields, then one card per source whose header carries
		* the **real absolute directory** — the thing users most often cannot find.
		*
		* All capability is preserved from the earlier layout: scope and status tabs
		* (including Disabled), grouping by source, cost sorting with the explanatory
		* footnote, per-rule and per-source switches, optimistic writes, and the three
		* disabled reasons. A disabled rule is never hidden, because a row that
		* vanished could never be switched back on.
		*/
		/**
		* The mark that heads a source card: the vendor's own artwork where one is
		* vendored (`brand-icons.ts`), and the label's initials where none exists.
		*
		* The initials are not a placeholder for a missing icon — several conventions
		* (`.agents`, Junie, Copilot) have no mark to draw, and inventing one would
		* claim an identity that does not exist.
		*/
		function SourceBadge({ group }) {
			const family = group.rules[0]?.family;
			const icon = family === void 0 ? void 0 : BRAND_ICONS[family];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dshrm-badge s-" + sourceKeyOf(group.key) + (icon === void 0 ? "" : " has-brand"),
				children: icon === void 0 ? group.label.slice(0, 2).toUpperCase() : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					className: "dshrm-brand",
					viewBox: icon.viewBox,
					role: "img",
					"aria-label": icon.title,
					dangerouslySetInnerHTML: { __html: icon.body }
				})
			});
		}
		/**
		* Whether the read about to start is the one the Refresh button asked for.
		*
		* A refresh is an ascending tick plus the tick the last read served; they are
		* equal whenever an ordinary read is due. Extracted because this single
		* comparison is what decides both "keep the rows on screen" and "?refresh=1",
		* and it used to be unreachable for a test while it lived inside the effect.
		*/
		function isForcedRead(tick, served) {
			return tick !== served;
		}
		/**
		* The receipt behind the cost line.
		*
		* The line states one number and the number is an aggregate: it does not say
		* which rule holds the tokens, or which of them are only paid for on demand.
		* A dialog rather than a hover card, because the figures have to stay on screen
		* while the reader compares them and a native title is neither selectable nor
		* reachable on a touch screen. It is a pure function of the rows, so the whole
		* table can be asserted without a DOM.
		*/
		function TokenBreakdown({ rules, diagnostics, t, onClose }) {
			const rows = [...rules].sort((a, b) => ruleCost(b).resident - ruleCost(a).resident || a.name.localeCompare(b.name));
			const report = costReport(rules);
			const resident = report.resident + report.catalog;
			const onDemand = report.onDemand;
			const cardRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const restore = typeof document === "undefined" ? null : document.activeElement;
				cardRef.current?.focus();
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("keydown", onKey);
					if (restore !== null && typeof restore.focus === "function") restore.focus();
				};
			}, [onClose]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshrm-modal",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": t("costDetails"),
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshrm-modal-card",
					ref: cardRef,
					tabIndex: -1,
					onClick: (event) => event.stopPropagation(),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshrm-modal-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: "dshrm-modal-title",
							children: t("costDetails")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshrm-btn",
							onClick: onClose,
							children: t("close")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshrm-modal-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dshrm-cost-table",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dshrm-cost-th",
										children: t("costRule")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dshrm-cost-th",
										children: t("costState")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dshrm-cost-th",
										children: t("costResident")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dshrm-cost-th",
										children: t("costOnDemand")
									})
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [
									rows.map((rule) => {
										const cost = ruleCost(rule);
										const state = rule.active ? t("type." + rule.type) : t("stat.disabled");
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: rule.name
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: state
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: cost.resident
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: cost.onDemand
											})
										] }, rule.scope + ":" + rule.path + ":" + rule.name);
									}),
									report.catalog > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										className: "dshrm-cost-fixed",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: t("costCatalog")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: t("costCatalogNote")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: report.catalog
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: "0"
											})
										]
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										className: "dshrm-cost-total",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: format(t("costTotal"), { n: rows.length })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { className: "dshrm-cost-td" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: resident
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dshrm-cost-td",
												children: onDemand
											})
										]
									})
								] })]
							}),
							report.truncated.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshrm-cost-note",
								children: format(t("costTruncated"), { n: report.truncated.length })
							}) : null,
							report.omitted.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshrm-cost-note",
								children: format(t("costOmitted"), { n: report.omitted.length })
							}) : null,
							diagnostics.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshrm-cost-note",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshrm-cost-note-p",
									children: format(t("costScanNote"), { n: diagnostics.length })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: "dshrm-diag-list",
									children: diagnostics.map((d, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScanDiagnosticRow, {
										row: d,
										t
									}, d.code + "-" + index))
								})]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshrm-cost-hint",
								children: t("costHint")
							})
						]
					})]
				})
			});
		}
		function RulesPanel({ ctx, t, rules, sources, workspace, scannedAt = 0, selectedWorkspace = null, onSelectWorkspace, state, onRetry, refreshing = false, onRefresh, onToggleRule, onToggleSource, pending, error, scanDiagnostics = [], truncated = false }) {
			const [query, setQuery] = (0, react.useState)("");
			const [scope, setScope] = (0, react.useState)("project");
			const [status, setStatus] = (0, react.useState)("all");
			const [sourceFilter, setSourceFilter] = (0, react.useState)("all");
			const [collapsed, setCollapsed] = (0, react.useState)([]);
			const [detailsOpen, setDetailsOpen] = (0, react.useState)(false);
			const [scanDiagOpen, setScanDiagOpen] = (0, react.useState)(false);
			if (state !== "ready") {
				const message = state === "failed" ? t("loadFailed") : t("loading");
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dshrm-panel",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshrm-empty dshrm-full",
						role: state === "failed" ? "alert" : "status",
						children: [message, state === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { marginTop: 10 },
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshrm-retry",
								onClick: onRetry,
								children: t("retry")
							})
						}) : null]
					})
				});
			}
			const inScope = scopeIn(filterRules(rules, query), scope);
			const counts = statusCounts(inScope);
			const enabled = inScope.filter((rule) => rule.active).length;
			const diagnostics = inScope.filter((rule) => rule.diagnostics.length > 0).length;
			const resident = totalResidentTokens(inScope);
			const byStatus = statusIn(inScope, status);
			const bySource = sourceFilter === "all" ? byStatus : sourceFilter === "diag" ? byStatus.filter((rule) => rule.diagnostics.length > 0) : byStatus.filter((rule) => ruleSourceId(rule) === sourceFilter);
			const diagOnly = sourceFilter === "diag";
			const scopedSources = filterByScope(sources, scope);
			const groups = groupBySource(sortByCost(bySource), scopedSources);
			const hasAnyRule = filterRules(rules, query).length > 0;
			const panelLabel = tabId("scope", scope) + " " + tabId("status", status);
			const toggleCollapse = (key) => setCollapsed((current) => current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
			const selectScope = (next) => {
				setScope(next);
				setSourceFilter("all");
			};
			const setDiagnosticsView = (on) => {
				setSourceFilter(on ? "diag" : "all");
			};
			const scopeTabs = [["user", t("scope.user")], ["project", t("scope.project")]];
			const statusTabs = [
				["all", format(t("tab.all"), { n: counts.always + counts.requested + counts.manual + counts.off })],
				["always", format(t("tab.always"), { n: counts.always })],
				["requested", format(t("tab.requested"), { n: counts.requested })],
				["manual", format(t("tab.manual"), { n: counts.manual })],
				["off", format(t("tab.off"), { n: counts.off })]
			];
			const sourceChoices = [...new Set(scopedSources.map(sourceId))];
			const workspaceOptions = (workspace.options ?? []).filter((option) => option !== workspace.path);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshrm-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dshrm-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
								className: "dshrm-title",
								children: t("title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshrm-sub",
								children: t("subtitle")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshrm-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshrm-btn",
									disabled: refreshing,
									onClick: onRefresh ?? onRetry,
									children: refreshing ? t("refreshing") : t("refresh")
								}), scannedAt > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-cost-l",
									title: new Date(scannedAt).toLocaleString(),
									children: format(t("scannedAt"), { time: new Date(scannedAt).toLocaleTimeString() })
								}) : null]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshrm-stats",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshrm-stat",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-stat-n",
									children: inScope.length
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-stat-l",
									children: t("stat.total")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshrm-stat on",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-stat-n",
									children: enabled
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-stat-l",
									children: t("stat.enabled")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshrm-stat off",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-stat-n",
									children: inScope.length - enabled
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-stat-l",
									children: t("stat.disabled")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: diagnostics > 0 ? "dshrm-stat warn" : "dshrm-stat",
								children: diagnostics > 0 || diagOnly ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dshrm-stat-btn" + (diagOnly ? " on" : ""),
									"aria-pressed": diagOnly,
									title: t("statDiagnosticsHint"),
									onClick: () => setDiagnosticsView(!diagOnly),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshrm-stat-n",
										children: diagnostics
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshrm-stat-l",
										children: t("stat.diagnostics")
									})]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-stat-n",
									children: diagnostics
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-stat-l",
									children: t("stat.diagnostics")
								})] })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dshrm-cost",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshrm-cost-n",
								children: format(t("costValue"), { n: resident })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshrm-cost-l",
								children: t("costLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshrm-link",
								onClick: () => setDetailsOpen(true),
								children: t("costDetails")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshrm-note",
						children: t("tokenNote")
					}),
					error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshrm-error",
						role: "alert",
						children: format(t("writeFailed"), { message: error })
					}) : null,
					detailsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TokenBreakdown, {
						rules: inScope,
						diagnostics: scanDiagnostics,
						t,
						onClose: () => setDetailsOpen(false)
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshrm-tabgroup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshrm-field-l",
							"aria-hidden": "true",
							children: t("tablist.scope")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshrm-tabs dshrm-tabs-seg",
							role: "tablist",
							"aria-label": t("tablist.scope"),
							children: scopeTabs.map(([key, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								id: tabId("scope", key),
								type: "button",
								role: "tab",
								"aria-selected": scope === key,
								"aria-controls": PANEL_BODY_ID,
								tabIndex: scope === key ? 0 : -1,
								className: "dshrm-tab" + (scope === key ? " on" : ""),
								onClick: () => selectScope(key),
								onKeyDown: onTabKey(scopeTabs.map(([tabKey]) => tabKey), scope, selectScope),
								children: label
							}, key))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshrm-tabgroup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshrm-field-l",
							"aria-hidden": "true",
							children: t("tablist.status")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshrm-tabs",
							role: "tablist",
							"aria-label": t("tablist.status"),
							children: statusTabs.map(([key, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								id: tabId("status", key),
								type: "button",
								role: "tab",
								"aria-selected": status === key,
								"aria-controls": PANEL_BODY_ID,
								tabIndex: status === key ? 0 : -1,
								className: "dshrm-tab" + (status === key ? " on" : ""),
								onClick: () => setStatus(key),
								onKeyDown: onTabKey(statusTabs.map(([tabKey]) => tabKey), status, setStatus),
								children: label
							}, key))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshrm-filters",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dshrm-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-field-l",
									children: t("filter.source")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "dshrm-select",
									value: sourceFilter,
									onChange: (event) => setSourceFilter(event.currentTarget.value),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "all",
											children: format(t("filter.allSources"), { n: inScope.length })
										}),
										diagnostics > 0 || diagOnly ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "diag",
											children: format(t("filter.diagnostics"), { n: diagnostics })
										}) : null,
										sourceChoices.map((choice) => {
											const label = scopedSources.find((entry) => sourceId(entry) === choice)?.label ?? choice;
											const n = inScope.filter((rule) => ruleSourceId(rule) === choice).length;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: choice,
												children: label + " (" + n + ")"
											}, choice);
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dshrm-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-field-l",
									children: t("filter.search")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dshrm-search",
									value: query,
									placeholder: t("search"),
									onChange: (event) => setQuery(event.currentTarget.value)
								})]
							}),
							onSelectWorkspace !== void 0 && workspaceOptions.length > 0 && scope !== "user" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dshrm-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-field-l",
									children: t("filter.workspace")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "dshrm-select",
									value: workspace.path ?? "",
									title: t("selectWorkspace"),
									onChange: (event) => onSelectWorkspace(event.currentTarget.value),
									children: [workspace.path !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: workspace.path,
										children: workspace.path
									}) : null, workspaceOptions.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: option,
										children: option
									}, option))]
								})]
							}) : null
						]
					}),
					truncated || scanDiagnostics.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dshrm-note dshrm-scan-note",
						role: "status",
						children: [truncated ? t("scanTruncated") + " " : "", scanDiagnostics.length > 0 ? format(t("scanDiagnostics"), { n: scanDiagnostics.length }) : ""]
					}) : null,
					scanDiagnostics.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "dshrm-diag dshrm-scan-diag",
						open: scanDiagOpen,
						onToggle: (event) => setScanDiagOpen(event.currentTarget.open),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: format(t("rowDiagnostics"), { n: scanDiagnostics.length }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "dshrm-diag-list",
							children: scanDiagnostics.map((d, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScanDiagnosticRow, {
								row: d,
								t
							}, d.code + "-" + index))
						})]
					}) : null,
					!hasAnyRule ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dshrm-empty dshrm-full",
						role: "tabpanel",
						id: PANEL_BODY_ID,
						"aria-labelledby": panelLabel,
						children: [workspace.source === "none" ? t("noWorkspace") : t("empty"), workspace.path !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshrm-group-path",
							children: workspace.path
						}) : null]
					}) : inScope.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshrm-empty dshrm-full",
						role: "tabpanel",
						id: PANEL_BODY_ID,
						"aria-labelledby": panelLabel,
						children: t("tierEmpty")
					}) : bySource.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshrm-empty dshrm-full",
						role: "tabpanel",
						id: PANEL_BODY_ID,
						"aria-labelledby": panelLabel,
						children: t("noMatch")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshrm-groups",
						role: "tabpanel",
						id: PANEL_BODY_ID,
						"aria-labelledby": panelLabel,
						children: groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dshrm-group",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
									className: "dshrm-group-head",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dshrm-fold",
										"aria-expanded": !collapsed.includes(group.key),
										onClick: () => toggleCollapse(group.key),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshrm-caret",
												children: collapsed.includes(group.key) ? "▶" : "▼"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceBadge, { group }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshrm-group-label",
												children: group.label
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshrm-scope-tag",
												children: t("scope." + group.scope)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshrm-group-count",
												children: format(t("groupCount"), { total: group.rules.length })
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "dshrm-switch",
										title: t("toggleSource"),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											role: "switch",
											"aria-checked": group.enabled,
											"aria-label": format(t("switchSource"), { name: group.label }),
											checked: group.enabled,
											disabled: pending.includes(group.key),
											onChange: (event) => onToggleSource(group, event.currentTarget.checked)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshrm-track" })]
									})]
								}),
								group.path !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshrm-group-path",
									title: group.path,
									children: group.path
								}) : null,
								collapsed.includes(group.key) ? null : group.rules.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshrm-empty dshrm-full",
									children: t("groupEmpty")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: "dshrm-list",
									children: group.rules.map((rule) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RuleItem, {
										rule,
										t,
										busy: pending.includes(rule.path),
										onToggle: onToggleRule
									}, rule.path))
								})
							]
						}, group.key))
					})
				]
			});
		}
		/**
		* The plain-language meaning of one diagnostic code, or null when the table has
		* none.
		*
		* The table is keyed by the codes the scanner actually emits, so this reads
		* through `t` and treats "the key came back unchanged" as "no explanation for
		* this code" — a code added on the host side degrades to the bare diagnostic
		* instead of printing a locale key at the user.
		*/
		function diagHelp(t, code) {
			const key = "diag." + code;
			const text = t(key);
			return text === key ? null : text;
		}
		/**
		* One scan-level finding: what the scanner said, where it said it, and what the
		* code means.
		*
		* These used to be flattened into a single sentence of explanations joined by
		* semicolons, which lost the one thing the scanner had already worked out — the
		* field, the line, the file. "the field was declared but has no entries" is
		* meaningless without the field's name.
		*
		* The path is printed only when the detail does not already carry it: the codes
		* raised per file end their detail with the path, and printing it twice would
		* read as two findings.
		*/
		function ScanDiagnosticRow({ row, t }) {
			const help = diagHelp(t, row.code);
			const path = row.path !== void 0 && !row.detail.includes(row.path) ? row.path : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshrm-diag-code",
					children: row.code
				}),
				row.line === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshrm-diag-line",
					children: format(t("diagLine"), { line: row.line })
				}),
				": " + row.detail,
				path === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshrm-diag-path",
					children: format(t("diagPath"), { path })
				}),
				help === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dshrm-diag-help",
					children: help
				})
			] });
		}
		/** One rule row: name, badges, two-line description, reason, and its switch. */
		function RuleItem({ rule, t, busy, onToggle, openDiagnostics, onToggleDiagnostics }) {
			const bucket = statusOf(rule);
			const cost = ruleCost(rule);
			const reason = disabledReasonKey(rule);
			const note = t(noteKeyOf(rule));
			const [ownOpen, setOwnOpen] = (0, react.useState)(false);
			const open = openDiagnostics ?? ownOpen;
			const setOpen = openDiagnostics === void 0 ? setOwnOpen : onToggleDiagnostics ?? (() => {});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "dshrm-row dshrm-" + bucket,
				"data-rule": rule.path,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshrm-row-main",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshrm-row-top",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-name",
									title: rule.path,
									children: rule.name
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-type" + (rule.attached === true ? " is-attached" : ""),
									title: rule.attached === true ? t("note.attached") : void 0,
									children: t("type." + rule.type)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshrm-tokens",
									children: format(t("tokens"), { n: cost.resident })
								})
							]
						}),
						rule.description !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshrm-desc",
							children: rule.description
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshrm-row-note",
							children: reason === null ? note : format(t("offWith"), { reason: t(reason) })
						}),
						rule.diagnostics.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: "dshrm-diag",
							open,
							onToggle: (event) => setOpen(event.currentTarget.open),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: format(t("rowDiagnostics"), { n: rule.diagnostics.length }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dshrm-diag-list",
								children: rule.diagnostics.map((d, index) => {
									const help = diagHelp(t, d.code);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dshrm-diag-code",
											children: d.code
										}),
										d.line === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dshrm-diag-line",
											children: format(t("diagLine"), { line: d.line })
										}),
										": " + d.detail,
										help === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dshrm-diag-help",
											children: help
										})
									] }, d.code + "-" + index);
								})
							})]
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dshrm-switch",
					title: t("toggleRule"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						role: "switch",
						"aria-checked": rule.active,
						"aria-label": format(t("switchRule"), {
							name: rule.name,
							scope: t("scope." + rule.scope)
						}),
						checked: rule.active,
						disabled: busy || rule.disabledBy === "frontmatter" || rule.disabledBy === "source",
						onChange: (event) => onToggle(rule, event.currentTarget.checked)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshrm-track" })]
				})]
			});
		}
		/**
		* Carry the workspace the panel is looking at on the route itself.
		*
		* `route` already owns its query string (`RULES_ROUTE` has none today, but a
		* caller may pass one), so the parameter is appended with `&` when needed
		* rather than blindly with `?`.
		*/
		function withWorkspace(route, workspace) {
			if (workspace === null || workspace === "") return route;
			return route + (route.includes("?") ? "&" : "?") + "workspace=" + encodeURIComponent(workspace);
		}
		/**
		* Ask the host to ignore its caches for one read.
		*
		* A repeated read is deliberately cheap — the host answers it from a 30-second
		* slot — which makes the Refresh button look broken: the timestamp it prints
		* does not move. The parameter is what makes the button mean what it says.
		*/
		function withRefresh(route) {
			return route + (route.includes("?") ? "&" : "?") + "refresh=1";
		}
		/**
		* Read the host's catalog. Throws on a failed request or a malformed body.
		*
		* Only `rules` is required: `sources`/`scannedAt` arrived later, and a host
		* built before them must still render its list rather than fail outright.
		*/
		async function fetchRules(route = RULES_ROUTE, doFetch = globalThis.fetch, workspacePath = null, refresh = false) {
			if (typeof doFetch !== "function") throw new Error("no fetch in this environment");
			const target = withWorkspace(route, workspacePath);
			const response = await doFetch(resolveUrl(refresh ? withRefresh(target) : target), { headers: { accept: "application/json" } });
			if (!response.ok) throw new Error(`rules request failed: ${response.status}`);
			const body = await response.json();
			if (typeof body !== "object" || body === null || !Array.isArray(body.rules)) throw new Error("rules response is not a list");
			const payload = body;
			return {
				rules: payload.rules ?? [],
				sources: Array.isArray(payload.sources) ? payload.sources : [],
				scannedAt: typeof payload.scannedAt === "number" ? payload.scannedAt : 0,
				diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
				truncated: payload.truncated === true,
				workspace: payload.workspace ?? {
					path: null,
					source: "none"
				}
			};
		}
		/** Send one write to the host and return the refreshed document. */
		async function postAction(action, route = RULES_ROUTE, doFetch = globalThis.fetch, workspacePath = null) {
			if (typeof doFetch !== "function") throw new Error("no fetch in this environment");
			const response = await doFetch(resolveUrl(withWorkspace(route, workspacePath)), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(action)
			});
			if (!response.ok) throw new Error(`rules update failed: ${response.status}`);
			const body = await response.json();
			if (typeof body !== "object" || body === null || !Array.isArray(body.rules)) throw new Error("rules response is not a list");
			const payload = body;
			return {
				rules: payload.rules ?? [],
				sources: Array.isArray(payload.sources) ? payload.sources : [],
				scannedAt: typeof payload.scannedAt === "number" ? payload.scannedAt : 0,
				diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
				truncated: payload.truncated === true,
				workspace: payload.workspace ?? {
					path: null,
					source: "none"
				}
			};
		}
		/**
		* Panel state: the catalog, how the read went, and the two write actions.
		*
		* A write is **optimistic then reconciled**: the row flips immediately so the
		* checkbox does not lag, the host's response replaces the payload, and a
		* failure rolls the flip back and surfaces the error. Nothing is left showing a
		* state the host did not confirm.
		*/
		function useRules(route = RULES_ROUTE) {
			const [payload, setPayload] = (0, react.useState)({
				rules: [],
				sources: [],
				scannedAt: 0,
				diagnostics: [],
				truncated: false,
				workspace: {
					path: null,
					source: "none"
				}
			});
			const [workspacePath, setWorkspacePath] = (0, react.useState)(null);
			const [state, setState] = (0, react.useState)("loading");
			const [nonce, setNonce] = (0, react.useState)(0);
			const [pending, setPending] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)(null);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [refreshTick, setRefreshTick] = (0, react.useState)(0);
			const servedRefresh = (0, react.useRef)(0);
			const EMPTY = {
				rules: [],
				sources: [],
				scannedAt: 0,
				diagnostics: [],
				truncated: false,
				workspace: {
					path: null,
					source: "none"
				}
			};
			(0, react.useEffect)(() => {
				let cancelled = false;
				const tick = refreshTick;
				const forced = isForcedRead(tick, servedRefresh.current);
				if (!forced) setState("loading");
				setRefreshing(forced);
				fetchRules(route, void 0, workspacePath, forced).then((next) => {
					if (!cancelled) {
						setPayload(next);
						setState("ready");
					}
				}).catch(() => {
					if (!cancelled) {
						setPayload(EMPTY);
						setState("failed");
					}
				}).finally(() => {
					if (cancelled) return;
					servedRefresh.current = tick;
					setRefreshing(false);
				});
				return () => {
					cancelled = true;
				};
			}, [
				route,
				nonce,
				workspacePath,
				refreshTick
			]);
			const retry = (0, react.useCallback)(() => setNonce((n) => n + 1), []);
			/**
			* The Refresh button: read again, past the host's caches.
			*
			* The tick only moves here; the effect decides whether the read it starts is
			* a forced one, and retires the tick from the read's own finally.
			*/
			const refresh = (0, react.useCallback)(() => {
				setRefreshTick((n) => n + 1);
			}, []);
			const payloadRef = (0, react.useRef)(payload);
			payloadRef.current = payload;
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			/** Send one action, then reconcile or roll back. */
			const send = (0, react.useCallback)(async (action, toggling) => {
				const before = payloadRef.current;
				setPending((current) => [...current, toggling]);
				setError(null);
				setPayload(optimistic(before, action));
				try {
					const next = await postAction(action, route, void 0, workspacePath);
					if (!alive.current) return;
					setPayload(next);
				} catch (cause) {
					if (!alive.current) return;
					setPayload(before);
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (alive.current) setPending((current) => current.filter((key) => key !== toggling));
				}
			}, [route, workspacePath]);
			const toggleRule = (0, react.useCallback)((rule, enabled) => {
				send({
					action: "setRule",
					key: rule.sourceKey,
					path: rule.path,
					enabled,
					scope: rule.scope
				}, rule.path);
			}, [send]);
			const toggleSource = (0, react.useCallback)((group, enabled) => {
				send({
					action: "setSource",
					key: sourceKeyOf(group.key),
					enabled,
					scope: group.scope
				}, group.key);
			}, [send]);
			const selectWorkspace = (0, react.useCallback)((path) => {
				setWorkspacePath(path);
			}, []);
			return {
				rules: payload.rules,
				sources: payload.sources,
				scannedAt: payload.scannedAt,
				scanDiagnostics: payload.diagnostics ?? [],
				truncated: payload.truncated === true,
				workspace: payload.workspace,
				state,
				retry,
				refresh,
				refreshing,
				setPayload,
				pending,
				error,
				toggleRule,
				toggleSource,
				selectedWorkspace: workspacePath,
				selectWorkspace
			};
		}
		function ListIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 24 24",
				width: size ?? 16,
				height: size ?? 16,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.8,
				strokeLinecap: "round",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 6h16M4 12h16M4 18h10" })
			});
		}
		/**
		* Register every entry point.
		*
		* Returns a disposer that removes all of them. Each \`inject\` callback hands
		* back the disposal function it received from \`register\`, so unloading the
		* plugin leaves no stale slot.
		*/
		function register(ctx, t) {
			installPanelStyles();
			const disposers = [];
			const kept = /* @__PURE__ */ new Set();
			const panel = () => {
				const { rules, sources, workspace, scannedAt, state, retry, refresh, refreshing, pending, error, toggleRule, toggleSource, selectedWorkspace, selectWorkspace, scanDiagnostics, truncated } = useRules();
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RulesPanel, {
					ctx,
					t,
					rules,
					sources,
					workspace,
					scannedAt,
					selectedWorkspace,
					onSelectWorkspace: selectWorkspace,
					state,
					onRetry: retry,
					refreshing,
					onRefresh: refresh,
					scanDiagnostics,
					truncated,
					onToggleRule: toggleRule,
					onToggleSource: toggleSource,
					pending,
					error
				});
			};
			const keep = (slot, result) => {
				if (kept.has(slot)) return;
				kept.add(slot);
				if (typeof result === "function") disposers.push(result);
			};
			ctx.slots.inject("settings.section", () => keep("settings.section", ctx.slots.register({
				name: "settings.section",
				id: SECTION_ID,
				order: 30,
				label: () => t("title"),
				locale: NS
			}, panel)));
			ctx.slots.inject("settings.section.icon", () => keep("settings.section.icon", ctx.slots.register({
				name: "settings.section.icon",
				id: SECTION_ID,
				locale: NS
			}, ListIcon)));
			ctx.slots.inject("sidebar.panellist", () => keep("sidebar.panellist", ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 3,
				label: () => t("panel"),
				locale: NS
			}, ListIcon)));
			ctx.slots.inject("main", () => keep("main", ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS
			}, panel)));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}
		/** Panel strings; the locale files carry only the plugin's catalog metadata. */
		const TEXT = {
			en: {
				title: "Rules",
				panel: "Rules",
				search: "Search rules by name or description",
				tokens: "≈{n} tokens",
				empty: "No rules found for this workspace.",
				subtitle: "Rules from 22 conventions on disk (CodeBuddy, Cursor, Claude Code, Trae, Qoder and more) — always-on, on demand, or disabled. Read-only: this panel only writes its own settings.",
				"stat.total": "rules",
				"stat.enabled": "active",
				"stat.disabled": "disabled",
				"stat.diagnostics": "diagnostics",
				"costValue": "≈{n}",
				"costLabel": "tokens resident in every request",
				"costDetails": "Details",
				"close": "Close",
				"costRule": "Rule",
				"costState": "Loading",
				"costResident": "Resident",
				"costOnDemand": "On demand",
				"costTotal": "{n} rules",
				"costCatalog": "On-demand index overhead",
				"costCatalogNote": "The tags and instructions that wrap the on-demand lines — not a rule; resident whenever any rule is on demand",
				"costTruncated": "{n} rule(s) clipped by the 8000-character cap",
				"costOmitted": "{n} rule(s) dropped by a tier budget (6000 user / 12000 project)",
				"costScanNote": "The scan also reported {n} problem(s), itemised below:",
				"costHint": "Always-on rules put their body in the prompt on every request; their description is not injected. On-demand rules keep one index line - path and description - in the prompt, and the body is passed in only when the model actually reads the rule. Manual rules are never injected by any path at all. The row above the total is the wrapper that text sits in, which is why it belongs to no single rule.",
				"scanTruncated": "The scan stopped at one of its caps, so rules may be missing from this list.",
				"scanDiagnostics": "{n} scan problem(s), which belong to no single rule:",
				"tierEmpty": "No rule of this catalog is in this scope.",
				"switchSource": "Turn {name} rules on or off (writes state.json only)",
				"switchRule": "Turn {name} on or off in {scope} (writes state.json only)",
				"filter.source": "Source",
				"filter.allSources": "All sources ({n})",
				"filter.diagnostics": "Rules with diagnostics ({n})",
				"filter.workspace": "Workspace",
				"selectWorkspace": "Workspace shown by this panel",
				"statDiagnosticsHint": "Show only the rules with diagnostics",
				"diagLine": "line {line}",
				"diagPath": "in {path}",
				"diag.fm.malformed": "not a key: value line, so it was ignored",
				"diag.fm.emptyList": "the field was declared but has no entries",
				"diag.list.empty": "declared as an empty list, so the rule matches no file",
				"diag.trigger.missing": "this convention requires a trigger field",
				"diag.trigger.unknown": "unrecognised trigger, handled by the fallback rule",
				"diag.type.unknown": "unrecognised type, handled by the fallback rule",
				"diag.type.tierOverridden": "this convention keeps user-level rules always on, so the file state is ignored",
				"diag.requested.noDescription": "an on-demand rule is only discoverable through its description",
				"diag.scan.truncated": "the depth or entry limit was reached; some rules may be missing",
				"diag.scan.unreadable": "the directory could not be read, so it was skipped",
				"diag.read.failed": "the file could not be read, so it was skipped",
				"diag.classify.skipped": "not recognised as a rule file, so it was skipped",
				"diag.attach.limit": "more file-scoped rules declared patterns than can be compiled at once; the rest stay on demand",
				"diag.attach.pattern": "this pattern was skipped as too risky to match against",
				"diag.attach.slow": "the pattern exceeded the match time budget, so the rule stays on demand",
				"filter.search": "Search",
				"groupEmpty": "This source directory exists, but has no rules yet.",
				noWorkspace: "No workspace could be determined yet, so there is nothing to scan. Open a folder, or send one message, then reload.",
				loading: "Loading rules…",
				loadFailed: "Could not load rules from the host.",
				retry: "Retry",
				refresh: "Refresh",
				refreshing: "Refreshing…",
				"scannedAt": "Scanned {time}",
				"rowDiagnostics": "{n} diagnostics",
				"type.always": "always",
				"type.requested": "on demand",
				"type.manual": "not injected",
				"scope.user": "Global",
				"scope.project": "Project",
				"tablist.scope": "Scope",
				"tablist.status": "Status",
				"tab.all": "All ({n})",
				"tab.always": "Always ({n})",
				"tab.requested": "On demand ({n})",
				"tab.manual": "Not injected ({n})",
				"tab.off": "Disabled ({n})",
				"groupCount": "{total} rules",
				"toggleSource": "Turn this source on or off (writes state.json only)",
				"toggleRule": "Turn this rule on or off (writes state.json only)",
				"tokenNote": "Always-on rules keep their whole text in the prompt; on-demand rules keep only their description line, and the body loads when the model asks; manual rules are never injected at all.",
				"noMatch": "No rule matches the current filters.",
				"writeFailed": "Could not save: {message}",
				"offWith": "Disabled — {reason}",
				"offReason.frontmatter": "in the file (enabled: false)",
				"offReason.state": "turned off here",
				"offReason.source": "its source is off",
				"note.always": "Full text resident",
				"note.requested": "Description resident; body loads on demand",
				"note.manual": "Never injected",
				"note.off": "Disabled",
				"note.attached": "Body resident - this session touched a matching file"
			},
			zh: {
				title: "规则",
				panel: "规则",
				search: "按名称或描述搜索规则",
				tokens: "≈{n} token",
				empty: "当前工作区没有规则。",
				subtitle: "汇集磁盘上 22 种约定的规则（CodeBuddy、Cursor、Claude Code、Trae、Qoder 等），支持全文常驻 / 按需加载 / 停用。只读：本面板只写自己的设置。",
				"stat.total": "条规则",
				"stat.enabled": "生效中",
				"stat.disabled": "已停用",
				"stat.diagnostics": "诊断提示",
				"costValue": "≈{n}",
				"costLabel": "每次请求常驻的 token 约数",
				"costDetails": "详情",
				"close": "关闭",
				"costRule": "规则",
				"costState": "加载方式",
				"costResident": "常驻",
				"costOnDemand": "按需",
				"costTotal": "共 {n} 条",
				"costCatalog": "按需清单的固定开销",
				"costCatalogNote": "包裹按需索引行的标签与说明文字，不属于任何规则；只要存在按需规则就会常驻",
				"costTruncated": "有 {n} 条正文超过 8000 字符上限，已截断后计费",
				"costOmitted": "有 {n} 条因档位预算（全局 6000 / 项目 12000 字符）被整条丢弃",
				"costScanNote": "扫描另有 {n} 条问题，明细如下：",
				"costHint": "全文常驻类：每次请求都把正文放进提示词，描述不注入。按需加载类：只有一行索引（路径 + 描述）常驻，正文在模型真正读取这条规则时才传入。不注入类：任何路径都不会把它放进提示词。合计上方那一行就是包住这些索引行的固定文字，所以它不属于任何单条规则。",
				"scanTruncated": "扫描已达上限而中止，列表里可能缺规则。",
				"scanDiagnostics": "扫描发现 {n} 个问题，它们不属于任何单条规则：",
				"tierEmpty": "本档位没有规则。",
				"switchSource": "开关 {name} 来源的规则（只写 state.json）",
				"switchRule": "开关 {name}（{scope}，只写 state.json）",
				"filter.source": "来源",
				"filter.allSources": "全部来源（{n}）",
				"filter.diagnostics": "有诊断的规则（{n}）",
				"filter.workspace": "工作区",
				"selectWorkspace": "本面板展示的工作区",
				"statDiagnosticsHint": "只看有诊断的规则",
				"diagLine": "第 {line} 行",
				"diagPath": "位于 {path}",
				"diag.fm.malformed": "不是 key: value 形式，已忽略该行",
				"diag.fm.emptyList": "字段已声明但没有填任何值",
				"diag.list.empty": "声明为空列表，任何文件都匹配不到",
				"diag.trigger.missing": "该约定要求提供 trigger 字段",
				"diag.trigger.unknown": "trigger 取值不认识，已按推导规则处理",
				"diag.type.unknown": "type 取值不认识，已按推导规则处理",
				"diag.type.tierOverridden": "该约定的用户级规则一律常驻，文件里写的状态会被忽略",
				"diag.requested.noDescription": "按需加载类只靠描述被发现，缺描述等于找不到",
				"diag.scan.truncated": "已达深度或条目上限，可能有规则没扫到",
				"diag.scan.unreadable": "该目录读不了，已跳过",
				"diag.read.failed": "该文件读不了，已跳过",
				"diag.classify.skipped": "不是可识别的规则文件，已跳过",
				"diag.attach.limit": "声明匹配式的按需规则超出一次可编译的上限，其余仍按需加载",
				"diag.attach.pattern": "该匹配式回溯风险过高，已跳过",
				"diag.attach.slow": "匹配式超出耗时预算，该规则仍按需加载",
				"filter.search": "搜索",
				"groupEmpty": "该来源目录存在，但里面还没有规则。",
				noWorkspace: "尚未能确定工作区，因此无处可扫。请先打开一个目录，或发一条消息，然后重新加载。",
				loading: "正在加载规则…",
				loadFailed: "无法从宿主加载规则。",
				retry: "重试",
				refresh: "刷新",
				refreshing: "刷新中…",
				"scannedAt": "扫描于 {time}",
				"rowDiagnostics": "{n} 条诊断",
				"type.always": "全文常驻",
				"type.requested": "按需加载",
				"type.manual": "不注入",
				"scope.user": "全局",
				"scope.project": "项目",
				"tablist.scope": "范围",
				"tablist.status": "状态",
				"tab.all": "全部（{n}）",
				"tab.always": "全文常驻（{n}）",
				"tab.requested": "按需加载（{n}）",
				"tab.manual": "不注入（{n}）",
				"tab.off": "已停用（{n}）",
				"groupCount": "{total} 条",
				"toggleSource": "开关该来源（只写 state.json）",
				"toggleRule": "开关该规则（只写 state.json）",
				"tokenNote": "全文常驻类的规则正文整体进入提示词；按需加载类只有描述一行常驻，正文在模型调用时才加载；不注入类从不进入提示词。",
				"noMatch": "当前筛选条件下没有匹配的规则。",
				"writeFailed": "保存失败：{message}",
				"offWith": "已停用 —— {reason}",
				"offReason.frontmatter": "文件里写了 enabled: false",
				"offReason.state": "在此处关闭",
				"offReason.source": "其来源已关闭",
				"note.always": "全文常驻",
				"note.requested": "仅描述常驻，正文按需加载",
				"note.manual": "从不注入",
				"note.off": "已停用",
				"note.attached": "正文常驻 - 本会话已触碰匹配的文件"
			}
		};
		/**
		* The plugin object the loader mounts.
		*
		* \`inject\` names only the hard dependency. A locale service, when present,
		* supplies the panel catalog; otherwise the bundled {@link TEXT} is used.
		*/
		const inject = ["slots"];
		function apply(ctx) {
			const locale = localeOf(ctx);
			if (typeof locale?.register === "function" && typeof ctx.effect === "function") ctx.effect(() => locale.register?.(NS, {
				en: TEXT.en,
				zh: TEXT.zh
			}), "rules-manager: locale dictionaries");
			return register(ctx, (key) => resolveText(ctx, key));
		}
		/** The locale service when one is loaded, else undefined. */
		function localeOf(ctx) {
			const locale = ctx.get?.("locale");
			return locale !== void 0 && locale !== null && typeof locale === "object" ? locale : void 0;
		}
		/**
		* Panel text.
		*
		* Preferred path: the text goes through the host's own translator, so it follows
		* the active locale exactly as every other plugin's copy does. The dictionary is
		* registered into {@link NS} by {@link apply}; `bind` returns a function that
		* reads the active locale at call time, so no snapshot needs to be watched here.
		*
		* Fallback path (no locale service, or an unexpected shape): the bundled table,
		* keyed by `LocaleSnapshot.active`. The service is optional, so a missing or
		* partially-shaped one must degrade to English rather than throw.
		*/
		function resolveText(ctx, key) {
			const locale = localeOf(ctx);
			if (typeof locale?.bind === "function") try {
				const bound = locale.bind(NS)(key);
				if (typeof bound === "string" && bound !== "" && bound !== key) return bound;
			} catch {}
			const active = locale?.getSnapshot?.()?.active;
			const lang = typeof active === "string" && active.toLowerCase().startsWith("zh") ? "zh" : "en";
			return TEXT[lang][key] ?? TEXT.en[key] ?? key;
		}
		exports.RULES_ROUTE = RULES_ROUTE;
		exports.RuleItem = RuleItem;
		exports.RulesPanel = RulesPanel;
		exports.ScanDiagnosticRow = ScanDiagnosticRow;
		exports.TEXT = TEXT;
		exports.TokenBreakdown = TokenBreakdown;
		exports.apply = apply;
		exports.fetchRules = fetchRules;
		exports.filterRules = filterRules;
		exports.groupBySource = groupBySource;
		exports.inject = inject;
		exports.isForcedRead = isForcedRead;
		exports.optimistic = optimistic;
		exports.postAction = postAction;
		exports.register = register;
		exports.residentTokens = residentTokens;
		exports.resolveText = resolveText;
		exports.scopeIn = scopeIn;
		exports.sortByCost = sortByCost;
		exports.statusCounts = statusCounts;
		exports.statusOf = statusOf;
		exports.totalResidentTokens = totalResidentTokens;
		exports.useRules = useRules;
		exports.withRefresh = withRefresh;
		exports.withWorkspace = withWorkspace;
		return module.exports;
	}
});
