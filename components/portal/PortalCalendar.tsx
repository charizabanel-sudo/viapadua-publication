"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ServicesLink } from "@/components/public/PublicOverlayProvider";
import { addDays } from "@/lib/booking/schedule";
import { dayState, longDate, monthLabel, monthWeeks, type DayState, type PortalCalendarData, type PortalCalendarItem } from "@/lib/portal/calendar-grid";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATE_TEXT: Record<DayState, string> = {
  past: "Past date",
  closed: "Closed for online booking (Sundays and Tuesdays)",
  blocked: "Unavailable: blocked by the parish office",
  too_far: "Beyond the booking window",
  open: "Open for booking requests",
};
const STATUS_TEXT: Record<string, string> = { pending: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" };

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

function ItemDetails({ item, showDate }: { item: PortalCalendarItem; showDate: boolean }) {
  const mine = item.kind === "booking";
  return (
    <li className={`cal-item ${mine ? "mine" : "event"}`}>
      <details>
        <summary>
          <span className="cal-item-badge">{mine ? "Your booking" : "Parish event"}</span>
          <span className="cal-item-title">{mine ? item.service : item.title}</span>
          <span className="cal-item-meta">
            {showDate && <>{shortDate(item.date)} · </>}
            {item.time || "Time to be announced"}
            {mine && <span className={`cal-status ${item.status}`}>{STATUS_TEXT[item.status] ?? item.status}</span>}
          </span>
        </summary>
        <dl className="cal-item-body">
          <div><dt>Date</dt><dd>{longDate(item.date)}</dd></div>
          {item.time && <div><dt>Time</dt><dd>{item.time}</dd></div>}
          {mine ? (
            <>
              <div><dt>Reference</dt><dd>{item.reference}</dd></div>
              <div><dt>Payment</dt><dd>{item.paymentStatus === "paid" ? "Verified paid" : "Not yet verified"}</dd></div>
              <div><dt>Manage</dt><dd><Link href="/portal?tab=bookings">Open My Bookings</Link></dd></div>
            </>
          ) : (
            <>
              {item.location && <div><dt>Location</dt><dd>{item.location}</dd></div>}
              {item.description && <div><dt>About</dt><dd>{item.description}</dd></div>}
            </>
          )}
        </dl>
      </details>
    </li>
  );
}

export default function PortalCalendar({ data, prevHref, nextHref, todayHref }: { data: PortalCalendarData; prevHref: string; nextHref: string; todayHref: string }) {
  const { month, today } = data;
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const blocked = useMemo(() => new Set(data.blocked), [data.blocked]);
  const byDate = useMemo(() => {
    const map = new Map<string, PortalCalendarItem[]>();
    for (const item of data.items) map.set(item.date, [...(map.get(item.date) ?? []), item]);
    return map;
  }, [data.items]);
  const inMonth = today.startsWith(month);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState(() => (inMonth ? today : `${month}-01`));
  const gridRef = useRef<HTMLTableElement>(null);

  const moveFocus = (iso: string) => {
    if (!iso.startsWith(month)) return;
    setFocusDay(iso);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${iso}"]`)?.focus());
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, iso: string) => {
    const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    if (event.key in step) {
      event.preventDefault();
      moveFocus(addDays(iso, step[event.key]));
    }
  };

  const selectedItems = selected ? (byDate.get(selected) ?? []) : [];
  const selectedState = selected ? dayState(selected, today, blocked) : null;
  const reservedTimes = selected ? (data.reserved[selected] ?? []) : [];

  return (
    <div className="portal-calendar">
      <section className="cal-card" aria-labelledby="cal-title">
        <header className="cal-head">
          <h2 id="cal-title">
            <i className="fas fa-calendar-alt" aria-hidden="true" /> {monthLabel(month)}
          </h2>
          <nav className="cal-nav" aria-label="Change month">
            <Link href={prevHref} aria-label="Previous month" className="cal-nav-btn">
              <i className="fas fa-chevron-left" aria-hidden="true" />
            </Link>
            {!inMonth && (
              <Link href={todayHref} className="cal-nav-today">
                Today
              </Link>
            )}
            <Link href={nextHref} aria-label="Next month" className="cal-nav-btn">
              <i className="fas fa-chevron-right" aria-hidden="true" />
            </Link>
          </nav>
        </header>
        <p className="sr-only" id="cal-help">
          Use arrow keys to move between days. Press Enter to show a day&apos;s details.
        </p>
        <table className="cal-grid" ref={gridRef} aria-labelledby="cal-title" aria-describedby="cal-help">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th key={d} scope="col" abbr={d}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((iso, i) => {
                  if (!iso) return <td key={i} className="cal-empty" />;
                  const items = byDate.get(iso) ?? [];
                  const state = dayState(iso, today, blocked);
                  const mine = items.some((x) => x.kind === "booking");
                  const events = items.some((x) => x.kind === "event");
                  const label = [longDate(iso), iso === today ? "today" : "", mine ? "your booking" : "", events ? "parish event" : "", items.length > 1 ? `${items.length} items` : "", state !== "open" ? STATE_TEXT[state] : ""].filter(Boolean).join(", ");
                  return (
                    <td key={iso}>
                      <button
                        type="button"
                        data-date={iso}
                        className={`cal-day ${state}${iso === today ? " today" : ""}${selected === iso ? " selected" : ""}${mine ? " has-mine" : ""}${events ? " has-event" : ""}`}
                        tabIndex={iso === focusDay ? 0 : -1}
                        aria-pressed={selected === iso}
                        aria-label={label}
                        onFocus={() => setFocusDay(iso)}
                        onKeyDown={(e) => onKey(e, iso)}
                        onClick={() => setSelected((s) => (s === iso ? null : iso))}
                      >
                        <span className="cal-num">{Number(iso.slice(8))}</span>
                        {items.length > 0 && (
                          <span className="cal-dots" aria-hidden="true">
                            {mine && <span className="dot mine" />}
                            {events && <span className="dot event" />}
                            {items.length > 1 && <span className="cal-count">{items.length}</span>}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="cal-side">
        <section className="cal-card cal-agenda" aria-labelledby="agenda-title">
          <p className="sr-only" role="status">{selected ? `Showing details for ${longDate(selected)}` : ""}</p>
          <header className="cal-agenda-head">
            <h2 id="agenda-title">
              <i className="fas fa-calendar-check" aria-hidden="true" /> {selected ? longDate(selected) : "Upcoming Events"}
            </h2>
            {selected && (
              <button type="button" className="cal-back" onClick={() => setSelected(null)}>
                <i className="fas fa-arrow-left" aria-hidden="true" /> All upcoming
              </button>
            )}
          </header>
          {selected ? (
            <>
              <p className={`cal-state ${selectedState}`}>{STATE_TEXT[selectedState!]}</p>
              {selectedItems.length > 0 ? (
                <ul className="cal-list">
                  {selectedItems.map((item) => (
                    <ItemDetails key={`${item.kind}-${item.id}`} item={item} showDate={false} />
                  ))}
                </ul>
              ) : (
                <p className="cal-empty-note">No bookings or public events on this day.</p>
              )}
              {selectedState === "open" && reservedTimes.length > 0 && (
                <p className="cal-reserved">
                  Already reserved: {reservedTimes.join(", ")}. Choose a time at least one hour apart.
                </p>
              )}
              {selectedState === "open" && (
                <ServicesLink className="btn btn-primary cal-book">
                  <i className="fas fa-plus" aria-hidden="true" /> Book a service
                </ServicesLink>
              )}
            </>
          ) : data.upcoming.length ? (
            <ul className="cal-list">
              {data.upcoming.map((item) => (
                <ItemDetails key={`${item.kind}-${item.id}`} item={item} showDate />
              ))}
            </ul>
          ) : (
            <p className="cal-empty-note">No upcoming bookings or published parish events.</p>
          )}
        </section>

        <section className="cal-card cal-legend" aria-labelledby="legend-title">
          <h2 id="legend-title">Legend</h2>
          <ul>
            <li><span className="swatch today" aria-hidden="true" /> Today</li>
            <li><span className="swatch mine" aria-hidden="true" /> Your booking</li>
            <li><span className="swatch event" aria-hidden="true" /> Public parish event</li>
            <li><span className="swatch count" aria-hidden="true">2</span> Multiple items on one day</li>
            <li><span className="swatch closed" aria-hidden="true" /> Closed or blocked for booking</li>
            <li><span className="swatch past" aria-hidden="true" /> Past date</li>
          </ul>
          <p className="cal-note">Times shown in Philippine time. Availability is confirmed again when you submit a booking.</p>
        </section>

        <ServicesLink className="btn btn-primary cal-book-now">
          <i className="fas fa-calendar-plus" aria-hidden="true" /> Book Now
        </ServicesLink>
      </aside>
    </div>
  );
}
