import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// base: "./" keeps asset URLs relative so the built tool works from any
// subpath (GitHub Pages /reroll, file://, etc.).
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@lib": path.resolve(__dirname, "../libs"),
    },
  },
});
