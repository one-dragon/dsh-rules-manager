import { defineConfig } from 'tsdown'

export default defineConfig([
  // Host side: ESM, Node, declarations on.
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    fixedExtension: false,
    platform: 'node',
    target: 'es2024',
    dts: true,
    clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//, 'picomatch'] },
  },
  // Client side: CJS wrapped for DSH's module loader, React external.
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'] },
    outputOptions: {
      entryFileNames: 'client.js',
      // The module-table key must equal the npm package name (official spec:
      // "Entry name == package name"), or the loader reports the bundle as
      // "loaded without registering" and the client half never materializes.
      banner: 'window.__ModuleLoader__.load({ id: "@one-dragon/dsh-rules-manager", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
