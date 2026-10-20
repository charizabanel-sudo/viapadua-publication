/**
 * Targeted, repeatable rename of an admin's display name (nothing else changes).
 *
 *   npm run admin:rename -- --from "Rancel" --to "Admin"                    (dry run: shows the match)
 *   npm run admin:rename -- --from "Rancel" --to "Admin" --apply            (renames exactly one admin)
 *   npm run admin:rename -- --from "Rancel" --to "Admin" --email x@y --apply  (if several share the name)
 *
 * Only `admins.name` is updated. Email, password, active flag, IDs, sessions and audit history are untouched.
 * Re-running after success is a no-op ("already renamed").
 */
import { config } from "dotenv";
import { createPrismaClient } from "@/lib/db/client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}***@${domain ?? ""}`;
}

async function main() {
  const from = arg("--from")?.trim();
  const to = arg("--to")?.trim();
  const email = arg("--email")?.trim().toLowerCase();
  const apply = process.argv.includes("--apply");
  if (!from || !to || to.length > 100) {
    console.error('Usage: npm run admin:rename -- --from "Old Name" --to "New Name" [--email admin@example.com] [--apply]');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const db = createPrismaClient(url);
  try {
    const matches = await db.admin.findMany({
      where: { name: from, ...(email ? { email } : {}) },
      select: { id: true, email: true, name: true, isActive: true },
      orderBy: { id: "asc" },
    });
    const already = await db.admin.count({ where: { name: to, ...(email ? { email } : {}) } });
    console.log(`Admins named "${from}"${email ? ` with ${maskEmail(email)}` : ""}: ${matches.length}`);
    for (const m of matches) console.log(`  #${m.id}  ${maskEmail(m.email)}  active=${m.isActive}`);

    if (matches.length === 0) {
      console.log(already > 0 ? `Nothing to do: already named "${to}".` : "No matching admin found. Nothing changed.");
      return;
    }
    if (matches.length > 1) {
      console.error("More than one admin matches. Re-run with --email to choose exactly one. Nothing changed.");
      process.exit(2);
    }
    if (!apply) {
      console.log(`Dry run. Re-run with --apply to rename #${matches[0].id} to "${to}".`);
      return;
    }
    const result = await db.admin.updateMany({ where: { id: matches[0].id, name: from }, data: { name: to } });
    console.log(result.count === 1 ? `Renamed admin #${matches[0].id} to "${to}".` : "No change (the name changed concurrently).");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
