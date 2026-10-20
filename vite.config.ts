import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  server: { port: 4173, strictPort: false, cors: true },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        sandbox: resolve(import.meta.dirname, "sandbox.html")
      }
    }
  }
});
