import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps asset URLs relative so the built tool works from any
// subpath (GitHub Pages /reroll, file://, etc.).
export default defineConfig({
  base: "./",
  plugins: [react()],
});
