import { defineConfig } from "@playwright/test";

// 개발 서버와 겹치지 않는 포트에서 API와 웹을 직접 띄운다.
const API_PORT = "8791";
const WEB_PORT = 5391;

export default defineConfig({
  testDir: import.meta.dirname,
  workers: 1,
  timeout: 90_000,
  use: { baseURL: `http://localhost:${WEB_PORT}`, viewport: { width: 1600, height: 900 } },
  webServer: [
    {
      command: "tsx server/index.ts",
      cwd: `${import.meta.dirname}/..`,
      url: `http://localhost:${API_PORT}/api/graph`,
      env: { PORT: API_PORT, DATA_DIR: ".e2e-out/ui-data", PROVIDER_MODE: process.env.PROVIDER_MODE ?? "mock" },
      reuseExistingServer: false,
    },
    {
      command: `vite --config web/vite.config.ts --port ${WEB_PORT} --strictPort`,
      cwd: `${import.meta.dirname}/..`,
      url: `http://localhost:${WEB_PORT}`,
      env: { PORT: API_PORT },
      reuseExistingServer: false,
    },
  ],
});
