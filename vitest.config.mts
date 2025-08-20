import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    server: {
      deps: {
        // https://next-intl.dev/docs/environments/testing#vitest
        inline: ["next-intl"],
      },
    },
  },
});
