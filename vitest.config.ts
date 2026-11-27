import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // `src/types.ts` declares types and one module augmentation and emits
      // no runtime code, so a per-file threshold there could only fail on
      // bytes the compiler removes.
      exclude: ['src/types.ts'],
      reporter: ['text', 'json-summary'],
      // Official policy: an uncovered line is often dead code the gate flags
      // for deletion, so statements, lines and functions are enforced per
      // file at 100%. Branch arms that no input can reach on these platforms
      // were audited one by one; the residue is reported, not enforced, and
      // each remaining arm is listed in docs/plugin-testing.md.
      thresholds: { perFile: true, statements: 100, lines: 100, functions: 100 },
    },
  },
})
