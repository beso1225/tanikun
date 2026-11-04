import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./apps/api/migrations"),
        },
      },
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
