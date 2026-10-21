import { config } from "dotenv";
import pg from "pg";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw Error(
      "Set DATABASE_URL. This script is read-only and never changes accounts or passwords.",
    );
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const columns = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'",
    );
    const active = columns.rows.some((c) => c.column_name === "is_active");
    const result = await client.query(
      `SELECT role, COUNT(*)::int AS accounts, COUNT(*) FILTER (WHERE password ~ $1)::int AS compatible_bcrypt, COUNT(*) FILTER (WHERE NOT (password ~ $1))::int AS unsupported_passwords${active ? ", COUNT(*) FILTER (WHERE is_active=false)::int AS inactive" : ""} FROM users GROUP BY role`,
      [String.raw`^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$`],
    );
    const ambiguous = await client.query(
      "SELECT COUNT(*)::int AS ambiguous_email_groups FROM (SELECT lower(email) FROM users GROUP BY lower(email) HAVING COUNT(*)>1) duplicates",
    );
    console.log(
      JSON.stringify(
        {
          activeColumnPresent: active,
          roles: result.rows,
          ...ambiguous.rows[0],
          policy:
            "Unsupported hashes, inactive users, admin roles and ambiguous emails cannot use public login. No resets or merges were performed.",
        },
        null,
        2,
      ),
    );
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Account audit failed.",
  );
  process.exitCode = 1;
});
