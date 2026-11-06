import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const contracts = (f: string) => fileURLToPath(new URL(`../../packages/contracts/src/${f}.ts`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The contracts index pulls in node:crypto (hashing, permits), which must not reach the browser.
    // Runtime helpers are imported from these pure modules only; everything else is `import type`.
    alias: {
      "@tollbooth/contracts/money": contracts("money"),
      "@tollbooth/contracts/registry": contracts("registry"),
    },
  },
  server: { port: 5173, proxy: { "/api": "http://localhost:4000" } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
});
