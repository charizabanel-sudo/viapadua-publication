import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

export type Db = PrismaClient;

/** Creates a Prisma client over node-postgres. Used by the app (lib/server/db.ts) and CLI scripts. */
export function createPrismaClient(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
