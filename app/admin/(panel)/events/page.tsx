import Link from "next/link";
import ActionButton from "@/components/admin/ActionButton";
import EventEditor from "@/components/admin/EventEditor";
import { EVENT_TABS, EVENT_TYPE_LABEL, isEventType, listEvents, type EventScope } from "@/lib/admin/events";
import { formatDateLong, parseIsoDate } from "@/lib/booking/schedule";
import { deleteEventAction } from "@/lib/server/actions/admin";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SCOPES: { key: EventScope; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "all", label: "All dates" },
];

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function EventsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const typeParam = first(sp.type);
  const type = isEventType(typeParam) ? typeParam : undefined;
  const scopeParam = first(sp.scope);
  const scope: EventScope = scopeParam === "past" || scopeParam === "all" ? scopeParam : "upcoming";
  const { events, counts } = await listEvents(getDb(), { type, scope });

  const href = (changes: { type?: string | null; scope?: string | null }) => {
    const p = new URLSearchParams();
    const t = changes.type === undefined ? type : changes.type;
    const s = changes.scope === undefined ? scope : changes.scope;
    if (t) p.set("type", t);
    if (s && s !== "upcoming") p.set("scope", s);
    const q = p.toString();
    return q ? `/admin/events?${q}` : "/admin/events";
  };
  const activeTab = EVENT_TABS.find((t) => t.key === (type ?? "all"))!;

  return (
    <>
      <header className="page-header with-actions">
        <div>
          <h1>Parish Events</h1>
          <p>Masses, parish activities and special celebrations</p>
        </div>
        <EventEditor triggerClassName="btn btn-gold">
          <i className="fas fa-plus-circle" aria-hidden="true" /> Add Event
        </EventEditor>
      </header>

      <section className="toolbar events-toolbar" aria-label="Filter events">
        <nav className="tabs" aria-label="Event type">
          {EVENT_TABS.map((tab) => (
            <Link
              key={tab.key}
              href={href({ type: tab.key === "all" ? null : tab.key })}
              className={`tab${tab.key === (type ?? "all") ? " active" : ""}`}
              aria-current={tab.key === (type ?? "all") ? "page" : undefined}
            >
              {tab.label} <span className="count">({counts[tab.key]})</span>
            </Link>
          ))}
        </nav>
        <nav className="tabs scope-tabs" aria-label="Date range">
          {SCOPES.map((s) => (
            <Link key={s.key} href={href({ scope: s.key })} className={`tab${s.key === scope ? " active" : ""}`} aria-current={s.key === scope ? "page" : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
      </section>

      <section className="payments-container">
        <h2 className="payments-title">
          {activeTab.label} · {SCOPES.find((s) => s.key === scope)!.label} ({events.length})
        </h2>

        {events.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-calendar-plus" aria-hidden="true" />
            <p>No events found.</p>
            <p>{scope === "upcoming" ? "Use “Add Event” to put something on the parish calendar." : "Try another type or date range."}</p>
          </div>
        ) : (
          <div className="event-list">
            {events.map((ev) => {
              const d = parseIsoDate(ev.date)!;
              return (
                <article className={`event-card ${ev.type}`} key={ev.id}>
                  <div className="event-date" aria-hidden="true">
                    <span className="month">{MONTHS[d.getUTCMonth()]}</span>
                    <span className="day">{d.getUTCDate()}</span>
                  </div>
                  <div className="event-info">
                    <h3>{ev.title}</h3>
                    {ev.description && <p className="event-description">{ev.description}</p>}
                    <div className="event-details">
                      <span>
                        <i className="far fa-calendar" aria-hidden="true" /> {formatDateLong(ev.date)} ({d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })})
                      </span>
                      {ev.time && (
                        <span>
                          <i className="far fa-clock" aria-hidden="true" /> {ev.time}
                        </span>
                      )}
                      {ev.location && (
                        <span>
                          <i className="fas fa-location-dot" aria-hidden="true" /> {ev.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="event-side">
                    <span className={`badge badge-type ${ev.type}`}>{EVENT_TYPE_LABEL[ev.type]}</span>
                    <div className="event-actions">
                      <EventEditor event={ev} triggerClassName="btn btn-outline btn-sm" triggerLabel={`Edit ${ev.title}`}>
                        <i className="fas fa-pen" aria-hidden="true" /> Edit
                      </EventEditor>
                      <ActionButton
                        action={deleteEventAction}
                        fields={{ id: ev.id }}
                        confirm={`Delete “${ev.title}” on ${formatDateLong(ev.date)}? This cannot be undone.`}
                        className="btn btn-danger btn-sm"
                        ariaLabel={`Delete ${ev.title}`}
                        pendingLabel="Deleting…"
                      >
                        <i className="fas fa-trash" aria-hidden="true" /> Delete
                      </ActionButton>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
