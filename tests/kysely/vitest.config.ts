import { defineConfig } from "vitest/config";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.test" });

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      reporter: ["text", "lcov"],
    },
    maxConcurrency: 1,
    hookTimeout: 60 * 1000,
  },
});
