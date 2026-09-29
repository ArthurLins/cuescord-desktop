import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  use: { viewport: { width: 1280, height: 800 } },
  reporter: "list",
});
