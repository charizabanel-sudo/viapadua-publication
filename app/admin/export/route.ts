import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/admin/csv";
import { recordsWhere } from "@/lib/admin/records";
import { exportRowsForWhere, getBookingExportRows, getReport, guestExportRows, normalizeReportFilters } from "@/lib/admin/reports";
import { isBookingStatus } from "@/lib/booking/queries";
import { todayInParish } from "@/lib/booking/schedule";
import { getAdminForRequest, sessionCookieName } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** CSV exports for Records and Reports. Admin session required; contains guest personal data. */
export async function GET(request: NextRequest) {
  const admin = await getAdminForRequest(request);
  if (!admin) {
    // No tokens, email addresses, report filters or guest details enter diagnostics.
    console.warn("[admin-export] session denied", { cookiePresent: Boolean(request.cookies.get(sessionCookieName())), secureOrigin: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" });
    return new NextResponse("Sign in again on this website to download this report.", { status: 401, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  }

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind");
  const db = getDb();
  let rows: string[][];
  let name: string;

  if (kind === "records") {
    const status = sp.get("status");
    rows = await exportRowsForWhere(db, recordsWhere({ q: sp.get("q") ?? undefined, status: isBookingStatus(status) ? status : undefined }));
    name = `ViaPadua_Records_${todayInParish()}`;
  } else if (kind === "bookings" || kind === "guests") {
    const filters = normalizeReportFilters({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined, service: sp.get("service") ?? undefined });
    rows = kind === "bookings" ? await getBookingExportRows(db, filters) : guestExportRows((await getReport(db, filters)).guests);
    name = `ViaPadua_${kind === "bookings" ? "Bookings" : "Guest_Bookings"}_${filters.from}_to_${filters.to}`;
  } else {
    return new NextResponse("Unknown export", { status: 400 });
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
      "Vary": "Cookie",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
