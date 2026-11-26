/**
 * Path-pattern compilation for `paths` (Claude Code) and `globs` (Cursor).
 *
 * picomatch compiles brace groups into regex alternations rather than
 * enumerating patterns, so no expansion budget is needed here: measured, a
 * 512-combination brace pattern produced an 80-character regex. The real risk
 * is catastrophic backtracking, which the guard below screens for. See §15.8.
 */
import picomatch from 'picomatch'

/** A compiled matcher plus the pattern it came from. */
export interface CompiledPattern {
  readonly pattern: string
  readonly match: (path: string) => boolean
}

/** Patterns with this many single stars or more are screened. */
export const SINGLE_STAR_THRESHOLD = 8
/** A short literal between single stars is what makes backtracking blow up. */
export const SHORT_LITERAL_MAX = 3

/**
 * Heuristic screen for patterns with catastrophic backtracking risk.
 *
 * Measured on picomatch 4.0.7: `*a*a*a*…` with 4 stars takes 18 ms, 5 stars
 * 545 ms, and 10 stars exceeds five seconds, while `**` and brace patterns
 * stay at 2–3 ms even with dozens of directory levels. The screen targets the
 * shape that actually degrades.
 */
export function looksCatastrophic(pattern: string): boolean {
  const singleStars = (pattern.match(/(?<!\*)\*(?!\*)/g) ?? []).length
  if (singleStars < SINGLE_STAR_THRESHOLD) return false
  const segments = pattern.split(/(?<!\*)\*(?!\*)/)
  const middles = segments.slice(1, -1)
  return middles.some((segment) => segment.length <= SHORT_LITERAL_MAX)
}

export interface CompileResult {
  readonly matchers: readonly CompiledPattern[]
  readonly warnings: readonly string[]
}

/**
 * Compile patterns, skipping the ones that are dangerous.
 *
 * A pattern that cannot be read never disables its siblings, which is the
 * behavior Claude Code documents for an unreadable bracket expression.
 *
 * Measured on picomatch 4.0.7: an invalid pattern (`BAD[[[pattern`, `[[[`,
 * `a{b`, a lone backslash) **does not throw** — it compiles to a matcher that
 * always returns false. So a rule keeps its other patterns and simply never
 * matches through the broken one, which is the same outcome with no work. The
 * `try`/`catch` below is defensive only and did not fire in any measured case.
 */
export function compilePatterns(patterns: readonly string[]): CompileResult {
  const matchers: CompiledPattern[] = []
  const warnings: string[] = []

  for (const pattern of patterns) {
    const trimmed = pattern.trim()
    if (trimmed === '') continue
    if (looksCatastrophic(trimmed)) {
      warnings.push(`跳过有回溯风险的 glob：${trimmed}`)
      continue
    }
    try {
      // `dot` matches inside dotfiles. There is no `posixSlashes` option in
      // picomatch (that is a micromatch option); Windows separators are
      // normalized to `/` by `relativize` below before matching.
      const match = picomatch(trimmed, { dot: true })
      matchers.push({ pattern: trimmed, match: (path: string) => match(path) })
    } catch {
      warnings.push(`跳过无法编译的 glob：${trimmed}`)
    }
  }
  return { matchers, warnings }
}

/**
 * Whether any pattern matches, testing the path relative to the base directory.
 *
 * Patterns are written relative to a base (the project root for project rules,
 * the session's working directory for user rules), so the absolute path is
 * converted first and anything outside the base is rejected rather than
 * matched against `../` segments.
 */
export function matchesAny(
  matchers: readonly CompiledPattern[],
  absolutePath: string,
  baseDir: string,
): boolean {
  const relative = relativize(absolutePath, baseDir)
  if (relative === null) return false
  return matchers.some((matcher) => matcher.match(relative))
}

/** Base-relative posix path, or null when the path escapes the base. */
function relativize(absolutePath: string, baseDir: string): string | null {
  const normalized = absolutePath.replace(/\\/g, '/')
  const base = baseDir.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized.startsWith(`${base}/`)) return null
  const relative = normalized.slice(base.length + 1)
  return relative === '' ? null : relative
}

/**
 * Cheap self-check: run every matcher once against a long non-matching probe.
 *
 * Screens for shapes `looksCatastrophic` does not know about. A slow run means
 * the rule degrades to on-demand instead of staying always-on.
 */
export function selfCheck(matchers: readonly CompiledPattern[], budgetMs = 200): boolean {
  const probe = `${'a/'.repeat(60)}${'z'.repeat(60)}`
  const started = Date.now()
  for (const matcher of matchers) {
    try { matcher.match(probe) } catch { /* a throw is not slowness */ }
  }
  return Date.now() - started < budgetMs
}
