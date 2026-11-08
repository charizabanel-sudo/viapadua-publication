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

  try {
    if (kind === "records") {
      const status = sp.get("status");
      const rows = await exportRowsForWhere(db, recordsWhere({ q: sp.get("q") ?? undefined, status: isBookingStatus(status) ? status : undefined }));
      if (sp.get("format") === "pdf") {
        const today = todayInParish();
        const serviceCounts = new Map<string, number>();
        for (const row of rows.slice(1)) {
          const service = row[1] || "Other";
          serviceCounts.set(service, (serviceCounts.get(service) ?? 0) + 1);
        }
        const pdf = await renderSacramentReportPdf({
          title: "Manage Records Report",
          from: "All filtered",
          to: "booking records",
          service: "All services",
          rows,
          byService: [...serviceCounts].map(([label, count]) => ({ label, count })),
        });
        return fileResponse(pdf, { mime: "application/pdf", filename: `Via_Padua_Manage_Records_${today}.pdf` });
      }
      return fileResponse(toCsv(rows), { mime: "text/csv; charset=utf-8", filename: `Via_Padua_Booking_Records_${todayInParish()}.csv` });
    }

    if (kind === "bookings") {
      const filters = normalizeReportPeriod({
        period: sp.get("period") ?? undefined,
        value: sp.get("value") ?? undefined,
        from: sp.get("from") ?? undefined,
        to: sp.get("to") ?? undefined,
        service: sp.get("service") ?? undefined,
      });
      const [rows, report] = await Promise.all([getBookingExportRows(db, filters), getReport(db, filters)]);
      const pdf = await renderSacramentReportPdf({
        title: "List of Sacraments / Services Report",
        from: report.filters.from,
        to: report.filters.to,
        service: report.filters.service,
        rows,
        byService: report.byService,
        guests: report.guests,
      });
      return fileResponse(pdf, { mime: "application/pdf", filename: `Via_Padua_Sacraments_Report_${filters.from}_to_${filters.to}.pdf` });
    }

    return fileError("Unknown export", 400);
  } catch (error) {
    // Always answer with a proper error response (never Next's HTML error page).
    console.error("[admin-export] failed", error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : "unknown");
    return fileError("The export could not be prepared. Please retry.", 503);
  }
}