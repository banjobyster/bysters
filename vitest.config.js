import { defineConfig } from 'vitest/config'

// The pure core runs headless (no DOM, no Pixi), so the node environment is
// right. A separate config from vite.config.js because tests live at the repo
// root (core/, dom/), while the demo build roots at ./demo.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['core/**/*.test.js', 'dom/**/*.test.js'],
  },
})
