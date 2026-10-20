/**
 * Non-destructive import of the legacy MySQL (phpMyAdmin) export into Neon.
 *
 *   npm run db:import-legacy -- --file "C:\path\to\viapadua.sql"           (dry run, no writes)
 *   npm run db:import-legacy -- --file "C:\path\to\viapadua.sql" --apply   (writes)
 *
 * - Only inserts. Never updates or deletes existing rows; re-running skips rows already imported.
 * - Aborts if an existing row has the same id but different data (e.g. bookings created before the import).
 * - Never runs during builds.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createPrismaClient, type Db } from "@/lib/db/client";
import { buildLegacyImportPlan, type LegacyImportPlan } from "@/lib/import/legacy";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Conflict = string;

async function findConflicts(db: Db, plan: LegacyImportPlan): Promise<{ conflicts: Conflict[]; existing: Record<string, number> }> {
  const conflicts: Conflict[] = [];
  const existing: Record<string, number> = {};

  const users = await db.user.findMany({ where: { id: { in: plan.users.map((u) => u.id!) } }, select: { id: true, email: true } });
  existing.users = users.length;
  const userEmail = new Map(users.map((u) => [u.id, u.email]));
  for (const u of plan.users) {
    const email = userEmail.get(u.id!);
    if (email !== undefined && email !== u.email) conflicts.push(`users #${u.id}: existing email differs`);
  }
  const emailClash = await db.user.findMany({
    where: { email: { in: plan.users.map((u) => u.email) }, id: { notIn: plan.users.map((u) => u.id!) } },
    select: { id: true },
  });
  for (const u of emailClash) conflicts.push(`users #${u.id}: email already used by a different id`);

  const bookings = await db.booking.findMany({
    where: { id: { in: plan.bookings.map((b) => b.id!) } },
    select: { id: true, reference: true },
  });
  existing.bookings = bookings.length;
  const refById = new Map(bookings.map((b) => [b.id, b.reference]));
  for (const b of plan.bookings) {
    const ref = refById.get(b.id!);
    if (ref !== undefined && ref !== b.reference) conflicts.push(`bookings #${b.id}: id already used by ${ref}`);
  }

  const blocked = await db.blockedDate.findMany({ where: { id: { in: plan.blockedDates.map((d) => d.id!) } }, select: { id: true, date: true } });
  existing.blocked_dates = blocked.length;
  for (const d of plan.blockedDates) {
    const row = blocked.find((x) => x.id === d.id);
    if (row && row.date.getTime() !== (d.date as Date).getTime()) conflicts.push(`blocked_dates #${d.id}: different date`);
  }

  existing.admin_events = await db.adminEvent.count({ where: { id: { in: plan.adminEvents.map((e) => e.id!) } } });
  existing.chat_messages = await db.chatMessage.count({ where: { id: { in: plan.chatMessages.map((m) => m.id!) } } });
  existing.admins = await db.admin.count({ where: { email: { in: plan.admins.map((a) => a.email) } } });

  return { conflicts, existing };
}

async function main() {
  const file = arg("--file");
  const apply = process.argv.includes("--apply");
  if (!file) {
    console.error('Usage: npm run db:import-legacy -- --file "path/to/viapadua.sql" [--apply]');
    process.exit(1);
  }
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DIRECT_URL (or DATABASE_URL) is not set. Add it to .env.local.");
    process.exit(1);
  }

  const plan = buildLegacyImportPlan(readFileSync(file, "utf8"));
  console.log("Parsed legacy export:");
  console.table({
    users: plan.users.length,
    admins: plan.admins.length,
    bookings: plan.bookings.length,
    blocked_dates: plan.blockedDates.length,
    admin_events: plan.adminEvents.length,
    chat_messages: plan.chatMessages.length,
  });
  for (const w of plan.warnings) console.warn(`warning: ${w}`);

  const db = createPrismaClient(url);
  try {
    const { conflicts, existing } = await findConflicts(db, plan);
    console.log("Rows already present (will be skipped):");
    console.table(existing);
    if (conflicts.length) {
      console.error(`\nAborting: ${conflicts.length} conflicting row(s). Nothing was written.`);
      for (const c of conflicts.slice(0, 50)) console.error(`  - ${c}`);
      process.exit(2);
    }
    if (!apply) {
      console.log("\nDry run only. Re-run with --apply to import.");
      return;
    }

    const inserted = await db.$transaction(
      async (tx) => {
        const counts: Record<string, number> = {};
        counts.users = (await tx.user.createMany({ data: plan.users, skipDuplicates: true })).count;
        counts.admins = (await tx.admin.createMany({ data: plan.admins, skipDuplicates: true })).count;
        counts.blocked_dates = (await tx.blockedDate.createMany({ data: plan.blockedDates, skipDuplicates: true })).count;
        counts.admin_events = (await tx.adminEvent.createMany({ data: plan.adminEvents, skipDuplicates: true })).count;
        counts.chat_messages = (await tx.chatMessage.createMany({ data: plan.chatMessages, skipDuplicates: true })).count;
        counts.bookings = (await tx.booking.createMany({ data: plan.bookings, skipDuplicates: true })).count;

        // Move id sequences past imported ids so new rows never collide.
        for (const table of ["users", "bookings", "blocked_dates", "admin_events", "chat_messages", "admins"]) {
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${table}"), 1))`,
          );
        }
        return counts;
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    console.log("Inserted:");
    console.table(inserted);
    console.log("Import complete.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
