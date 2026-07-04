import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The demo (in ./demo) imports the framework exactly as an external consumer
// would: `import { mount, behaviors } from 'bysters'`. The alias resolves that
// bare specifier to this package at the repo root, and `bysters/<subpath>` to a
// file inside it. base is relative so the built demo works at any URL depth
// (it deploys to https://banjobyster.github.io/bysters/).
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: 'demo',
  base: './',
  resolve: {
    alias: [
      { find: /^bysters$/, replacement: `${root}index.js` },
      { find: /^bysters\/(.*)$/, replacement: `${root}$1` },
    ],
  },
  build: { outDir: '../dist', emptyOutDir: true },
})
