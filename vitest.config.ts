import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The web components render React into a DOM; nothing else in the repo does. Overriding the
    // environment per-glob rather than globally keeps the server, shared, companion-module and
    // scripts suites on plain `node` — they neither need jsdom nor should pay to boot one.
    // JSX is transformed by vitest's esbuild, which reads packages/web/tsconfig.json
    // (`"jsx": "react-jsx"`), so no React plugin is needed to run a component test.
    environmentMatchGlobs: [["packages/web/src/components/**", "jsdom"]],
  },
});
