// Vite config for the browser build of PrivateAIVault. Bundles the real
// compiled Compact contract + compact-runtime (WASM) so the circuit runs
// entirely client-side -- no backend, no Docker, no proof server. Adapted
// from midnightntwrk/example-bboard's bboard-ui/vite.config.ts, which
// already solves the WASM/top-level-await bundling problem for this exact
// dependency (@midnight-ntwrk/onchain-runtime-v3).
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "./index.html",
        selftest: "./selftest.html",
      },
    },
  },
  plugins: [wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: [
      "@midnight-ntwrk/onchain-runtime-v3",
      "@midnight-ntwrk/compact-runtime",
    ],
  },
  resolve: {
    extensions: [".mjs", ".js", ".ts", ".json", ".wasm"],
    mainFields: ["browser", "module", "main"],
  },
});
