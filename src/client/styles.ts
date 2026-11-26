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

const STYLE_ID = 'dsh-rules-manager-style'

export const PANEL_CSS = `
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
`

/**
 * Install the stylesheet once per document.
 *
 * Idempotent by id, so a reload or a second `register` call does not append a
 * duplicate `<style>`. Harmless when no document exists (a server render).
 */
export function installPanelStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = PANEL_CSS
  ;(document.head ?? document.documentElement).appendChild(style)
}
