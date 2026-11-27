import { describe, expect, it } from 'vitest'
import {
  applyBudget, consumeOutputBudget, formatOmittedLine, safeSlice,
  PER_RULE_MAX, PROJECT_RULES_TOTAL_MAX, READ_RULES_OUTPUT_MAX, USER_RULES_TOTAL_MAX,
} from '../src/budget.ts'

describe('applyBudget', () => {
  it('keeps short content untouched', () => {
    const r = applyBudget([{ key: 'a', content: 'short' }], 100, 1000)
    expect(r.kept).toEqual(['short'])
    expect(r.omitted).toEqual([])
    expect(r.truncated).toEqual([])
  })

  it('truncates a single over-long item and records it', () => {
    const r = applyBudget([{ key: 'a', content: 'x'.repeat(50) }], 10, 1000)
    expect(r.truncated).toEqual(['a'])
    expect(r.kept[0]?.startsWith('x'.repeat(10))).toBe(true)
    expect(r.kept[0]).toContain('[... rule truncated at 10 chars]')
    expect(r.omitted).toEqual([])
  })

  it('drops a whole item once the running total would be exceeded', () => {
    const r = applyBudget([
      { key: 'a', content: 'x'.repeat(10) },
      { key: 'b', content: 'y'.repeat(10) },
    ], 100, 15)
    expect(r.kept.length).toBe(1)
    expect(r.omitted).toEqual([{ key: 'b', chars: 10 }])
  })

  it('truncates before it omits, per item', () => {
    // Per-item cap 5, total 8: item a truncates to a 5-char body + note
    // (longer than 5), so b is dropped.
    const r = applyBudget([
      { key: 'a', content: 'x'.repeat(50) },
      { key: 'b', content: 'y'.repeat(50) },
    ], 5, 8)
    expect(r.truncated).toContain('a')
    expect(r.omitted.length).toBeGreaterThan(0)
  })

  it('exposes documented default caps', () => {
    expect(PER_RULE_MAX).toBe(8000)
    expect(USER_RULES_TOTAL_MAX).toBe(6000)
    expect(PROJECT_RULES_TOTAL_MAX).toBe(12000)
    expect(READ_RULES_OUTPUT_MAX).toBe(60000)
  })
})

describe('applyBudget with degenerate caps', () => {
  // Measured before the bounds in config.ts existed: a deployment pin could
  // hand these numbers straight through. `-1` truncated every rule to
  // `-1 chars`, and `NaN` silently disabled truncation altogether, because
  // every `>` comparison against NaN is false. The behaviour is pinned here so
  // a future change to the comparison is a test failure, not a silent hole.
  const items = [{ key: 'a', content: 'x'.repeat(50) }, { key: 'b', content: 'y'.repeat(50) }]

  it('uses the documented caps when the caller passes none', () => {
    // The two defaults were never exercised: every case above passes both caps.
    const keptUnderDefaults = applyBudget([{ key: 'a', content: 'short' }])
    expect(keptUnderDefaults.kept).toEqual(['short'])
    expect(keptUnderDefaults.truncated).toEqual([])
    // A body past the built-in per-rule cap truncates at exactly that cap.
    const big = applyBudget([{ key: 'a', content: 'x'.repeat(PER_RULE_MAX + 10) }])
    expect(big.truncated).toEqual(['a'])
    expect(big.kept[0]).toContain(`truncated at ${PER_RULE_MAX} chars`)
  })

  it('says out loud when the per-item cap is below the note it appends', () => {
    // `-1` used to reach here. Whatever the cap, the note must name the number
    // that was actually applied, so a nonsensical cap is visible rather than
    // producing an apparently-untruncated rule.
    const r = applyBudget(items, -1, 12000)
    expect(r.kept[0]).toContain('truncated at -1 chars')
    expect(r.truncated).toEqual(['a', 'b'])
  })

  it('drops every item when the total cap is zero', () => {
    const r = applyBudget(items, 100, 0)
    expect(r.kept).toEqual([])
    expect(r.omitted.map((o) => o.key)).toEqual(['a', 'b'])
  })

  it('never truncates when the cap is NaN, which is why config rejects it', () => {
    // Documented as a hazard, not as a feature: this is the exact silent hole
    // the config bounds exist to close.
    const r = applyBudget(items, Number.NaN, 12000)
    expect(r.truncated).toEqual([])
    expect(r.kept.length).toBe(2)
    expect(r.kept[0]).toBe(items[0]?.content)
  })
})

describe('formatOmittedLine', () => {
  it('is empty when nothing was omitted', () => {
    expect(formatOmittedLine([])).toBe('')
  })

  it('names the count and each key with a rounded size', () => {
    const line = formatOmittedLine([{ key: 'ts-standard', chars: 3000 }])
    expect(line).toContain('1 rule(s) omitted')
    expect(line).toContain('ts-standard')
    expect(line).toContain('3KB')
  })

  it('never reports a zero size', () => {
    expect(formatOmittedLine([{ key: 'tiny', chars: 1 }])).toContain('1KB')
  })
})

describe('consumeOutputBudget', () => {
  it('keeps whole blocks that fit', () => {
    const r = consumeOutputBudget(['aaa', 'bbb'], 100)
    expect(r.kept).toEqual(['aaa', 'bbb'])
    expect(r.truncated).toBe(false)
  })

  it('truncates the block that crosses the budget and stops', () => {
    const r = consumeOutputBudget(['aaa', 'bbb', 'ccc'], 7)
    expect(r.truncated).toBe(true)
    expect(r.kept.length).toBe(3)
    expect(r.kept[2]).toContain('read_rules output budget')
  })

  it('drops later blocks once the budget is exhausted', () => {
    const r = consumeOutputBudget(['aaaaaa', 'b', 'c'], 6)
    expect(r.kept).toEqual(['aaaaaa'])
    expect(r.truncated).toBe(true)
  })
})

describe('safeSlice', () => {
  // Regression: CodeBuddy's own safeSlice tests the LOW surrogate range
  // (0xDC00-0xDFFF). Measured on "ab<emoji>cd", that drops a complete pair and
  // returns a lone high surrogate. The guard belongs on the HIGH range.
  const s = 'ab\u{1F600}cd'      // surrogate pair occupies index 2 (high) and 3 (low)

  it('drops a half pair when the cut lands after a high surrogate', () => {
    expect(safeSlice(s, 3)).toBe('ab')
  })

  it('keeps a complete pair when the cut lands after it', () => {
    expect(safeSlice(s, 4)).toBe('ab\u{1F600}')
  })

  it('returns the input unchanged when it already fits', () => {
    expect(safeSlice(s, 100)).toBe(s)
  })

  it('never leaves a lone high surrogate at the end', () => {
    for (let limit = 0; limit <= s.length; limit++) {
      const out = safeSlice(s, limit)
      if (out.length === 0) continue
      const last = out.charCodeAt(out.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
  })

  it('handles plain ASCII without special casing', () => {
    expect(safeSlice('abcdef', 3)).toBe('abc')
  })
})

describe('truncation never leaves half a surrogate pair', () => {
  // Both budgets cut by character count, so a boundary that lands inside a
  // surrogate pair would end the kept text with a lone high surrogate - which
  // renders as a replacement character. Sweep every boundary of several bodies
  // rather than trusting one example.
  const EMOJI = '\u{1F600}'
  const endsInHighSurrogate = (text: string): boolean => {
    if (text.length === 0) return false
    const last = text.charCodeAt(text.length - 1)
    return last >= 0xd800 && last <= 0xdbff
  }
  const perItemMark = (cap: number): string => '\n[... rule truncated at ' + String(cap) + ' chars]'
  const OUTPUT_MARK = '\n[... rule content truncated due to read_rules output budget]'

  it('applyBudget drops the half pair at every cut position', () => {
    let cuts = 0
    for (let lead = 0; lead <= 2; lead++) {
      const body = 'a'.repeat(lead) + EMOJI + 'b'.repeat(6)
      for (let cap = 1; cap < body.length; cap++) {
        const kept = applyBudget([{ key: 'k', content: body }], cap, 1000000).kept[0] ?? ''
        const mark = perItemMark(cap)
        const text = kept.endsWith(mark) ? kept.slice(0, kept.length - mark.length) : kept
        expect(endsInHighSurrogate(text)).toBe(false)
        if (body.length > cap) cuts++
      }
    }
    expect(cuts).toBeGreaterThan(0)
  })

  it('applyBudget shortens the body when the cap splits a pair', () => {
    // The high surrogate sits at index 3, so a cap of 4 cuts between the two
    // halves: the kept text must be three characters, not four. Without the
    // guard this is 'abc\uD83D' plus the marker.
    const body = 'abc' + EMOJI + 'de'
    const kept = applyBudget([{ key: 'k', content: body }], 4, 1000000).kept[0] ?? ''
    expect(kept).toBe('abc' + perItemMark(4))
  })

  it('consumeOutputBudget drops the half pair at every cut position', () => {
    let cuts = 0
    for (let lead = 0; lead <= 2; lead++) {
      const block = 'a'.repeat(lead) + EMOJI + 'b'.repeat(6)
      for (let cap = 1; cap < block.length; cap++) {
        const kept = consumeOutputBudget([block], cap).kept[0] ?? ''
        const text = kept.endsWith(OUTPUT_MARK) ? kept.slice(0, kept.length - OUTPUT_MARK.length) : kept
        expect(endsInHighSurrogate(text)).toBe(false)
        if (block.length > cap) cuts++
      }
    }
    expect(cuts).toBeGreaterThan(0)
  })

  it('consumeOutputBudget keeps a block that fits byte for byte', () => {
    const block = 'abc' + EMOJI + 'de'
    expect(consumeOutputBudget([block], block.length).kept[0]).toBe(block)
  })
})
