import Link from "next/link";
import ActionButton from "@/components/admin/ActionButton";
import EventEditor from "@/components/admin/EventEditor";
import { getMonthData, normalizeMonth, shiftMonth } from "@/lib/admin/calendar";
import { EVENT_TYPE_LABEL, type EventRow } from "@/lib/admin/events";
import { formatDateLong, formatTime12h, isBlockedWeekday, todayInParish } from "@/lib/booking/schedule";
import { deleteEventAction, toggleBlockedDateAction } from "@/lib/server/actions/admin";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const monthParam = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const month = normalizeMonth(monthParam);
  const data = await getMonthData(getDb(), month);
  const today = todayInParish();

  const [year, mon] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, mon - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const leading = first.getUTCDay();
  const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const eventsByDate = new Map<string, EventRow[]>();
  for (const ev of data.events) eventsByDate.set(ev.date, [...(eventsByDate.get(ev.date) ?? []), ev]);
  const bookingsByDate = new Map<string, typeof data.bookings>();
  for (const b of data.bookings) bookingsByDate.set(b.date, [...(bookingsByDate.get(b.date) ?? []), b]);
  const blocked = new Set(data.blocked);

  const agenda = [
    ...data.events.map((e) => ({ kind: "event" as const, date: e.date, time: e.time, event: e })),
    ...data.bookings.map((b) => ({ kind: "booking" as const, date: b.date, time: b.time ?? "", booking: b })),
  ].sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));

  return (
    <>
      <header className="page-header with-actions">
        <div>
          <h1>Calendar</h1>
          <p>Parish events, guest bookings and dates closed to new bookings</p>
        </div>
        <EventEditor triggerClassName="btn btn-gold">
          <i className="fas fa-plus-circle" aria-hidden="true" /> Add Event
        </EventEditor>
      </header>

      <section className="card calendar-card" aria-labelledby="monthLabel">
        <div className="calendar-head">
          <h2 id="monthLabel">{monthLabel}</h2>
          <div className="calendar-nav">
            <Link className="btn btn-outline btn-sm" href={`/admin/calendar?month=${shiftMonth(month, -1)}`} aria-label="Previous month">
              <i className="fas fa-chevron-left" aria-hidden="true" />
            </Link>
            <Link className="btn btn-outline btn-sm" href="/admin/calendar">
              Today
            </Link>
            <Link className="btn btn-outline btn-sm" href={`/admin/calendar?month=${shiftMonth(month, 1)}`} aria-label="Next month">
              <i className="fas fa-chevron-right" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="calendar-scroll">
          <div className="cal-grid" role="grid" aria-label={monthLabel}>
            {WEEKDAYS.map((w) => (
              <div className="cal-weekday" role="columnheader" key={w}>
                {w}
              </div>
            ))}
            {Array.from({ length: leading }, (_, i) => (
              <div className="cal-day other" key={`lead-${i}`} aria-hidden="true" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const iso = `${month}-${String(day).padStart(2, "0")}`;
              const evs = eventsByDate.get(iso) ?? [];
              const bks = bookingsByDate.get(iso) ?? [];
              const isBlocked = blocked.has(iso);
              const isPast = iso < today;
              const chips = [...evs.map((e) => ({ kind: "event" as const, e })), ...bks.map((b) => ({ kind: "booking" as const, b }))];
              const cls = ["cal-day", iso === today ? "today" : "", isBlocked ? "blocked" : "", isBlockedWeekday(iso) ? "closed-weekday" : "", isPast ? "past" : ""]
                .filter(Boolean)
                .join(" ");
              return (
                <div className={cls} role="gridcell" key={iso} aria-label={`${formatDateLong(iso)}${isBlocked ? ", blocked" : ""}`}>
                  <div className="cal-day-head">
                    <span className="cal-num">{day}</span>
                    <div className="cal-actions">
                      <EventEditor defaultDate={iso} triggerClassName="icon-btn" triggerLabel={`Add event on ${formatDateLong(iso)}`}>
                        <i className="fas fa-plus" aria-hidden="true" />
                      </EventEditor>
                      {!isPast &&
                        (isBlocked ? (
                          <ActionButton
                            action={toggleBlockedDateAction}
                            fields={{ date: iso, mode: "unblock" }}
                            className="icon-btn"
                            ariaLabel={`Unblock ${formatDateLong(iso)}`}
                            title="Unblock date"
                            pendingLabel=""
                          >
                            <i className="fas fa-lock-open" aria-hidden="true" />
                          </ActionButton>
                        ) : (
                          <ActionButton
                            action={toggleBlockedDateAction}
                            fields={{ date: iso, mode: "block" }}
                            confirm={`Block ${formatDateLong(iso)} for new bookings?${bks.some((b) => b.status !== "completed") ? "\n\nExisting bookings on this date will be kept." : ""}`}
                            className="icon-btn danger"
                            ariaLabel={`Block ${formatDateLong(iso)} for bookings`}
                            title="Block date for bookings"
                            pendingLabel=""
                          >
                            <i className="fas fa-ban" aria-hidden="true" />
                          </ActionButton>
                        ))}
                    </div>
                  </div>
                  {isBlocked && <div className="blocked-badge">Blocked</div>}
                  {chips.slice(0, MAX_CHIPS).map((c) =>
                    c.kind === "event" ? (
                      <EventEditor key={`e${c.e.id}`} event={c.e} triggerClassName={`cal-chip ${c.e.type}`} triggerLabel={`Edit event: ${c.e.title}`}>
                        {c.e.title}
                      </EventEditor>
                    ) : (
                      <Link key={`b${c.b.id}`} className={`cal-chip booking ${c.b.status}`} href={`/admin/bookings?view=${c.b.id}`} title={`${c.b.service} · ${c.b.status}`}>
                        {c.b.time ? `${formatTime12h(c.b.time)} ` : ""}
                        {c.b.service}
                      </Link>
                    ),
                  )}
                  {chips.length > MAX_CHIPS && <span className="cal-more">+{chips.length - MAX_CHIPS} more</span>}
                </div>
              );
            })}
            {Array.from({ length: trailing }, (_, i) => (
              <div className="cal-day other" key={`trail-${i}`} aria-hidden="true" />
            ))}
          </div>
        </div>

        <div className="cal-legend" aria-label="Legend">
          {(["mass", "sacrament", "meeting", "holiday", "other"] as const).map((t) => (
            <span key={t}>
              <i className={`dot ${t}`} aria-hidden="true" /> {EVENT_TYPE_LABEL[t]}
            </span>
          ))}
          <span>
            <i className="dot booking" aria-hidden="true" /> Guest booking
          </span>
          <span>
            <i className="dot blocked" aria-hidden="true" /> Blocked date
          </span>
          <span className="muted">Sundays &amp; Tuesdays are always closed to bookings.</span>
        </div>
      </section>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="card" aria-labelledby="agendaTitle">
          <div className="card-head">
            <h2 id="agendaTitle">This Month</h2>
            <span className="sub">{agenda.length} item(s)</span>
          </div>
          {agenda.length === 0 ? (
            <div className="empty-state compact">
              <i className="fas fa-calendar" aria-hidden="true" />
              <p>No events or bookings this month.</p>
            </div>
          ) : (
            <ul className="list">
              {agenda.map((item) =>
                item.kind === "event" ? (
                  <li className="list-row" key={`e${item.event.id}`}>
                    <span className="agenda-date">{formatDateLong(item.date)}</span>
                    <div className="grow">
                      <strong>{item.event.title}</strong>
                      <span className="meta">
                        {[item.event.time, item.event.location].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </div>
                    <span className={`badge badge-type ${item.event.type}`}>{EVENT_TYPE_LABEL[item.event.type]}</span>
                    <EventEditor event={item.event} triggerClassName="icon-btn" triggerLabel={`Edit ${item.event.title}`}>
                      <i className="fas fa-pen" aria-hidden="true" />
                    </EventEditor>
                    <ActionButton
                      action={deleteEventAction}
                      fields={{ id: item.event.id }}
                      confirm={`Delete “${item.event.title}”? This cannot be undone.`}
                      className="icon-btn danger"
                      ariaLabel={`Delete ${item.event.title}`}
                      pendingLabel=""
                    >
                      <i className="fas fa-trash" aria-hidden="true" />
                    </ActionButton>
                  </li>
                ) : (
                  <li className="list-row" key={`b${item.booking.id}`}>
                    <span className="agenda-date">{formatDateLong(item.date)}</span>
                    <div className="grow">
                      <strong>{item.booking.service}</strong>
                      <span className="meta">
                        {item.booking.time ? `${formatTime12h(item.booking.time)} · ` : ""}
                        {item.booking.reference}
                      </span>
                    </div>
                    <Link className={`badge badge-${item.booking.status}`} href={`/admin/bookings?view=${item.booking.id}`}>
                      {item.booking.status}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="blockedTitle">
          <div className="card-head">
            <h2 id="blockedTitle">Blocked Dates</h2>
            <span className="sub">New guest bookings are refused on these dates</span>
          </div>
          {data.blocked.length === 0 ? (
            <p className="muted-text">No blocked dates this month. Use the <i className="fas fa-ban" aria-label="block" /> button on a day to block it.</p>
          ) : (
            <ul className="list">
              {data.blocked.map((iso) => (
                <li className="list-row" key={iso}>
                  <i className="fas fa-ban" style={{ color: "#c81e2c" }} aria-hidden="true" />
                  <div className="grow">
                    <strong>{formatDateLong(iso)}</strong>
                  </div>
                  {iso >= today && (
                    <ActionButton action={toggleBlockedDateAction} fields={{ date: iso, mode: "unblock" }} className="btn btn-outline btn-sm" pendingLabel="Unblocking…">
                      <i className="fas fa-lock-open" aria-hidden="true" /> Unblock
                    </ActionButton>
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
