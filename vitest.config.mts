import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's "@/*" -> "./src/*" path alias, which vitest
// doesn't pick up on its own. Only needed once a test imports a module
// that resolves another module via "@/..." (issueTaxonomy.ts does).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
