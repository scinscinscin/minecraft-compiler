import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  optimizeDeps: { exclude: ["compiler"], include: ["compiler"] },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    deps: { interopDefault: true, optimizer: { coreWasm: {} } },
    server: {},
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/repl.ts", "src/index.ts"],
    },
  },
  esbuild: { target: "es2017" },
});
