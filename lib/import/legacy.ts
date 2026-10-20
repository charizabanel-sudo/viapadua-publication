import { isBcryptHash } from "@/lib/auth/password";
import { legacyBookingReference } from "@/lib/booking/reference";
import type { Prisma } from "@/lib/generated/prisma/client";
import { parseMysqlDump, rowsAsObjects } from "./mysql-dump";

type Row = Record<string, string | null>;

export type LegacyImportPlan = {
  users: Prisma.UserCreateManyInput[];
  admins: Prisma.AdminCreateManyInput[];
  blockedDates: Prisma.BlockedDateCreateManyInput[];
  adminEvents: Prisma.AdminEventCreateManyInput[];
  chatMessages: Prisma.ChatMessageCreateManyInput[];
  bookings: Prisma.BookingCreateManyInput[];
  warnings: string[];
};

const req = (row: Row, key: string): string => {
  const v = row[key];
  if (v === null || v === undefined) throw new Error(`Missing required column "${key}"`);
  return v;
};
const opt = (row: Row, key: string): string | null => {
  const v = row[key];
  return v === undefined || v === null || v === "" ? null : v;
};
const int = (row: Row, key: string): number => {
  const n = Number(req(row, key));
  if (!Number.isInteger(n)) throw new Error(`Column "${key}" is not an integer`);
  return n;
};

/** MySQL DATE → UTC midnight; zero dates become null. */
function date(value: string | null): Date | null {
  if (!value || value.startsWith("0000")) return null;
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** TIMESTAMP columns: the dump sets time_zone = "+00:00", so values are UTC. */
function utcTimestamp(value: string | null): Date | undefined {
  if (!value || value.startsWith("0000")) return undefined;
  const d = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** DATETIME columns are stored without a zone; the legacy server ran on Philippine time. */
function manilaDatetime(value: string | null): Date | undefined {
  if (!value || value.startsWith("0000")) return undefined;
  const d = new Date(`${value.replace(" ", "T")}+08:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function json(value: string | null): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed === null ? undefined : (parsed as Prisma.InputJsonValue);
  } catch {
    return { legacyRaw: value };
  }
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildLegacyImportPlan(sql: string): LegacyImportPlan {
  const tables = parseMysqlDump(sql);
  const warnings: string[] = [];

  const userRows = rowsAsObjects(tables.get("users"));
  const usersById = new Map<number, Row>();
  const users: Prisma.UserCreateManyInput[] = userRows.map((r) => {
    usersById.set(int(r, "id"), r);
    return {
      id: int(r, "id"),
      fullname: req(r, "fullname"),
      email: req(r, "email"),
      phone: opt(r, "phone"),
      dob: date(opt(r, "dob")),
      address: opt(r, "address"),
      avatar: opt(r, "avatar"),
      password: req(r, "password"),
      role: pick(opt(r, "role"), ["user", "admin"] as const, "user"),
      createdAt: utcTimestamp(opt(r, "created_at")),
    };
  });

  const admins: Prisma.AdminCreateManyInput[] = [];
  for (const r of userRows) {
    if (opt(r, "role") !== "admin") continue;
    const hash = req(r, "password");
    if (!isBcryptHash(hash)) {
      warnings.push(`Admin user #${r.id} has a non-bcrypt password hash; not migrated. Create the admin with "npm run admin:create".`);
      continue;
    }
    admins.push({
      email: req(r, "email").trim().toLowerCase(),
      name: req(r, "fullname"),
      passwordHash: hash,
      legacyUserId: int(r, "id"),
    });
  }

  const blockedDates = rowsAsObjects(tables.get("blocked_dates")).flatMap((r) => {
    const d = date(opt(r, "date"));
    return d ? [{ id: int(r, "id"), date: d }] : [];
  });

  const adminEvents: Prisma.AdminEventCreateManyInput[] = rowsAsObjects(tables.get("admin_events")).flatMap((r) => {
    const eventDate = date(opt(r, "event_date"));
    if (!eventDate) {
      warnings.push(`admin_events #${r.id} has no valid date; skipped.`);
      return [];
    }
    return [
      {
        id: int(r, "id"),
        title: req(r, "title"),
        eventDate,
        eventTime: opt(r, "event_time"),
        type: pick(opt(r, "type"), ["mass", "sacrament", "meeting", "holiday", "other"] as const, "other"),
        location: opt(r, "location"),
        description: opt(r, "description"),
        createdAt: utcTimestamp(opt(r, "created_at")),
      },
    ];
  });

  const chatMessages: Prisma.ChatMessageCreateManyInput[] = rowsAsObjects(tables.get("chat_messages")).map((r) => ({
    id: int(r, "id"),
    userId: int(r, "user_id"),
    userEmail: req(r, "user_email"),
    sender: pick(opt(r, "sender"), ["user", "admin"] as const, "user"),
    text: req(r, "text"),
    createdAt: manilaDatetime(opt(r, "created_at")),
    adminSeen: opt(r, "admin_seen") === "1",
  }));

  const bookings: Prisma.BookingCreateManyInput[] = [];
  for (const r of rowsAsObjects(tables.get("bookings"))) {
    const id = int(r, "id");
    const userId = int(r, "user_id");
    const user = usersById.get(userId);
    const createdAt = utcTimestamp(opt(r, "created_at"));
    let details = json(opt(r, "details_json"));
    let bookingDate = date(opt(r, "booking_date"));
    if (!bookingDate) {
      // Keep the record: fall back to the submission date and preserve the original value.
      bookingDate = new Date(`${(createdAt ?? new Date(0)).toISOString().slice(0, 10)}T00:00:00Z`);
      const base = details && typeof details === "object" && !Array.isArray(details) ? details : details === undefined ? {} : { legacyDetails: details };
      details = { ...base, legacyInvalidBookingDate: opt(r, "booking_date") ?? "NULL" };
      warnings.push(`bookings #${id} has no valid booking_date; imported with its created_at date (original kept in details).`);
    }
    if (!user) warnings.push(`bookings #${id} references missing user #${userId}; user link dropped, booking kept.`);

    const d = details && typeof details === "object" && !Array.isArray(details) ? (details as Record<string, unknown>) : {};
    const fee = opt(r, "fee");

    bookings.push({
      id,
      reference: legacyBookingReference(id),
      userId: user ? userId : null,
      requesterName: (str(d.bookFullName) ?? str(d.certFullName) ?? user?.fullname ?? "Unknown").slice(0, 100),
      requesterEmail: (str(d.bookEmail) ?? str(d.certEmail) ?? user?.email ?? "").slice(0, 255),
      requesterPhone: (str(d.bookContact) ?? str(d.certContact) ?? user?.phone ?? null)?.slice(0, 30) ?? null,
      service: req(r, "service"),
      bookingDate,
      bookingTime: opt(r, "booking_time"),
      location: opt(r, "location"),
      status: pick(opt(r, "status"), ["pending", "confirmed", "completed", "cancelled"] as const, "pending"),
      fee: fee === null ? null : fee,
      paymentMethod: (() => {
        const m = opt(r, "payment_method");
        return m === "gcash" || m === "church" ? m : null;
      })(),
      // Historical value preserved as recorded by the legacy system.
      paymentStatus: pick(opt(r, "payment_status"), ["unpaid", "paid"] as const, "unpaid"),
      gcashName: opt(r, "gcash_name"),
      gcashNumber: opt(r, "gcash_number"),
      gcashReference: opt(r, "gcash_reference"),
      paymentProof: opt(r, "payment_proof"),
      notes: opt(r, "notes"),
      details,
      certificate: json(opt(r, "certificate_json")),
      source: "legacy",
      createdAt,
      updatedAt: utcTimestamp(opt(r, "updated_at")),
    });
  }

  return { users, admins, blockedDates, adminEvents, chatMessages, bookings, warnings };
}
