import type { NextRequest } from "next/server";
import { toCsv } from "@/lib/admin/csv";
import { recordsWhere } from "@/lib/admin/records";
import { exportRowsForWhere, getBookingExportRows, getReport, guestExportRows, normalizeReportFilters } from "@/lib/admin/reports";
import { isBookingStatus } from "@/lib/booking/queries";
import { todayInParish } from "@/lib/booking/schedule";
import { getAdminForRequest, sessionCookieName } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { fileError, fileResponse } from "@/lib/server/file-response";

export const dynamic = "force-dynamic";

/** CSV exports for Records and Reports. Admin session required; contains guest personal data. */
export async function GET(request: NextRequest) {
  const admin = await getAdminForRequest(request);
  if (!admin) {
    // No tokens, email addresses, report filters or guest details enter diagnostics.
    console.warn("[admin-export] session denied", { cookiePresent: Boolean(request.cookies.get(sessionCookieName())), secureOrigin: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" });
    return fileError("Sign in again on this website to download this report.", 401);
  }

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind");
  const db = getDb();
  let rows: string[][];
  let name: string;

  try {
    if (kind === "records") {
      const status = sp.get("status");
      rows = await exportRowsForWhere(db, recordsWhere({ q: sp.get("q") ?? undefined, status: isBookingStatus(status) ? status : undefined }));
      name = `ViaPadua_Records_${todayInParish()}`;
    } else if (kind === "bookings" || kind === "guests") {
      const filters = normalizeReportFilters({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined, service: sp.get("service") ?? undefined });
      rows = kind === "bookings" ? await getBookingExportRows(db, filters) : guestExportRows((await getReport(db, filters)).guests);
      name = `ViaPadua_${kind === "bookings" ? "Bookings" : "Guest_Bookings"}_${filters.from}_to_${filters.to}`;
    } else {
      return fileError("Unknown export", 400);
    }
  } catch (error) {
    console.error("[admin-export] failed", error instanceof Error ? error.message : "unknown");
    return fileError("The export could not be prepared. Please retry.", 503);
  }

  return fileResponse(toCsv(rows), { mime: "text/csv; charset=utf-8", filename: `${name}.csv` });
}
