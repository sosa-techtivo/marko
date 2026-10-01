import path from "node:path";
import { defineConfig } from "vitest/config";

// Isolated POC config — never matched by the app's own `npm test`.
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../src") } },
  test: { include: ["chatgpt-probe.poc.ts"], testTimeout: 300_000 },
});
