import PrintButton from "@/components/admin/PrintButton";
import { EVENT_TYPE_LABEL } from "@/lib/admin/events";
import { getReport, normalizeReportFilters } from "@/lib/admin/reports";
import { formatPeso } from "@/lib/booking/catalog";
import { formatDateLong } from "@/lib/booking/schedule";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function Bar({ label, value, total, tone }: { label: string; value: number; total: number; tone?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">
        <span>{label}</span>
        <span>
          {value} <span className="muted">({pct}%)</span>
        </span>
      </div>
      <div className="bar-track" role="img" aria-label={`${label}: ${value} (${pct}%)`}>
        <div className={`bar-fill${tone ? ` ${tone}` : ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = normalizeReportFilters({ from: first(sp.from), to: first(sp.to), service: first(sp.service) });
  const report = await getReport(getDb(), filters);
  const s = report.summary;
  const total = s.totalBookings;
  const query = new URLSearchParams({ from: filters.from, to: filters.to, ...(filters.service !== "all" ? { service: filters.service } : {}) }).toString();

  return (
    <>
      <header className="page-header with-actions">
        <div>
          <h1>Reports &amp; Analytics</h1>
          <p>Guest booking statistics for the selected period (by service date)</p>
        </div>
        <div className="page-actions no-print">
          <PrintButton label="Print report" />
          <a className="btn btn-primary" href={`/admin/export?kind=bookings&${query}`} download>
            <i className="fas fa-download" aria-hidden="true" /> Bookings CSV
          </a>
          <a className="btn btn-primary" href={`/admin/export?kind=guests&${query}`} download>
            <i className="fas fa-download" aria-hidden="true" /> Guest report CSV
          </a>
        </div>
      </header>

      <div className="print-only print-heading">
        <strong>Via Padua Parish — Booking Report</strong>
        <span>
          {formatDateLong(filters.from)} – {formatDateLong(filters.to)} · {filters.service === "all" ? "All services" : filters.service} · Generated{" "}
          {new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}
        </span>
      </div>

      <form className="toolbar no-print" action="/admin/reports" method="get">
        <div className="field">
          <label htmlFor="rp-from">From</label>
          <input id="rp-from" type="date" name="from" defaultValue={filters.from} required />
        </div>
        <div className="field">
          <label htmlFor="rp-to">To</label>
          <input id="rp-to" type="date" name="to" defaultValue={filters.to} required />
        </div>
        <div className="field grow">
          <label htmlFor="rp-service">Service</label>
          <select id="rp-service" name="service" defaultValue={filters.service}>
            <option value="all">All services</option>
            {report.services.map((svc) => (
              <option key={svc} value={svc}>
                {svc}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          <i className="fas fa-filter" aria-hidden="true" /> Apply
        </button>
      </form>

      <section className="stats-grid" aria-label="Summary">
        <div className="stat-card navy">
          <span className="stat-label">Total bookings</span>
          <span className="stat-value">{total}</span>
          <span className="stat-note">{s.pending} pending · {s.confirmed} confirmed</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Unique guest requesters</span>
          <span className="stat-value">{s.uniqueGuests}</span>
          <span className="stat-note">Distinct contact emails (no accounts)</span>
        </div>
        <div className="stat-card green">
          <span className="stat-label">Payments verified</span>
          <span className="stat-value">{formatPeso(s.paidAmount)}</span>
          <span className="stat-note">{s.paidCount} booking(s) marked paid</span>
        </div>
        <div className="stat-card red">
          <span className="stat-label">Awaiting payment</span>
          <span className="stat-value">{formatPeso(s.outstandingAmount)}</span>
          <span className="stat-note">{s.outstandingCount} unpaid, not cancelled</span>
        </div>
        <div className="stat-card blue">
          <span className="stat-label">Church events</span>
          <span className="stat-value">{s.totalEvents}</span>
          <span className="stat-note">On the calendar in this period</span>
        </div>
      </section>

      {total === 0 && (
        <div className="notice info" role="status">
          <i className="fas fa-circle-info" aria-hidden="true" /> No bookings in this period. Try a wider date range.
        </div>
      )}

      <div className="grid-2 report-grid">
        <section className="card" aria-labelledby="bySvc">
          <div className="card-head">
            <h2 id="bySvc">Bookings by Service</h2>
          </div>
          {report.byService.length === 0 ? <p className="muted-text">No data.</p> : report.byService.map((b) => <Bar key={b.label} label={b.label} value={b.count} total={total} />)}
        </section>
        <section className="card" aria-labelledby="byStatus">
          <div className="card-head">
            <h2 id="byStatus">Booking Status Overview</h2>
          </div>
          <Bar label="Pending" value={report.byStatus.pending} total={total} tone="amber" />
          <Bar label="Confirmed" value={report.byStatus.confirmed} total={total} tone="green" />
          <Bar label="Completed" value={report.byStatus.completed} total={total} tone="blue" />
          <Bar label="Cancelled" value={report.byStatus.cancelled} total={total} tone="red" />
          <h3 className="mini-title" style={{ marginTop: 20 }}>
            Payment method
          </h3>
          <Bar label="Pay at the church" value={report.byMethod.church} total={total} tone="navy" />
          <Bar label="GCash (verified manually)" value={report.byMethod.gcash} total={total} tone="navy" />
          {report.byMethod.none > 0 && <Bar label="Not specified (legacy)" value={report.byMethod.none} total={total} tone="navy" />}
        </section>
      </div>

      <section className="card" aria-labelledby="evType" style={{ marginTop: 20 }}>
        <div className="card-head">
          <h2 id="evType">Events by Type</h2>
        </div>
        <div className="mini-stats">
          {(["mass", "sacrament", "meeting", "holiday", "other"] as const).map((t) => (
            <div key={t} className="mini-stat">
              <span className={`badge badge-type ${t}`}>{EVENT_TYPE_LABEL[t]}</span>
              <strong>{report.eventsByType[t]}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="guestReport" style={{ marginTop: 20 }}>
        <div className="card-head">
          <div>
            <h2 id="guestReport">Guest Booking Report</h2>
            <div className="sub">Grouped by contact email · guests book without accounts</div>
          </div>
          <span className="sub">{report.guests.length} guest(s){report.guests.length === 500 ? " (first 500)" : ""}</span>
        </div>
        {report.guests.length === 0 ? (
          <div className="empty-state compact">
            <i className="fas fa-users" aria-hidden="true" />
            <p>No guest bookings in this period.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col" className="num">Bookings</th>
                  <th scope="col" className="num">Active</th>
                  <th scope="col" className="num">Completed</th>
                  <th scope="col" className="num">Cancelled</th>
                  <th scope="col" className="num">Paid</th>
                  <th scope="col">Last booking</th>
                </tr>
              </thead>
              <tbody>
                {report.guests.map((g) => (
                  <tr key={g.email}>
                    <td>
                      <strong>{g.name}</strong>
                    </td>
                    <td>{g.email}</td>
                    <td className="muted">{g.phone || "—"}</td>
                    <td className="num">{g.bookings}</td>
                    <td className="num">{g.active}</td>
                    <td className="num">{g.completed}</td>
                    <td className="num">{g.cancelled}</td>
                    <td className="num">{formatPeso(g.paidTotal)}</td>
                    <td>{formatDateLong(g.lastBooking)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
