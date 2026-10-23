import type { Db } from "@/lib/db/client";
import type { BookingStatus, Prisma } from "@/lib/generated/prisma/client";
import { EXCLUDE_SAMPLES, ONLY_SAMPLES } from "@/lib/booking/samples";

export const BOOKING_STATUSES: readonly BookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];
export const ADMIN_PAGE_SIZE = 20;

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (BOOKING_STATUSES as readonly string[]).includes(value);
}

/** `samples: "only"` lists the fictional Sample/Demo bookings, which are hidden otherwise. */
export type BookingFilters = { q?: string; status?: BookingStatus; page?: number; samples?: "only" };

const listSelect = {
  id: true,
  reference: true,
  requesterName: true,
  requesterEmail: true,
  service: true,
  bookingDate: true,
  bookingTime: true,
  status: true,
  fee: true,
  paymentMethod: true,
  paymentStatus: true,
  gcashReference: true,
  source: true,
  createdAt: true,
} satisfies Prisma.BookingSelect;

export type BookingListItem = Prisma.BookingGetPayload<{ select: typeof listSelect }>;

/** Admin list: pending first (enum order), newest first. Heavy columns (receipts, JSON) are excluded. */
export async function listBookings(db: Db, filters: BookingFilters): Promise<{ items: BookingListItem[]; total: number; page: number; pages: number }> {
  const q = filters.q?.trim().slice(0, 100);
  const where: Prisma.BookingWhereInput = {
    ...(filters.samples === "only" ? ONLY_SAMPLES : EXCLUDE_SAMPLES),
    ...(filters.status ? { status: filters.status } : {}),
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" } },
            { requesterName: { contains: q, mode: "insensitive" } },
            { requesterEmail: { contains: q, mode: "insensitive" } },
            { service: { contains: q, mode: "insensitive" } },
            { gcashReference: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const total = await db.booking.count({ where });
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pages);
  const items = await db.booking.findMany({
    where,
    select: listSelect,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ADMIN_PAGE_SIZE,
    take: ADMIN_PAGE_SIZE,
  });
  return { items, total, page, pages };
}

export async function getBookingDetail(db: Db, id: number) {
  return db.booking.findUnique({
    where: { id },
    include: {
      statusChangedBy: { select: { name: true } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { admin: { select: { name: true } } } },
    },
  });
}

export type BookingDetail = NonNullable<Awaited<ReturnType<typeof getBookingDetail>>>;
