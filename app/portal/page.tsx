import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import UploadDocument from "@/components/portal/UploadDocument";
import { userLogoutAction } from "@/app/account/actions";
import FeedbackForm from "@/components/portal/FeedbackForm";
import { requireUser } from "@/lib/server/user-auth";
import { getDb } from "@/lib/server/db";
import { normalizeMonth, shiftMonth } from "@/lib/admin/calendar";
import { parseIsoDate, toIsoDate } from "@/lib/booking/schedule";
import { submitClaim } from "./actions";
import { linkGuestChatAction } from "@/lib/server/actions/portal";
export const dynamic = "force-dynamic";
const tabs = ["bookings", "calendar", "receipts", "certificates"];
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; page?: string }>;
}) {
  const user = await requireUser(),
    db = getDb(),
    params = await searchParams;
  const tab = tabs.includes(params.tab ?? "") ? params.tab! : "bookings";
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const [bookings, requests, claims, conversations] = await Promise.all([
    db.booking.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      skip: (page - 1) * 30,
      include: {
        documents: {
          select: { id: true, kind: true, released: true, filename: true },
        },
      },
    }),
    db.certificateRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        documents: {
          where: { released: true, kind: "certificate" },
          select: { id: true },
        },
      },
    }),
    db.bookingClaim.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.guestConversation.findMany({
      where: { userId: user.id },
      select: { id: true, displayName: true },
      orderBy: { lastMessageAt: "desc" },
    }),
  ]);
  const month = normalizeMonth(params.month);
  const range = {
    gte: parseIsoDate(`${month}-01`)!,
    lt: parseIsoDate(`${shiftMonth(month, 1)}-01`)!,
  };
  const [calendar, events, blocked, busy] =
    tab === "calendar"
      ? await Promise.all([
          db.booking.findMany({
            where: { userId: user.id, bookingDate: range },
            select: {
              id: true,
              service: true,
              reference: true,
              bookingDate: true,
              bookingTime: true,
              status: true,
            },
            orderBy: { bookingDate: "asc" },
          }),
          db.adminEvent.findMany({
            where: { isPublic: true, eventDate: range },
            select: {
              id: true,
              title: true,
              eventDate: true,
              eventTime: true,
              location: true,
            },
            orderBy: { eventDate: "asc" },
          }),
          db.blockedDate.findMany({
            where: { date: range },
            select: { date: true },
          }),
          db.booking.findMany({
            where: {
              bookingDate: range,
              status: { in: ["pending", "confirmed"] },
            },
            select: { bookingDate: true, bookingTime: true },
            orderBy: { bookingDate: "asc" },
          }),
        ])
      : [[], [], [], []];
  return (
    <>
      <SiteHeader />
      <main className="portal-content">
        <div className="portal-tabs">
          <h1>Hello, {user.name}</h1>
          <form action={userLogoutAction}>
            <button className="btn btn-secondary">Log out</button>
          </form>
        </div>
        <p>Follow your bookings and parish office updates here.</p>
        <nav className="portal-tabs" aria-label="Your portal">
          {tabs.map((t) => (
            <Link
              key={t}
              href={`/portal?tab=${t}`}
              aria-current={t === tab ? "page" : undefined}
            >
              {
                {
                  bookings: "My Bookings",
                  calendar: "Calendar",
                  receipts: "Receipts",
                  certificates: "Requested Certificates",
                }[t]
              }
            </Link>
          ))}
          <Link href="/services">Book / request a certificate</Link>
        </nav>
        {tab === "bookings" && (
          <>
            <h2>My Bookings</h2>
            {bookings.map((b) => (
              <article className="portal-card" key={b.id}>
                <h3>
                  {b.service} · {b.reference}
                </h3>
                <p>
                  {toIsoDate(b.bookingDate)} · {b.bookingTime}
                </p>
                <p>
                  Booking: <strong>{b.status}</strong> · Payment:{" "}
                  <strong>
                    {b.paymentStatus === "paid"
                      ? "Verified paid"
                      : b.documents.some((d) => d.kind === "payment_proof")
                        ? "Evidence submitted · awaiting staff verification"
                        : "Unpaid"}
                  </strong>
                </p>
                <p>Fee: ₱{String(b.fee ?? "—")}</p>
                {b.paymentProof && (
                  <p>
                    <a href={`/api/bookings/${b.id}/legacy-proof`}>
                      Download historical payment evidence
                    </a>
                  </p>
                )}
                {b.paymentStatus !== "paid" && b.status !== "cancelled" && (
                  <UploadDocument bookingId={b.id} />
                )}
                {b.documents
                  .filter((d) => d.kind === "payment_proof" || d.released)
                  .map((d) => (
                    <p key={d.id}>
                      <a href={`/api/documents/${d.id}`}>
                        {d.kind === "payment_proof"
                          ? "Payment evidence"
                          : d.kind}
                        : {d.filename}
                      </a>
                    </p>
                  ))}
              </article>
            ))}
            {!bookings.length && (
              <p>No bookings are linked to this account yet.</p>
            )}
            <div className="portal-tabs">
              {page > 1 && (
                <Link href={`/portal?page=${page - 1}`}>Newer bookings</Link>
              )}
              {bookings.length === 30 && (
                <Link href={`/portal?page=${page + 1}`}>Older bookings</Link>
              )}
            </div>
            <details className="portal-card">
              <summary>Claim a historical guest booking</summary>
              <p>
                Submit the reference and supporting details. Staff will verify
                identity/contact before linking any record.
              </p>
              <FeedbackForm action={submitClaim}>
                <label>
                  Booking reference
                  <input name="reference" maxLength={24} required />
                </label>
                <label>
                  Supporting information
                  <textarea
                    name="evidence"
                    minLength={10}
                    maxLength={1000}
                    required
                  />
                </label>
                <button className="btn btn-primary">
                  Request admin review
                </button>
              </FeedbackForm>
              {claims.map((c) => (
                <p key={c.id}>
                  {c.reference} · {c.status}
                  {c.reviewNote ? ` · ${c.reviewNote}` : ""}
                </p>
              ))}
            </details>
            <details className="portal-card">
              <summary>
                Bring this browser&apos;s guest conversation into my account
              </summary>
              <p>
                This only works when this browser holds the valid guest
                credential. Staff never match conversations by name or email.
              </p>
              <FeedbackForm action={linkGuestChatAction}>
                <label className="check-label">
                  <input type="checkbox" name="consent" value="yes" required />I
                  agree to link the guest conversation on this browser to my
                  account.
                </label>
                <button className="btn btn-primary">
                  Link my guest conversation
                </button>
              </FeedbackForm>
            </details>
            {conversations.length > 0 && (
              <article className="portal-card">
                <h2>My conversations</h2>
                {conversations.map((c) => (
                  <p key={c.id}>
                    <Link href={`/portal?chat=1&thread=${c.id}`}>
                      {c.displayName} · open conversation
                    </Link>
                  </p>
                ))}
              </article>
            )}
          </>
        )}
        {tab === "receipts" && (
          <>
            <h2>Receipts</h2>
            <p>
              Official receipts appear only when the parish office uploads and
              releases them. Payment evidence is not an official receipt.
            </p>
            {bookings.map((b) => (
              <article key={b.id} className="portal-card">
                <h3>
                  {b.reference} · {b.service}
                </h3>
                {b.documents.some((d) => d.kind === "receipt" && d.released) ? (
                  b.documents
                    .filter((d) => d.kind === "receipt" && d.released)
                    .map((d) => (
                      <p key={d.id}>
                        <a href={`/api/documents/${d.id}`}>
                          Download official receipt
                        </a>
                      </p>
                    ))
                ) : (
                  <p>No official receipt has been released.</p>
                )}
              </article>
            ))}
          </>
        )}
        {tab === "certificates" && (
          <>
            <h2>Requested Certificates</h2>
            {requests.map((r) => (
              <article key={r.id} className="portal-card">
                <h3>
                  {r.reference} · {r.type}
                </h3>
                <p>
                  Status: {r.status} · Fee: ₱{String(r.fee)}
                </p>
                {r.adminNote && <p>{r.adminNote}</p>}
                {r.status === "released" &&
                  r.documents.map((d) => (
                    <p key={d.id}>
                      <a href={`/api/documents/${d.id}`}>
                        Download released certificate PDF
                      </a>{" "}
                      ·{" "}
                      <a
                        target="_blank"
                        rel="noopener"
                        href={`/api/documents/${d.id}?preview=1`}
                      >
                        Open / print
                      </a>
                    </p>
                  ))}
                {r.status !== "released" && r.status !== "rejected" && (
                  <UploadDocument requestId={r.id} />
                )}
              </article>
            ))}
            {!requests.length && <p>No certificate requests yet.</p>}
          </>
        )}
        {tab === "calendar" && (
          <>
            <h2>Your calendar · {month}</h2>
            <div className="portal-tabs">
              <Link
                href={`/portal?tab=calendar&month=${shiftMonth(month, -1)}`}
              >
                Previous month
              </Link>
              <Link href={`/portal?tab=calendar&month=${shiftMonth(month, 1)}`}>
                Next month
              </Link>
            </div>
            <div className="portal-grid">
              <section className="portal-card">
                <h3>Your bookings</h3>
                {calendar.map((b) => (
                  <p key={b.id}>
                    {toIsoDate(b.bookingDate)} {b.bookingTime} · {b.service} ·{" "}
                    {b.status}
                  </p>
                ))}
                {!calendar.length && <p>No bookings this month.</p>}
              </section>
              <section className="portal-card">
                <h3>Public parish events</h3>
                {events.map((e) => (
                  <p key={e.id}>
                    {toIsoDate(e.eventDate)} {e.eventTime} · {e.title} ·{" "}
                    {e.location}
                  </p>
                ))}
                {!events.length && <p>No published events.</p>}
              </section>
              <section className="portal-card">
                <h3>Availability</h3>
                <p>
                  Sundays and Tuesdays are closed for online booking.
                  Availability is checked again on submission.
                </p>
                {blocked.map((b) => (
                  <p key={String(b.date)}>{toIsoDate(b.date)} · closed</p>
                ))}
                {busy.map((b, i) => (
                  <p key={i}>
                    {toIsoDate(b.bookingDate)} {b.bookingTime} · reserved slot
                  </p>
                ))}
              </section>
            </div>
          </>
        )}
      </main>
    </>
  );
}
