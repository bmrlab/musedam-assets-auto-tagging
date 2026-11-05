import tailwind from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: resolve(__dirname, "development/metadata-preview"),
  plugins: [
    {
      name: "metadata-fixture-actions",
      enforce: "pre",
      resolveId(source) {
        if (
          source.endsWith("/metadata-actions") ||
          source === "./metadata-actions" ||
          source.endsWith("/embed/message") ||
          source.endsWith("/tags/actions") ||
          source.endsWith("/dashboard/actions")
        )
          return resolve(__dirname, "development/metadata-preview/actions.ts");
      },
    },
    react(),
  ],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  css: { postcss: { plugins: [tailwind()] } },
  server: { host: "127.0.0.1", port: 3019, fs: { allow: [__dirname] } },
});
