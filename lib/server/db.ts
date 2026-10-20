import "server-only";
import { createPrismaClient, type Db } from "@/lib/db/client";
import { getDatabaseUrl } from "./env";

const globalForDb = globalThis as unknown as { vpDb?: Db };

/** One Prisma client per server instance (reused across hot reloads in dev). */
export function getDb(): Db {
  if (!globalForDb.vpDb) globalForDb.vpDb = createPrismaClient(getDatabaseUrl());
  return globalForDb.vpDb;
}
