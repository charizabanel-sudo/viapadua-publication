import SiteHeader from "@/components/SiteHeader";
import PortalShell from "@/components/portal/PortalShell";
import { userLogoutAction } from "@/app/account/actions";
import FeedbackForm from "@/components/portal/FeedbackForm";
import FileDownload from "@/components/files/FileDownload";
import PortalCalendar from "@/components/portal/PortalCalendar";
import { isPortalTab, PORTAL_NAV, type PortalTab } from "@/lib/portal/nav";
import { requireUser } from "@/lib/server/user-auth";
import { getDb } from "@/lib/server/db";
import { normalizeMonth, shiftMonth } from "@/lib/admin/calendar";
import { getPortalCalendar } from "@/lib/portal/calendar";
import { formatDateLong, todayInParish } from "@/lib/booking/schedule";
import { linkGuestChatAction } from "@/lib/server/actions/portal";
import ServicesBooking from "@/components/services/ServicesBooking";
import { ServicesLink } from "@/components/public/PublicOverlayProvider";
import { getGcashPayee } from "@/lib/server/payment";
import AppointmentCard, { type Appointment } from "@/components/portal/AppointmentCard";
import AppointmentStatusFilter from "@/components/portal/AppointmentStatusFilter";
import Link from "next/link";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;
const docHref = (id: string) => `/api/documents/${id}`;

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string; page?: string; status?: string }> }) {
  const params = await searchParams;
  const tab: PortalTab = isPortalTab(params.tab) ? params.tab : "bookings";
  const month = normalizeMonth(params.month);
  const user = await requireUser(`/portal?tab=${tab}${tab === "calendar" && params.month ? `&month=${month}` : ""}`);
  const db = getDb();
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const statusFilter = ["all", "pending", "confirmed", "cancelled", "completed"].includes(params.status ?? "")
    ? params.status ?? "all"
    : "all";
  const [bookings, requests, conversations, calendar] = await Promise.all([
    tab === "bookings" || tab === "receipts" ? db.booking.findMany({
      where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE,
      include: { documents: { select: { id: true, kind: true, released: true, filename: true } }, paymentReceipt: { select: { status: true, receiptNumber: true } } },
    }) : [],
    tab === "certificates" ? db.certificateRequest.findMany({
      where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100,
      include: { documents: { where: { released: true, kind: "certificate" }, select: { id: true } } },
    }) : [],
    tab === "messages" ? db.guestConversation.findMany({
      where: { userId: user.id }, select: { id: true, displayName: true, lastMessageAt: true }, orderBy: { lastMessageAt: "desc" },
    }) : [],
    tab === "calendar" ? getPortalCalendar(db, user.id, month) : null,
  ]);
  const allAppointments: Appointment[] = bookings.map((b) => ({
    id: b.id,
    reference: b.reference,
    service: b.service,
    bookingDate: b.bookingDate.toISOString().slice(0, 10),
    bookingTime: b.bookingTime,
    status: b.status as Appointment["status"],
    requestedDate: b.requestedDate?.toISOString().slice(0, 10) ?? null,
    requestedTime: b.requestedTime,
    rescheduleRequestedAt: b.rescheduleRequestedAt?.toISOString() ?? null,
  }));
  const appointments = statusFilter === "all" ? allAppointments : allAppointments.filter((appointment) => appointment.status === statusFilter);
  const pager = (
    <div className="portal-pager">
      {page > 1 && <Link href={`/portal?tab=${tab}&page=${page - 1}`}>Newer appointments</Link>}
      {bookings.length === PAGE_SIZE && <Link href={`/portal?tab=${tab}&page=${page + 1}`}>Older appointments</Link>}
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
            <button className="portal-logout" type="submit">
              <i className="fas fa-sign-out-alt" aria-hidden="true" />
              Log out
            </button>
          </form>
        }
      >
        <header className="portal-page-head">
          <h1>{PORTAL_NAV.find((item) => item.tab === tab)?.label ?? "My Appointments"}</h1>
          <p>Hello, {user.name}. Follow your appointments and parish office updates here.</p>
        </header>
        {tab === "bookings" && (
          <>
          <AppointmentStatusFilter status={statusFilter} />
          <div className="portal-grid">
            {appointments.map((appointment) => (
              <AppointmentCard key={appointment.id} booking={appointment} />
            ))}
          </div>
          {!appointments.length && <div className="portal-empty"><p>No appointments are linked to this account yet.</p><ServicesLink className="btn btn-primary">Request an appointment</ServicesLink></div>}
          {pager}
          </>
        )}
        {tab === "receipts" && (
          <>
            <p>Parish payment receipts are issued after the parish office verifies payment.</p>
            {bookings.map((b) => {
              const receipts = b.documents.filter((d) => ["receipt", "payment_receipt"].includes(d.kind) && d.released);
              return <article key={b.id} className="portal-card"><h2 className="portal-card-title">{b.reference} · {b.service}</h2>{receipts.map((d) => <p key={d.id}><FileDownload href={docHref(d.id)} previewHref={`${docHref(d.id)}?preview=1`}><i className="fas fa-download" aria-hidden="true" /> {d.kind === "payment_receipt" ? `Download parish payment receipt ${b.paymentReceipt?.receiptNumber ?? ""}`.trim() : "Download official receipt"}</FileDownload></p>)}{!receipts.length && <p>{b.paymentStatus === "paid" ? "No receipt has been released yet." : "A receipt is issued after the parish office verifies your payment."}</p>}</article>;
            })}
            {!bookings.length && <p className="portal-empty">No appointments yet, so there are no receipts.</p>}
            {pager}
          </>
        )}
        {tab === "certificates" && requests.map((r) => (
          <article key={r.id} className="portal-card"><h2 className="portal-card-title">{r.reference} · {r.type}</h2><p>Status: {r.status} · Fee: ₱{String(r.fee)}</p>{r.adminNote && <p>{r.adminNote}</p>}{r.status === "released" && r.documents.map((d) => <p key={d.id}><FileDownload href={docHref(d.id)} previewHref={`${docHref(d.id)}?preview=1`}>Download released certificate PDF</FileDownload></p>)}</article>
        ))}
        {tab === "messages" && (
          <>
            <article className="portal-card">
              <h2 className="portal-card-title">Parish office messages</h2>
              <p>Send a question to the parish office and follow the replies here.</p>
              <Link className="btn btn-primary portal-open-messages" href="/portal?tab=messages&chat=1">
                <i className="fas fa-comments" aria-hidden="true" /> Open messages
              </Link>
              {conversations.length > 0 && (
                <ul className="portal-list">
                  {conversations.map((conversation) => (
                    <li key={conversation.id}>
                      <Link href={`/portal?tab=messages&chat=1&thread=${conversation.id}`}>
                        {conversation.displayName}
                      </Link>{" "}
                      <small>Last message {formatDateLong(todayInParish(conversation.lastMessageAt))}</small>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <details className="portal-card">
              <summary>Bring this browser&apos;s guest conversation into my account</summary>
              <p>This only works when this browser holds the valid guest credential. Staff never match conversations by name or email.</p>
              <FeedbackForm action={linkGuestChatAction}>
                <label className="check-label">
                  <input type="checkbox" name="consent" value="yes" required />
                  I agree to link the guest conversation on this browser to my account.
                </label>
                <button className="btn btn-primary portal-open-messages">Link my guest conversation</button>
              </FeedbackForm>
            </details>
          </>
        )}
        {tab === "calendar" && calendar && <PortalCalendar key={month} data={calendar} prevHref={`/portal?tab=calendar&month=${shiftMonth(month, -1)}`} nextHref={`/portal?tab=calendar&month=${shiftMonth(month, 1)}`} todayHref="/portal?tab=calendar" />}
      </PortalShell>
      <ServicesBooking gcashPayee={getGcashPayee()} signedIn />
    </>
  );
}