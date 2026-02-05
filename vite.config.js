import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/lichess": {
        target: "https://lichess.org",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/lichess/, ""),
      },
    },
  },
});