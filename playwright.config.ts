import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: { command: "npm run dev -- --port 4173 --strictPort", url: "http://127.0.0.1:4173", reuseExistingServer: true },
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" }
});
