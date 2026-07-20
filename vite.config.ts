import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the production build as a project site under /scarney/, but the dev
  // server (and Playwright tests against it) should stay at the root.
  base: command === "build" ? "/scarney/" : "/",
}));
