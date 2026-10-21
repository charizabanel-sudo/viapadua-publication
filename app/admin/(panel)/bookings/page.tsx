import Link from "next/link";
import { detailLabel, formatPeso } from "@/lib/booking/catalog";
import { getBookingDetail, isBookingStatus, listBookings, type BookingDetail, type BookingListItem } from "@/lib/booking/queries";
import { formatDateLong, formatTime12h, hasClockTime, toIsoDate } from "@/lib/booking/schedule";
import type { BookingStatus } from "@/lib/generated/prisma/client";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import StatusButton from "../StatusButton";
import BookingDetailsDialog from "@/components/admin/BookingDetailsDialog";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_CLASS: Record<BookingStatus, string> = {
  pending: "pending",
  confirmed: "accepted",
  completed: "completed",
  cancelled: "cancelled",
};

/** Legacy details_json keys that duplicate booking columns. */
const HIDDEN_DETAIL_KEYS = new Set([
  "serviceCode",
  "service",
  "fee",
  "payment_method",
  "user_id",
  "bookDate",
  "bookTime",
  "bookFullName",
  "bookEmail",
  "bookContact",
  "bookNotes",
]);

const SAFE_RECEIPT = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

function param(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
}

function noticeMessage(notice: string): { kind: "success" | "error"; text: string } | null {
  const [kind, ref] = notice.split(":");
  if (kind === "confirmed") return { kind: "success", text: `Booking ${ref} confirmed.` };
  if (kind === "cancelled") return { kind: "success", text: `Booking ${ref} cancelled.` };
  if (kind === "stale") return { kind: "error", text: `Booking ${ref} was already updated, so no change was made. The list shows its current status.` };
  if (kind === "not_found") return { kind: "error", text: "That booking no longer exists." };
  if (kind === "invalid") return { kind: "error", text: "Invalid request." };
  return null;
}

export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;

  const q = param(sp, "q").slice(0, 100);
  const statusParam = param(sp, "status");
  const status = isBookingStatus(statusParam) ? statusParam : undefined;
  const page = Number.parseInt(param(sp, "page"), 10) || 1;
  const viewId = Number.parseInt(param(sp, "view"), 10);
  const notice = noticeMessage(param(sp, "notice"));

  const db = getDb();
  const [list, detail] = await Promise.all([
    listBookings(db, { q, status, page }),
    Number.isInteger(viewId) && viewId > 0 ? getBookingDetail(db, viewId) : Promise.resolve(null),
  ]);

  const baseParams = new URLSearchParams();
  if (q) baseParams.set("q", q);
  if (status) baseParams.set("status", status);
  if (list.page > 1) baseParams.set("page", String(list.page));
  const href = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(baseParams);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return s ? `/admin/bookings?${s}` : "/admin/bookings";
  };
  const returnTo = href({});

  return (
    <>
      <header className="page-header">
        <h1>Manage Bookings</h1>
        <p>Review, confirm, or cancel bookings submitted by parishioners</p>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          <i className={`fas ${notice.kind === "success" ? "fa-check-circle" : "fa-exclamation-circle"}`} aria-hidden="true" />
          {notice.text}
        </div>
      )}

      <section className="filter-card">
        <form action="/admin/bookings" method="get" role="search">
          <div className="search-wrapper">
            <span className="search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="M16 16l5 5" />
              </svg>
            </span>
            <input
              type="search"
              className="search-input"
              name="q"
              defaultValue={q}
              maxLength={100}
              placeholder="Search by name, email, reference, or service..."
              aria-label="Search bookings"
            />
          </div>
          <span className="filter-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 5h16" />
              <path d="M7 12h10" />
              <path d="M10 19h4" />
            </svg>
          </span>
          <select className="status-select" name="status" defaultValue={status ?? "all"} aria-label="Filter by status">
            <option value="all">All Status</option>
            {(Object.keys(STATUS_LABEL) as BookingStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button type="submit" className="filter-submit">
            Filter
          </button>
        </form>
      </section>

      <section className="payments-container">
        <h2 className="payments-title">
          {status ? `${STATUS_LABEL[status]} Bookings` : "All Bookings"} ({list.total})
        </h2>

        {list.items.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-inbox" aria-hidden="true" />
            <p>No bookings found.</p>
            <p>{q || status ? "Try a different search or status filter." : "Bookings from parishioners will appear here."}</p>
          </div>
        ) : (
          list.items.map((b) => <BookingCard key={b.id} booking={b} viewHref={href({ view: String(b.id) })} returnTo={returnTo} />)
        )}

        {list.pages > 1 && (
          <nav className="pagination" aria-label="Pagination">
            <Link className={list.page <= 1 ? "disabled" : ""} href={href({ page: String(list.page - 1) })} aria-disabled={list.page <= 1}>
              ← Previous
            </Link>
            <span>
              Page {list.page} of {list.pages}
            </span>
            <Link
              className={list.page >= list.pages ? "disabled" : ""}
              href={href({ page: String(list.page + 1) })}
              aria-disabled={list.page >= list.pages}
            >
              Next →
            </Link>
          </nav>
        )}
      </section>

      {detail ? (
        <DetailsModal booking={detail} closeHref={href({ view: null })} returnTo={href({ view: String(detail.id) })} />
      ) : (
        Number.isInteger(viewId) &&
        viewId > 0 && (
          <div className="notice error" role="status">
            Booking not found.
          </div>
        )
      )}
    </>
  );
}

function paymentText(b: Pick<BookingListItem, "paymentMethod" | "gcashReference">): string {
  if (b.paymentMethod === "gcash") return b.gcashReference ? `GCash Ref: ${b.gcashReference}` : "GCash (no reference)";
  if (b.paymentMethod === "church") return "Pay at Church";
  return "Payment method not specified";
}

function BookingCard({ booking: b, viewHref, returnTo }: { booking: BookingListItem; viewHref: string; returnTo: string }) {
  const date = toIsoDate(b.bookingDate);
  return (
    <article className="payment-card">
      <div className="payment-main">
        <div className="payment-heading">
          <div className="payment-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="4" y="5" width="16" height="15" rx="2" />
              <path d="M8 3v4M16 3v4M4 10h16" />
            </svg>
          </div>
          <div>
            <h3 className="payment-title">
              {b.service}
              {b.status === "pending" && <span className="new-badge">NEW</span>}
              {b.source === "legacy" && <span className="pill legacy">Legacy</span>}
            </h3>
            <p className="payment-user">
              {b.requesterName} • {b.requesterEmail}
            </p>
          </div>
        </div>
        <div className="payment-details">
          <div className="detail-item">
            <span className="detail-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v5l3 2" />
              </svg>
            </span>
            {formatDateLong(date)}
            {hasClockTime(b.bookingTime) ? ` at ${formatTime12h(b.bookingTime)}` : ""}
          </div>
          <div className="detail-item">
            <span className="detail-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 10H22" />
              </svg>
            </span>
            {b.fee !== null ? formatPeso(Number(b.fee)) : "No fee"}{" "}
            <span className={`pill ${b.paymentStatus}`}>{b.paymentStatus}</span>
          </div>
        </div>
        <div className="payment-info">
          <div>
            <div className="payment-info-title">Reference:</div>
            <div className="payment-info-text">{b.reference}</div>
          </div>
          <div>
            <div className="payment-info-title">Payment:</div>
            <div className="payment-info-text">{paymentText(b)}</div>
          </div>
        </div>
      </div>
      <div className="payment-actions">
        <div className={`status ${STATUS_CLASS[b.status]}`}>{STATUS_LABEL[b.status]}</div>
        <Link className="action-button view-button" href={viewHref} scroll={false}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          View
        </Link>
        {(b.status === "pending" || b.status === "confirmed") && (
          <div className="action-row">
            {b.status === "pending" && <StatusButton bookingId={b.id} reference={b.reference} action="confirm" returnTo={returnTo} />}
            <StatusButton bookingId={b.id} reference={b.reference} action="cancel" returnTo={returnTo} />
          </div>
        )}
      </div>
    </article>
  );
}

function Detail({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`modal-detail${wide ? " wide" : ""}`}>
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
    </div>
  );
}

function detailEntries(details: unknown): [string, string][] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return Object.entries(details as Record<string, unknown>)
    .filter(([key, value]) => !HIDDEN_DETAIL_KEYS.has(key) && value !== null && value !== "")
    .map(([key, value]) => [detailLabel(key), typeof value === "string" ? value : JSON.stringify(value).slice(0, 500)]);
}

function DetailsModal({ booking: b, closeHref, returnTo }: { booking: BookingDetail; closeHref: string; returnTo: string }) {
  const entries = detailEntries(b.details);
  const receipt = b.paymentProof && SAFE_RECEIPT.test(b.paymentProof) ? b.paymentProof : null;

  return (
    <BookingDetailsDialog closeHref={closeHref}>
      <div className="modal-content">
        <div className="modal-header">
          <h2 id="detailsTitle">Booking Details</h2>
          <Link href={closeHref} className="close" aria-label="Close" scroll={false}>
            ×
          </Link>
        </div>

        <div className="modal-details">
          <Detail label="Reference" value={b.reference} />
          <Detail label="Status" value={STATUS_LABEL[b.status]} />
          <Detail label="Requester" value={b.requesterName} />
          <Detail label="Email" value={b.requesterEmail} />
          <Detail label="Phone" value={b.requesterPhone ?? ""} />
          <Detail label="Service" value={b.service} />
          <Detail label="Date" value={formatDateLong(toIsoDate(b.bookingDate))} />
          <Detail label="Time" value={formatTime12h(b.bookingTime)} />
          <Detail label="Location" value={b.location ?? ""} />
          <Detail label="Fee" value={b.fee !== null ? formatPeso(Number(b.fee)) : ""} />
          <Detail label="Payment" value={b.paymentMethod === "gcash" ? "GCash" : b.paymentMethod === "church" ? "Pay at Church" : ""} />
          <Detail label="Payment Status" value={b.paymentStatus === "paid" ? "Paid" : "Unpaid"} />
          {b.paymentMethod === "gcash" && (
            <>
              <Detail label="GCash Name" value={b.gcashName ?? ""} />
              <Detail label="GCash Number" value={b.gcashNumber ?? ""} />
              <Detail label="GCash Ref" value={b.gcashReference ?? ""} wide />
            </>
          )}
          <Detail label="Submitted" value={formatTimestamp(b.createdAt)} />
          <Detail label="Source" value={b.source === "legacy" ? "Legacy system import" : "Online guest booking"} />
        </div>

        {entries.length > 0 && (
          <>
            <h3 className="details-heading">Service Details</h3>
            <div className="modal-details">
              {entries.map(([label, value]) => (
                <Detail key={label} label={label} value={value} />
              ))}
            </div>
          </>
        )}

        {b.notes && (
          <p style={{ marginTop: 12, color: "#4b5563", fontSize: 13 }}>
            <strong>Notes:</strong> {b.notes}
          </p>
        )}

        {b.paymentMethod === "gcash" && (
          <div className="modal-note">
            <i className="fas fa-clock" aria-hidden="true" /> GCash payment verification and receipt uploads are awaiting migration.
            Check the reference in the parish GCash account; this booking stays <strong>unpaid</strong> here.
          </div>
        )}

        {receipt && (
          <>
            <h3 className="receipt-title">Uploaded Payment Receipt (legacy)</h3>
            {/* eslint-disable-next-line @next/next/no-img-element -- validated legacy data: URI, not optimizable */}
            <img src={receipt} className="receipt-preview" alt={`Payment receipt for ${b.reference}`} />
          </>
        )}

        {b.statusEvents.length > 0 && (
          <>
            <h3 className="receipt-title">Status History</h3>
            <ul className="history-list">
              {b.statusEvents.map((e) => (
                <li key={e.id}>
                  {formatTimestamp(e.createdAt)}: {STATUS_LABEL[e.fromStatus]} to {STATUS_LABEL[e.toStatus]}
                  {e.admin ? ` by ${e.admin.name}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="modal-actions">
          {b.status === "pending" && (
            <StatusButton bookingId={b.id} reference={b.reference} action="confirm" returnTo={returnTo} size="long" />
          )}
          {(b.status === "pending" || b.status === "confirmed") && (
            <StatusButton bookingId={b.id} reference={b.reference} action="cancel" returnTo={returnTo} size="long" />
          )}
          {b.status !== "pending" && b.status !== "confirmed" && (
            <Link href={closeHref} className="action-button view-button" scroll={false}>
              Close
            </Link>
          )}
        </div>
      </div>
    </BookingDetailsDialog>
  );
}
