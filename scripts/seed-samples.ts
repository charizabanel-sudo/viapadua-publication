/**
 * Prepares the 10 fictional Sample/Demo bookings (VP-SAMPLE-0001 … VP-SAMPLE-0010).
 * Dry run by default; nothing is written without --apply. Existing records are never changed.
 *
 *   npm run samples:seed                 (dry run against DATABASE_URL)
 *   npm run samples:seed -- --apply      (insert missing samples only)
 */
import { config } from "dotenv";
import { createPrismaClient } from "@/lib/db/client";
import { applySampleSeed, planSampleSeed } from "@/lib/booking/samples";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw Error("DATABASE_URL is not set.");
  const target = new URL(url);
  console.log(`Target database: ${target.hostname}/${target.pathname.slice(1)} · mode: ${apply ? "APPLY" : "dry run"}`);
  const db = createPrismaClient(url);
  try {
    const plan = await planSampleSeed(db);
    console.table(plan.map((p) => ({ reference: p.reference, action: p.action, service: p.service, date: p.date, status: p.status, ...(p.reason ? { reason: p.reason } : {}) })));
    const counts = { create: 0, exists: 0, conflict: 0 };
    for (const p of plan) counts[p.action]++;
    console.log(`Would create ${counts.create}, already present ${counts.exists}, conflicts ${counts.conflict}.`);
    if (counts.conflict) throw Error("Conflicting references found; nothing was written.");
    if (!apply) {
      console.log("Dry run only. Re-run with --apply to insert the missing samples.");
      return;
    }
    const result = await applySampleSeed(db);
    console.log(`Created ${result.created.length} sample bookings; ${result.skipped.length} already present.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
