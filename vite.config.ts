import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  appType: "spa",
  plugins: [cloudflare()],
  build: {
    outDir: "dist/client",
  },
});
