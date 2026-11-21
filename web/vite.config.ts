import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { proxy: { "/api": api, "/files": api } },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
