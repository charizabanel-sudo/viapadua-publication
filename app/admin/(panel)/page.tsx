import Link from "next/link";
import { getDashboardData } from "@/lib/admin/dashboard";
import { EVENT_TYPE_LABEL } from "@/lib/admin/events";
import { formatDateLong, formatTime12h, parseIsoDate } from "@/lib/booking/schedule";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import type { AdminEventType } from "@/lib/generated/prisma/enums";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", hour12: false }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function DateChip({ iso }: { iso: string }) {
  const d = parseIsoDate(iso)!;
  return (
    <div className="date-chip" aria-hidden="true">
      <span className="m">{MONTHS[d.getUTCMonth()]}</span>
      <span className="d">{d.getUTCDate()}</span>
    </div>
  );
}

export default async function DashboardPage() {
  const admin = await requireAdmin();
  const now = new Date();
  const data = await getDashboardData(getDb(), now);
  const maxService = Math.max(1, ...data.byService.map((s) => s.count));
  const maxMonth = Math.max(1, ...data.monthly.map((m) => m.count));

  return (
    <>
      <header className="page-header">
        <p className="dash-date">{formatDateLong(data.today)}</p>
        <h1>
          {greeting(now)}, <span className="gold-text">{admin.name}</span>
        </h1>
        <p>
          {data.counts.pending === 0
            ? "No booking requests are waiting for approval."
            : `${data.counts.pending} booking request${data.counts.pending === 1 ? " is" : "s are"} waiting for your approval.`}
        </p>
      </header>

      <section className="stats-grid" aria-label="Key numbers">
        <Link className="stat-card navy" href="/admin/bookings?status=pending">
          <i className="fas fa-cross stat-icon" aria-hidden="true" />
          <span className="stat-label">Waiting for approval</span>
          <span className="stat-value">{data.counts.pending}</span>
          <span className="stat-note">Pending guest bookings</span>
        </Link>
        <Link className="stat-card" href="/admin/calendar">
          <i className="fas fa-calendar-check stat-icon" aria-hidden="true" />
          <span className="stat-label">Bookings this month</span>
          <span className="stat-value">{data.counts.bookingsMonth}</span>
          <span className="stat-note">Scheduled this month, excluding cancelled</span>
        </Link>
        <Link className="stat-card blue" href="/admin/events">
          <i className="fas fa-dove stat-icon" aria-hidden="true" />
          <span className="stat-label">Events, next 30 days</span>
          <span className="stat-value">{data.counts.eventsNext30}</span>
          <span className="stat-note">On the parish calendar</span>
        </Link>
        <Link className="stat-card red" href="/admin/records?status=confirmed">
          <i className="fas fa-receipt stat-icon" aria-hidden="true" />
          <span className="stat-label">Awaiting payment</span>
          <span className="stat-value">{data.counts.unpaidActive}</span>
          <span className="stat-note">Pending/confirmed and unpaid</span>
        </Link>
      </section>

      <div className="grid-2">
        <div className="stack">
          <section className="card" aria-labelledby="pendingTitle">
            <div className="card-head">
              <div>
                <h2 id="pendingTitle">Requests Awaiting Approval</h2>
                <div className="sub">
                  Oldest first{data.counts.pending > data.pending.length ? ` · showing ${data.pending.length} of ${data.counts.pending}` : ""}
                </div>
              </div>
              <Link className="card-link" href="/admin/bookings?status=pending">
                Open all bookings →
              </Link>
            </div>
            {data.pending.length === 0 ? (
              <div className="empty-state compact">
                <i className="fas fa-check-circle" aria-hidden="true" />
                <p>Nothing is waiting for you.</p>
                <p>New guest booking requests will appear here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Requested by</th>
                      <th scope="col">Service</th>
                      <th scope="col">For</th>
                      <th scope="col">Waiting</th>
                      <th scope="col">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pending.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <div className="muted">{p.reference}</div>
                        </td>
                        <td>{p.service}</td>
                        <td>
                          {formatDateLong(p.date)}
                          {p.time ? ` · ${formatTime12h(p.time)}` : ""}
                        </td>
                        <td>
                          <span className={`waiting${p.waitingDays >= 3 ? " late" : ""}`}>
                            {p.waitingDays === 0 ? "Today" : `${p.waitingDays} day${p.waitingDays === 1 ? "" : "s"}`}
                          </span>
                        </td>
                        <td>
                          <Link className="btn btn-blue btn-sm" href={`/admin/bookings?view=${p.id}`}>
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="activityTitle">
            <div className="card-head">
              <div>
                <h2 id="activityTitle">Booking Activity</h2>
                <div className="sub">{data.today.slice(0, 4)}, excluding cancelled bookings</div>
              </div>
              <Link className="card-link" href="/admin/reports">
                Reports →
              </Link>
            </div>
            <h3 className="mini-title">By service</h3>
            {data.byService.length === 0 ? (
              <p className="muted-text">No bookings yet this year.</p>
            ) : (
              data.byService.map((s) => (
                <div className="bar-row" key={s.label}>
                  <div className="bar-label">
                    <span>{s.label}</span>
                    <span>{s.count}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(s.count / maxService) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
            <h3 className="mini-title" style={{ marginTop: 22 }}>
              Bookings per month
            </h3>
            <div className="month-bars" role="img" aria-label={data.monthly.map((m, i) => `${MONTHS[i]}: ${m.count}`).join(", ")}>
              {data.monthly.map((m, i) => (
                <div className="col" key={m.ym}>
                  <span className="val">{m.count || ""}</span>
                  <div className="bar" style={{ height: `${(m.count / maxMonth) * 100}%` }} />
                  <span className="lbl">{MONTHS[i]}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="card" aria-labelledby="scheduleTitle">
          <div className="card-head">
            <div>
              <h2 id="scheduleTitle">Coming Up</h2>
              <div className="sub">Next 14 days · bookings and events</div>
            </div>
            <Link className="card-link" href="/admin/calendar">
              Calendar →
            </Link>
          </div>
          {data.schedule.length === 0 ? (
            <div className="empty-state compact">
              <i className="fas fa-calendar" aria-hidden="true" />
              <p>Nothing scheduled in the next 14 days.</p>
            </div>
          ) : (
            <ul className="list">
              {data.schedule.map((item) => (
                <li className="list-row" key={`${item.kind}-${item.id}`}>
                  <DateChip iso={item.date} />
                  <div className="grow">
                    <strong>{item.title}</strong>
                    <span className="meta">
                      {item.time ? `${formatTime12h(item.time)} · ` : ""}
                      {item.who}
                    </span>
                  </div>
                  {item.kind === "booking" ? (
                    <Link className={`badge badge-${item.status}`} href={`/admin/bookings?view=${item.id}`}>
                      {item.status === "pending" ? "Pending" : "Confirmed"}
                    </Link>
                  ) : (
                    <span className={`badge badge-type ${item.eventType}`}>{EVENT_TYPE_LABEL[item.eventType as AdminEventType]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
