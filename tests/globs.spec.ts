import { describe, expect, it } from 'vitest'
import {
  compilePatterns, looksCatastrophic, matchesAny, selfCheck,
  SINGLE_STAR_THRESHOLD, SHORT_LITERAL_MAX,
} from '../src/globs.ts'

describe('looksCatastrophic', () => {
  // Measured on picomatch 4.0.7: `*a*a*a*…` with 4 stars takes 18 ms, 5 stars
  // 545 ms, and 10 stars exceeds five seconds. The screen targets that shape.
  it('flags the pattern that actually blows up', () => {
    expect(looksCatastrophic('*a*a*a*a*a*a*a*a*a*.ts')).toBe(true)
  })

  it('does not flag globstar patterns, which stay fast at any depth', () => {
    expect(looksCatastrophic('src/**/*.ts')).toBe(false)
    expect(looksCatastrophic('**/**/**/**/*.ts')).toBe(false)
    expect(looksCatastrophic('**/*.{ts,tsx,js,jsx}')).toBe(false)
  })

  it('does not flag brace patterns, which compile to alternation', () => {
    expect(looksCatastrophic('{a,b}/{c,d}/*.{ts,tsx}')).toBe(false)
  })

  it('does not flag a few single stars', () => {
    expect(looksCatastrophic('*a*a*.ts')).toBe(false)
    expect(looksCatastrophic('src/*/x/*/y/*.ts')).toBe(false)
  })

  it('requires both many stars and a short literal between them', () => {
    // Enough stars, but the literals are long, so backtracking is bounded.
    const longLiterals = Array.from({ length: 12 }, (_, i) => `segment${i}`).join('*') + '*'
    expect(looksCatastrophic(longLiterals)).toBe(false)
    // Few stars but a short literal: below the star threshold.
    expect(looksCatastrophic('*a*a*.ts')).toBe(false)
  })

  it('exposes its thresholds', () => {
    expect(SINGLE_STAR_THRESHOLD).toBe(8)
    expect(SHORT_LITERAL_MAX).toBe(3)
  })
})

describe('compilePatterns', () => {
  it('compiles ordinary patterns', () => {
    const r = compilePatterns(['src/**/*.ts', 'lib/*.tsx'])
    expect(r.matchers.length).toBe(2)
    expect(r.warnings).toEqual([])
  })

  it('skips a dangerous pattern and warns, keeping its siblings', () => {
    const r = compilePatterns(['src/**/*.ts', '*a*a*a*a*a*a*a*a*a*.ts', 'lib/*.tsx'])
    expect(r.matchers.length).toBe(2)
    expect(r.warnings.length).toBe(1)
    expect(r.warnings[0]).toContain('回溯风险')
  })

  it('keeps working when one pattern is unreadable', () => {
    // Measured: picomatch does not throw on an invalid pattern; it compiles a
    // matcher that always returns false. Either way the rule keeps its others.
    const r = compilePatterns(['src/**/*.ts', 'BAD[[[pattern'])
    expect(r.matchers.length).toBe(2)
    expect(matchesAny(r.matchers, '/p/src/a.ts', '/p')).toBe(true)
  })

  it('ignores blank entries', () => {
    expect(compilePatterns(['', '   ']).matchers.length).toBe(0)
  })

  it('handles an empty list', () => {
    const r = compilePatterns([])
    expect(r.matchers).toEqual([])
    expect(r.warnings).toEqual([])
  })
})

describe('matchesAny', () => {
  const { matchers } = compilePatterns(['src/**/*.ts', '**/*.tsx'])

  it('matches a path inside the base', () => {
    expect(matchesAny(matchers, '/p/src/a/b.ts', '/p')).toBe(true)
    expect(matchesAny(matchers, '/p/deep/x.tsx', '/p')).toBe(true)
  })

  it('does not match a path outside the base', () => {
    expect(matchesAny(matchers, '/other/src/a.ts', '/p')).toBe(false)
  })

  it('does not match an unrelated file inside the base', () => {
    expect(matchesAny(matchers, '/p/src/a.js', '/p')).toBe(false)
  })

  it('normalizes Windows separators', () => {
    expect(matchesAny(matchers, 'D:\\p\\src\\a.ts', 'D:\\p')).toBe(true)
  })

  it('tolerates a trailing separator on the base', () => {
    expect(matchesAny(matchers, '/p/src/a.ts', '/p/')).toBe(true)
  })

  it('rejects the base directory itself', () => {
    expect(matchesAny(matchers, '/p', '/p')).toBe(false)
  })

  it('matches nothing when there are no matchers', () => {
    expect(matchesAny([], '/p/src/a.ts', '/p')).toBe(false)
  })
})

describe('selfCheck', () => {
  it('passes for safe patterns', () => {
    const { matchers } = compilePatterns(['src/**/*.ts', '{a,b}/{c,d}/*.ts'])
    expect(selfCheck(matchers)).toBe(true)
  })

  it('passes for an empty matcher list', () => {
    expect(selfCheck([])).toBe(true)
  })
})

describe('compilePatterns — what it records and what it skips', () => {
  it('records the trimmed pattern, so a warning can be traced back to the entry', () => {
    const { matchers, warnings } = compilePatterns(['  src/**/*.ts  '])
    expect(matchers.map((matcher) => matcher.pattern)).toEqual(['src/**/*.ts'])
    expect(warnings).toEqual([])
    expect(matchesAny(matchers, '/p/src/a.ts', '/p')).toBe(true)
  })

  it('keeps a malformed pattern instead of warning about it, because picomatch does not throw', () => {
    // Measured against picomatch 4.0.7: the shapes below compile into a
    // matcher that never matches, so `compilePatterns` has nothing to catch
    // and issues no warning. The glob syntax the package accepts is documented
    // at https://github.com/micromatch/picomatch#globbing-features. This case
    // pins the measurement: if an upgrade makes one of them throw, the warning
    // path starts being used and this assertion is where that shows up.
    const { matchers, warnings } = compilePatterns(['BAD[[[pattern', '[[[', 'a{b', '\\'])
    expect(matchers).toHaveLength(4)
    expect(warnings).toEqual([])
    for (const matcher of matchers) expect(matcher.match('src/a.ts')).toBe(false)
  })
})

describe('compilePatterns — a base spelled with a trailing separator', () => {
  it('treats the base directory itself as outside the base', () => {
    // `relativize` strips trailing separators from the base but not from the
    // path, so a path written as the base plus its separator slices down to the
    // empty string. An empty relative path is not a file under the base, so the
    // match has to be refused instead of being handed to picomatch.
    const { matchers } = compilePatterns(['**/*.ts'])
    expect(matchesAny(matchers, '/p/', '/p')).toBe(false)
    expect(matchesAny(matchers, '/p/src/a.ts', '/p')).toBe(true)
  })
})

