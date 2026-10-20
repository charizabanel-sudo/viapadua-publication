/**
 * Creates an admin account (or resets an admin's password). The password is
 * prompted for without echo — it never appears in shell history or env files.
 *
 *   npm run admin:create -- --email admin@example.com --name "Parish Admin"
 *   npm run admin:create -- --email admin@example.com --reset-password
 */
import { createInterface } from "node:readline";
import { config } from "dotenv";
import { z } from "zod";
import { MIN_ADMIN_PASSWORD_LENGTH, hashPassword } from "@/lib/auth/password";
import { createPrismaClient } from "@/lib/db/client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let pipedLines: Promise<string[]> | null = null;

/** Reads all piped stdin once (non-interactive use, e.g. CI). */
function readPipedLines(): Promise<string[]> {
  pipedLines ??= new Promise((resolve) => {
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines));
  });
  return pipedLines;
}

let pipedIndex = 0;

async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const lines = await readPipedLines();
    return lines[pipedIndex++] ?? "";
  }
  process.stdout.write(question);
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

const argsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Provide a valid --email.")),
  name: z.string().trim().min(2, "Provide --name (at least 2 characters).").max(100).optional(),
});

async function main() {
  const reset = process.argv.includes("--reset-password");
  const parsed = argsSchema.safeParse({ email: arg("--email") ?? "", name: arg("--name") });
  if (!parsed.success) {
    console.error(parsed.error.issues.map((i) => i.message).join("\n"));
    console.error('Usage: npm run admin:create -- --email admin@example.com --name "Parish Admin" [--reset-password]');
    process.exit(1);
  }
  const { email, name } = parsed.data;
  if (!reset && !name) {
    console.error('Provide --name "Full Name" for a new admin.');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env.local.");
    process.exit(1);
  }

  const db = createPrismaClient(url);
  try {
    const existing = await db.admin.findUnique({ where: { email }, select: { id: true } });
    if (existing && !reset) {
      console.error(`An admin with ${email} already exists. Use --reset-password to change its password.`);
      process.exit(1);
    }
    if (!existing && reset) {
      console.error(`No admin with ${email} exists.`);
      process.exit(1);
    }

    const password = await promptHidden(`Password for ${email} (min ${MIN_ADMIN_PASSWORD_LENGTH} chars): `);
    const confirm = await promptHidden("Confirm password: ");
    if (password !== confirm) throw new Error("Passwords do not match.");
    if (password.length < MIN_ADMIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);
    if (password.length > 200) throw new Error("Password is too long (max 200 characters).");
    if (password.toLowerCase().includes(email.split("@")[0])) throw new Error("Password must not contain the email name.");

    const passwordHash = await hashPassword(password);
    if (existing) {
      await db.$transaction([
        db.admin.update({ where: { id: existing.id }, data: { passwordHash, isActive: true } }),
        db.adminSession.deleteMany({ where: { adminId: existing.id } }),
      ]);
      console.log(`Password updated for ${email}. Existing sessions were signed out.`);
    } else {
      await db.admin.create({ data: { email, name: name!, passwordHash } });
      console.log(`Admin ${email} created. Sign in from the homepage menu (or open /?login=1).`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
