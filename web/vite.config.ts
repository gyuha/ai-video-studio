import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 포트는 고정하고 strictPort로 둔다. 충돌하면 Vite가 조용히 다른 포트로 옮기지 않고 바로 실패한다.
const api = `http://localhost:${process.env.PORT ?? 18787}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: Number(process.env.WEB_PORT ?? 15173), strictPort: true, proxy: { "/api": api, "/files": api } },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
