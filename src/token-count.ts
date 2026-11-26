/**
 * Token estimation for cost display.
 *
 * Calibrated to CJK scripts, where one character is roughly one token, and to
 * word chunks elsewhere. Ported from the reference implementation in
 * @michengai/dsh-skills-manager (lib/token-count.js), whose UI this mirrors.
 */

/** CJK ranges that count as one token per character. */
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) ||   // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303f) ||   // CJK radicals, punctuation (、。「」)
    (cp >= 0x3040 && cp <= 0x30ff) ||   // Hiragana, Katakana
    (cp >= 0x3130 && cp <= 0x318f) ||   // Hangul compatibility Jamo
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK Unified Ideographs
    (cp >= 0xa960 && cp <= 0xa97f) ||   // Hangul Jamo Ext A
    (cp >= 0xac00 && cp <= 0xd7af) ||   // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK compatibility ideographs
    (cp >= 0xff00 && cp <= 0xff9f)      // Fullwidth forms
  )
}

const WORD = /[A-Za-z0-9_]/
const SPACE = /\s/

export function estimateTokens(text: string): number {
  if (text === '') return 0
  let total = 0
  let word = 0
  let punct = 0
  const flushWord = (): void => { if (word > 0) { total += Math.ceil(word / 5); word = 0 } }
  const flushPunct = (): void => { if (punct > 0) { total += Math.ceil(punct / 2); punct = 0 } }

  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp > 0xffff || isCjk(cp)) { flushWord(); flushPunct(); total += 1; continue }
    if (SPACE.test(ch)) { flushWord(); flushPunct(); continue }
    if (WORD.test(ch)) { flushPunct(); word += 1; continue }
    flushWord(); punct += 1
  }
  flushWord(); flushPunct()
  return total
}

/** Truncate a description for catalog display, matching the host's 500-char cap. */
export const CATALOG_DESCRIPTION_MAX_LENGTH = 500

export function truncateForCatalog(description: string, max = CATALOG_DESCRIPTION_MAX_LENGTH): string {
  const normalized = description.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 3))}...`
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
export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
