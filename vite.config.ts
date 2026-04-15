import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import ssrPlugin from "vite-ssr-components/plugin";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  appType: "custom",
  plugins: [cloudflare(), ssrPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/client",
  },
});
