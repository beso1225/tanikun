import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./apps/api/test/wrangler.test.jsonc",
      },
    }),
  ],
  test: {
    include: ["apps/api/test/**/*.test.mts"],
    testTimeout: 20_000,
  },
});
