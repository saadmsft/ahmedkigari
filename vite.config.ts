import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works on GitHub Pages project sites (served from /<repo>/)
  // and also on root domains / local preview without reconfiguration.
  base: "./",
  server: { host: true, port: 5173 },
  build: { target: "es2022", sourcemap: true },
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d-compat"],
  },
});
