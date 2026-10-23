import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import UploadDocument from "@/components/portal/UploadDocument";
import { userLogoutAction } from "@/app/account/actions";
import FeedbackForm from "@/components/portal/FeedbackForm";
import FileDownload from "@/components/files/FileDownload";
import PortalCalendar from "@/components/portal/PortalCalendar";
import PortalShell from "@/components/portal/PortalShell";
import { isPortalTab, PORTAL_NAV, type PortalTab } from "@/lib/portal/nav";
import { requireUser } from "@/lib/server/user-auth";
import { getDb } from "@/lib/server/db";
import { normalizeMonth, shiftMonth } from "@/lib/admin/calendar";
import { getPortalCalendar } from "@/lib/portal/calendar";
import { formatDateLong, formatTime12h, toIsoDate, todayInParish } from "@/lib/booking/schedule";
import { linkGuestChatAction } from "@/lib/server/actions/portal";
import { getGcashPayee } from "@/lib/server/payment";
import ServicesBooking from "@/components/services/ServicesBooking";
import { ServicesLink } from "@/components/public/PublicOverlayProvider";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const docHref = (id: string) => `/api/documents/${id}`;

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; page?: string }>;
}) {
  const params = await searchParams;
  const tab: PortalTab = isPortalTab(params.tab) ? params.tab : "bookings";
  const month = normalizeMonth(params.month);
  const user = await requireUser(
    `/portal?tab=${tab}${tab === "calendar" && params.month ? `&month=${month}` : ""}`,
  );
  const db = getDb();
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const [bookings, requests, conversations, calendar] = await Promise.all([
    tab === "bookings" || tab === "receipts"
      ? db.booking.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: PAGE_SIZE,
          skip: (page - 1) * PAGE_SIZE,
          include: {
            documents: {
              select: { id: true, kind: true, released: true, filename: true },
            },
          },
        })
      : [],
    tab === "certificates"
      ? db.certificateRequest.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            documents: {
              where: { released: true, kind: "certificate" },
              select: { id: true },
            },
          },
        })
      : [],
    tab === "messages"
      ? db.guestConversation.findMany({
          where: { userId: user.id },
          select: { id: true, displayName: true, lastMessageAt: true },
          orderBy: { lastMessageAt: "desc" },
        })
      : [],
    tab === "calendar" ? getPortalCalendar(db, user.id, month) : null,
  ]);
  const pager = (
    <div className="portal-pager">
      {page > 1 && (
        <Link href={`/portal?tab=${tab}&page=${page - 1}`}>Newer bookings</Link>
      )}
      {bookings.length === PAGE_SIZE && (
        <Link href={`/portal?tab=${tab}&page=${page + 1}`}>Older bookings</Link>
      )}
    </div>
  );
  return (
    <>
      <SiteHeader />
      <PortalShell
        tab={tab}
        userName={user.name}
        logout={
          <form action={userLogoutAction}>
            <button className="portal-logout">
              <i className="fas fa-right-from-bracket" aria-hidden="true" /> Log out
            </button>
          </form>
        }
      >
        <header className="portal-page-head">
          <h1>{PORTAL_NAV.find((n) => n.tab === tab)!.label}</h1>
          <p>Hello, {user.name}. Follow your bookings and parish office updates here.</p>
        </header>

        {tab === "bookings" && (
          <>
            {bookings.map((b) => (
              <article className="portal-card" key={b.id}>
                <h2 className="portal-card-title">
                  {b.service} · {b.reference}
                </h2>
                <p>
                  {formatDateLong(toIsoDate(b.bookingDate))} · {formatTime12h(b.bookingTime)}
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
                    <FileDownload
                      href={`/api/bookings/${b.id}/legacy-proof`}
                      previewHref={`/api/bookings/${b.id}/legacy-proof?preview=1`}
                    >
                      Download historical payment evidence
                    </FileDownload>
                  </p>
                )}
                {b.paymentStatus !== "paid" && b.status !== "cancelled" && (
                  <UploadDocument bookingId={b.id} />
                )}
                {b.documents
                  .filter((d) => d.kind === "payment_proof" || d.released)
                  .map((d) => (
                    <p key={d.id}>
                      <FileDownload href={docHref(d.id)} previewHref={`${docHref(d.id)}?preview=1`}>
                        {d.kind === "payment_proof" ? "Payment evidence" : d.kind}: {d.filename}
                      </FileDownload>
                    </p>
                  ))}
              </article>
            ))}
            {!bookings.length && (
              <div className="portal-empty">
                <p>No bookings are linked to this account yet.</p>
                <ServicesLink className="btn btn-primary">Book a service</ServicesLink>
              </div>
            )}
            {pager}
          </>
        )}

        {tab === "receipts" && (
          <>
            <p>
              Official receipts appear only when the parish office uploads and
              releases them. Payment evidence is not an official receipt.
            </p>
            {bookings.map((b) => {
              const receipts = b.documents.filter((d) => d.kind === "receipt" && d.released);
              return (
                <article key={b.id} className="portal-card">
                  <h2 className="portal-card-title">
                    {b.reference} · {b.service}
                  </h2>
                  {receipts.length ? (
                    receipts.map((d) => (
                      <p key={d.id}>
                        <FileDownload href={docHref(d.id)} previewHref={`${docHref(d.id)}?preview=1`}>
                          <i className="fas fa-download" aria-hidden="true" /> Download official receipt
                        </FileDownload>
                      </p>
                    ))
                  ) : (
                    <p>No official receipt has been released.</p>
                  )}
                </article>
              );
            })}
            {!bookings.length && <p className="portal-empty">No bookings yet, so there are no receipts.</p>}
            {pager}
          </>
        )}

        {tab === "certificates" && (
          <>
            {requests.map((r) => (
              <article key={r.id} className="portal-card">
                <h2 className="portal-card-title">
                  {r.reference} · {r.type}
                </h2>
                <p>
                  Status: {r.status} · Fee: ₱{String(r.fee)}
                </p>
                {r.adminNote && <p>{r.adminNote}</p>}
                {r.status === "released" &&
                  r.documents.map((d) => (
                    <p key={d.id}>
                      <FileDownload href={docHref(d.id)} previewHref={`${docHref(d.id)}?preview=1`}>
                        <i className="fas fa-download" aria-hidden="true" /> Download released certificate PDF
                      </FileDownload>
                    </p>
                  ))}
                {r.status !== "released" && r.status !== "rejected" && (
                  <UploadDocument requestId={r.id} />
                )}
              </article>
            ))}
            {!requests.length && (
              <div className="portal-empty">
                <p>No certificate requests yet.</p>
                <ServicesLink className="btn btn-primary">Request a certificate</ServicesLink>
              </div>
            )}
          </>
        )}

        {tab === "messages" && (
          <>
            <article className="portal-card">
              <h2 className="portal-card-title">Parish office messages</h2>
              <p>Send a question to the parish office and follow the replies here.</p>
              <Link className="btn btn-primary" href="/portal?tab=messages&chat=1">
                <i className="fas fa-comments" aria-hidden="true" /> Open messages
              </Link>
              {conversations.length > 0 && (
                <ul className="portal-list">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <Link href={`/portal?tab=messages&chat=1&thread=${c.id}`}>
                        {c.displayName}
                      </Link>{" "}
                      <small>
                        Last message {formatDateLong(todayInParish(c.lastMessageAt))}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </article>
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
          </>
        )}

        {tab === "calendar" && calendar && (
          <PortalCalendar
            key={month}
            data={calendar}
            prevHref={`/portal?tab=calendar&month=${shiftMonth(month, -1)}`}
            nextHref={`/portal?tab=calendar&month=${shiftMonth(month, 1)}`}
            todayHref="/portal?tab=calendar"
          />
        )}
      </PortalShell>
      {/* Same booking/certificate workspace as the homepage, opened as a floating card over the portal. */}
      <ServicesBooking gcashPayee={getGcashPayee()} signedIn />
    </>
  );
}
