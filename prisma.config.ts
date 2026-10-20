import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// The Prisma CLI does not read Next.js env files, so load them explicitly.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Migrations must use the direct (unpooled) Neon connection.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
