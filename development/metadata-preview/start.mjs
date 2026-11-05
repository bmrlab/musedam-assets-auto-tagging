import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const viteEntry = require.resolve("vite", { paths: [require.resolve("vitest/package.json")] });
const { createServer } = await import(viteEntry);
const server = await createServer({ configFile: fileURLToPath(new URL("../../metadata-preview.config.ts", import.meta.url)) });
await server.listen();
server.printUrls();
