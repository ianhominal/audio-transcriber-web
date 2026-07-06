import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Vitest cubre la LÓGICA pura (node env). La UI y los flujos se testean con Playwright (/e2e).
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
