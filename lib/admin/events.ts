import { z } from "zod";
import type { Db } from "@/lib/db/client";
import type { AdminEventType } from "@/lib/generated/prisma/enums";
import { parseIsoDate, toIsoDate, todayInParish } from "@/lib/booking/schedule";

export const EVENT_TYPES: readonly AdminEventType[] = ["mass", "sacrament", "meeting", "holiday", "other"];

export const EVENT_TYPE_LABEL: Record<AdminEventType, string> = {
  mass: "Mass",
  sacrament: "Sacrament",
  meeting: "Meeting",
  holiday: "Holiday",
  other: "Other",
};

/** Legacy Events tabs: All / Mass Schedule / Parish Events / Special Celebrations (+ Holidays, Other). */
export const EVENT_TABS: readonly { key: "all" | AdminEventType; label: string }[] = [
  { key: "all", label: "All Events" },
  { key: "mass", label: "Mass Schedule" },
  { key: "meeting", label: "Parish Events" },
  { key: "sacrament", label: "Special Celebrations" },
  { key: "holiday", label: "Holidays" },
  { key: "other", label: "Other" },
];

export function isEventType(value: unknown): value is AdminEventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

const text = (max: number, label: string) =>
  z
    .string()
    .transform((v) => v.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""))
    .pipe(z.string().max(max, `${label} must be at most ${max} characters.`));

export const eventInputSchema = z.object({
  title: text(200, "Title").pipe(z.string().min(1, "Event title is required.")),
  date: z
    .string()
    .trim()
    .refine((v) => parseIsoDate(v) !== null && v >= "2000-01-01" && v <= "2100-12-31", "Choose a valid date."),
  time: text(50, "Time"),
  type: z.string().refine(isEventType, "Choose an event type."),
  location: text(200, "Location"),
  description: text(2000, "Description"),
});

export type EventInput = {
  title: string;
  date: string;
  time: string;
  type: AdminEventType;
  location: string;
  description: string;
};

export type EventValidation = { ok: true; data: EventInput } | { ok: false; fieldErrors: Record<string, string> };

export function validateEventInput(raw: Record<string, unknown>): EventValidation {
  const parsed = eventInputSchema.safeParse({
    title: String(raw.title ?? ""),
    date: String(raw.date ?? ""),
    time: String(raw.time ?? ""),
    type: String(raw.type ?? ""),
    location: String(raw.location ?? ""),
    description: String(raw.description ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, fieldErrors };
  }
  return { ok: true, data: { ...parsed.data, type: parsed.data.type as AdminEventType } };
}

export type EventRow = {
  id: number;
  title: string;
  date: string;
  time: string;
  type: AdminEventType;
  location: string;
  description: string;
};

function toRow(e: {
  id: number;
  title: string;
  eventDate: Date;
  eventTime: string | null;
  type: AdminEventType;
  location: string | null;
  description: string | null;
}): EventRow {
  return {
    id: e.id,
    title: e.title,
    date: toIsoDate(e.eventDate),
    time: e.eventTime ?? "",
    type: e.type,
    location: e.location ?? "",
    description: e.description ?? "",
  };
}

const rowSelect = { id: true, title: true, eventDate: true, eventTime: true, type: true, location: true, description: true } as const;

export type EventScope = "upcoming" | "past" | "all";

/** Events list for the Events module. Upcoming: soonest first; past: most recent first. */
export async function listEvents(db: Db, opts: { type?: AdminEventType; scope?: EventScope; now?: Date } = {}) {
  const today = parseIsoDate(todayInParish(opts.now))!;
  const scope = opts.scope ?? "upcoming";
  const where = {
    ...(opts.type ? { type: opts.type } : {}),
    ...(scope === "upcoming" ? { eventDate: { gte: today } } : scope === "past" ? { eventDate: { lt: today } } : {}),
  };
  const [rows, grouped] = await Promise.all([
    db.adminEvent.findMany({
      where,
      select: rowSelect,
      orderBy: scope === "past" ? [{ eventDate: "desc" }, { id: "desc" }] : [{ eventDate: "asc" }, { id: "asc" }],
      take: 300,
    }),
    db.adminEvent.groupBy({
      by: ["type"],
      where: scope === "upcoming" ? { eventDate: { gte: today } } : scope === "past" ? { eventDate: { lt: today } } : {},
      _count: { _all: true },
    }),
  ]);
  const counts: Record<"all" | AdminEventType, number> = { all: 0, mass: 0, sacrament: 0, meeting: 0, holiday: 0, other: 0 };
  for (const g of grouped) {
    counts[g.type] = g._count._all;
    counts.all += g._count._all;
  }
  return { events: rows.map(toRow), counts };
}

export async function listEventsBetween(db: Db, fromIso: string, toIsoExclusive: string): Promise<EventRow[]> {
  const rows = await db.adminEvent.findMany({
    where: { eventDate: { gte: parseIsoDate(fromIso)!, lt: parseIsoDate(toIsoExclusive)! } },
    select: rowSelect,
    orderBy: [{ eventDate: "asc" }, { id: "asc" }],
  });
  return rows.map(toRow);
}

function toData(input: EventInput) {
  return {
    title: input.title,
    eventDate: parseIsoDate(input.date)!,
    eventTime: input.time || null,
    type: input.type,
    location: input.location || null,
    description: input.description || null,
  };
}

export async function createEvent(db: Db, input: EventInput): Promise<EventRow> {
  return toRow(await db.adminEvent.create({ data: toData(input), select: rowSelect }));
}

/** Returns null when the event no longer exists. */
export async function updateEvent(db: Db, id: number, input: EventInput): Promise<EventRow | null> {
  const result = await db.adminEvent.updateMany({ where: { id }, data: toData(input) });
  if (result.count === 0) return null;
  return toRow(await db.adminEvent.findUniqueOrThrow({ where: { id }, select: rowSelect }));
}

export async function deleteEvent(db: Db, id: number): Promise<boolean> {
  const result = await db.adminEvent.deleteMany({ where: { id } });
  return result.count > 0;
}
