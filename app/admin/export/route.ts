import type { NextRequest } from "next/server";
import { toCsv } from "@/lib/admin/csv";
import { recordsWhere } from "@/lib/admin/records";
import { exportRowsForWhere, getBookingExportRows, getReport, normalizeReportPeriod } from "@/lib/admin/reports";
import { isBookingStatus } from "@/lib/booking/queries";
import { todayInParish } from "@/lib/booking/schedule";
import { getAdminForRequest, sessionCookieName } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { fileError, fileResponse } from "@/lib/server/file-response";
import { renderSacramentReportPdf } from "@/lib/admin/report-pdf";

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
      name = `Via_Padua_Booking_Records_${todayInParish()}`;
    } else if (kind === "bookings") {
      const filters = normalizeReportPeriod({
        period: sp.get("period") ?? undefined,
        value: sp.get("value") ?? undefined,
        from: sp.get("from") ?? undefined,
        to: sp.get("to") ?? undefined,
        service: sp.get("service") ?? undefined,
      });
      rows = await getBookingExportRows(db, filters);
      name = `Via_Padua_Booking_Report_${filters.from}_to_${filters.to}`;
    } else {
      return fileError("Unknown export", 400);
    }
  } catch (error) {
    console.error("[admin-export] failed", error instanceof Error ? error.message : "unknown");
    return fileError("The export could not be prepared. Please retry.", 503);
  }

  if (kind === "bookings") {
    const reportFilters = normalizeReportPeriod({
      period: sp.get("period") ?? undefined,
      value: sp.get("value") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      service: sp.get("service") ?? undefined,
    });
    const report = await getReport(db, reportFilters);
    const pdf = await renderSacramentReportPdf({
      title: "Via Padua Parish Sacraments and Bookings Report",
      from: report.filters.from,
      to: report.filters.to,
      service: report.filters.service,
      rows,
      byService: report.byService,
    });
    return fileResponse(pdf, { mime: "application/pdf", filename: `${name}.pdf` });
  }

  return fileResponse(toCsv(rows), { mime: "text/csv; charset=utf-8", filename: `${name}.csv` });
}
