import { describe, expect, it } from 'vitest'
import { estimateTokens, truncateForCatalog, CATALOG_DESCRIPTION_MAX_LENGTH } from '../src/token-count.ts'

describe('estimateTokens', () => {
  it('counts CJK as one token per character', () => {
    expect(estimateTokens('测试')).toBe(2)
    expect(estimateTokens('规则管理')).toBe(4)
  })

  it('counts Latin word characters cumulatively as one token per five', () => {
    expect(estimateTokens('hello')).toBe(1)          // 5 -> ceil(5/5) = 1
    expect(estimateTokens('helloworld')).toBe(2)     // 10 -> 2
    // Runs of word characters accumulate across a space, because whitespace
    // only flushes the current run; 10 letters total -> 2.
    expect(estimateTokens('hello world')).toBe(2)
  })

  it('counts punctuation as one token per two marks', () => {
    // Two ASCII punctuation marks land in one bucket -> ceil(2/2) = 1.
    expect(estimateTokens('.,')).toBe(1)
    expect(estimateTokens('.,;')).toBe(2)
  })

  it('returns zero for empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('counts astral characters (emoji) as one token', () => {
    // A surrogate pair is one code point above 0xFFFF, so one token.
    expect(estimateTokens('\u{1F600}')).toBe(1)
  })

  it('mixes scripts without double counting', () => {
    // 2 CJK + "abc" (3 letters -> 1) = 3
    expect(estimateTokens('测试abc')).toBe(3)
  })
})

describe('truncateForCatalog', () => {
  it('leaves a short description untouched', () => {
    expect(truncateForCatalog('short')).toBe('short')
  })

  it('collapses whitespace before measuring', () => {
    expect(truncateForCatalog('a   b\n\nc')).toBe('a b c')
  })

  it('truncates past the cap with an ellipsis', () => {
    const long = 'x'.repeat(CATALOG_DESCRIPTION_MAX_LENGTH + 50)
    const out = truncateForCatalog(long)
    expect(out.length).toBe(CATALOG_DESCRIPTION_MAX_LENGTH)
    expect(out.endsWith('...')).toBe(true)
  })

  it('honors a custom cap', () => {
    expect(truncateForCatalog('abcdefgh', 5)).toBe('ab...')
  })
})

describe('estimateTokens — every CJK range the table declares', () => {
  it('counts modern Hangul syllables and Hangul Jamo Extended-A as CJK', () => {
    // Two separate ranges in `isCjk`: 0xAC00 (Hangul syllables) and 0xA960
    // (the extended Jamo block). A Hangul file is common enough that a range
    // dropped from the chain would show up as a wrong cost figure.
    expect(estimateTokens('\uAC00')).toBe(1)
    expect(estimateTokens('\uA960')).toBe(1)
    expect(estimateTokens('\uAC00\uA960')).toBe(2)
  })

  it('counts compatibility ideographs and fullwidth forms as CJK', () => {
    // 0xF900 (CJK compatibility ideographs) and 0xFF21 (a fullwidth letter):
    // the second is the one a Latin-only rule would misread as an unknown
    // character and charge as punctuation.
    expect(estimateTokens('\uF900')).toBe(1)
    expect(estimateTokens('\uFF21')).toBe(1)
    expect(estimateTokens('\uAC00\uF900\uFF21')).toBe(3)
  })
})

