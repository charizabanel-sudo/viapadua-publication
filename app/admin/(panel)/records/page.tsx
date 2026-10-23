import FileDownload from "@/components/files/FileDownload";
import UploadDocument from "@/components/portal/UploadDocument";
import Link from "next/link";
import DownloadLink from "@/components/admin/DownloadLink";
import ActionButton from "@/components/admin/ActionButton";
import CertificateEditor from "@/components/admin/CertificateEditor";
import { formatPeso } from "@/lib/booking/catalog";
import { isBookingStatus } from "@/lib/booking/queries";
import { formatDateLong, formatTime12h, toIsoDate } from "@/lib/booking/schedule";
import { listRecords, needsCertificate, type RecordItem } from "@/lib/admin/records";
import { completeBookingAction, markPaidAction, receiptAction } from "@/lib/server/actions/admin";
import { documentLabel } from "@/lib/payments/labels";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_LABEL = { pending: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" } as const;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function purposeOf(r: RecordItem): string {
  const d = asObject(r.details);
  const p = d?.purpose ?? d?.certPurpose;
  return typeof p === "string" && p.trim() ? p : "";
}

export default async function RecordsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = first(sp.q).slice(0, 100);
  const statusParam = first(sp.status);
  const status = isBookingStatus(statusParam) ? statusParam : undefined;
  const page = Number.parseInt(first(sp.page), 10) || 1;
  const list = await listRecords(getDb(), { q, status, page });

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const pageHref = (p: number) => {
    const next = new URLSearchParams(params);
    if (p > 1) next.set("page", String(p));
    const s = next.toString();
    return s ? `/admin/records?${s}` : "/admin/records";
  };
  const exportHref = `/admin/export?kind=records${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}`;

  return (
    <>
      <header className="page-header with-actions">
        <div>
          <h1>Manage Records</h1>
          <p>Complete bookings, record verified payments, and issue certificates from booking details.</p>
        </div>
        <div className="page-actions">
          <Link className="btn btn-outline" href={pageHref(list.page)} prefetch={false}>
            <i className="fas fa-rotate" aria-hidden="true" /> Refresh
          </Link>
          <DownloadLink className="btn btn-primary" href={exportHref}>
            <i className="fas fa-download" aria-hidden="true" /> Export CSV
          </DownloadLink>
        </div>
      </header>

      <form className="toolbar" action="/admin/records" method="get" role="search">
        <div className="field grow">
          <label htmlFor="rec-q">Search</label>
          <input id="rec-q" type="search" name="q" defaultValue={q} maxLength={100} placeholder="Name, email, reference or service…" />
        </div>
        <div className="field">
          <label htmlFor="rec-status">Status</label>
          <select id="rec-status" name="status" defaultValue={status ?? "all"}>
            <option value="all">All Status</option>
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          <i className="fas fa-filter" aria-hidden="true" /> Filter
        </button>
      </form>

      <section className="payments-container">
        <h2 className="payments-title">Records ({list.total})</h2>
        {list.items.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-inbox" aria-hidden="true" />
            <p>No records found.</p>
            <p>{q || status ? "Try a different search or status." : "Guest bookings will appear here after they are submitted."}</p>
          </div>
        ) : (
          <div className="record-list">
            {list.items.map((r) => {
              const date = toIsoDate(r.bookingDate);
              const cert = asObject(r.certificate);
              const certEligible = needsCertificate(r.service) && (r.status === "completed" || Boolean(cert));
              const purpose = purposeOf(r);
              return (
                <article className="record-card" key={r.id}>
                  <div className="record-main">
                    <div className="record-title-row">
                      <div className="record-icon" aria-hidden="true">
                        <i className="fas fa-file-lines" />
                      </div>
                      <div>
                        <h3 className="record-title">
                          {r.service}
                          {r.source === "legacy" && <span className="pill legacy">Legacy</span>}
                        </h3>
                        <span className="record-id">
                          {r.requesterName} • {r.requesterEmail}
                          {r.requesterPhone ? ` • ${r.requesterPhone}` : ""} • {r.reference}
                        </span>
                      </div>
                    </div>
                    <dl className="record-info">
                      {purpose && (
                        <div>
                          <dt>Purpose</dt>
                          <dd>{purpose}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Date</dt>
                        <dd>{formatDateLong(date)}</dd>
                      </div>
                      <div>
                        <dt>Time</dt>
                        <dd>{formatTime12h(r.bookingTime)}</dd>
                      </div>
                      <div>
                        <dt>Location</dt>
                        <dd>{r.location || "Main Chapel"}</dd>
                      </div>
                      <div>
                        <dt>Fee</dt>
                        <dd>
                          {r.fee !== null ? formatPeso(Number(r.fee)) : "Fee not specified"} · {r.paymentMethod === "gcash" ? "GCash" : r.paymentMethod === "church" ? "Pay at church" : "Payment method not specified"}
                        </dd>
                      </div>
                      {cert && (
                        <div>
                          <dt>Certificate</dt>
                          <dd>Saved</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                  <div className="record-actions">
                    <div className="badge-row">
                      <span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                      <span className={`badge badge-${r.paymentStatus}`}>{r.paymentStatus === "paid" ? "Paid" : "Unpaid"}</span>
                    </div>
                    {r.status === "confirmed" && (
                      <ActionButton
                        action={completeBookingAction}
                        fields={{ bookingId: r.id }}
                        confirm={`Mark ${r.reference} (${r.service}) as COMPLETED?`}
                        className="btn btn-success btn-sm"
                        pendingLabel="Saving…"
                      >
                        <i className="fas fa-check" aria-hidden="true" /> Mark Complete
                      </ActionButton>
                    )}
                    {r.status === "pending" && <span className="hint-text">Confirm in Bookings before completing.</span>}
                    {r.paymentStatus === "unpaid" && r.status !== "cancelled" && r.paymentMethod && (
                      <ActionButton
                        action={markPaidAction}
                        fields={{ bookingId: r.id, verification: r.paymentMethod === "gcash" ? "gcash_account_checked" : "cash_received" }}
                        confirm={
                          r.paymentMethod === "gcash"
                            ? `Record GCash payment for ${r.reference} as PAID?\n\nOnly continue if you found this payment in the parish GCash account. A submitted reference or screenshot alone is not proof.\n\nA parish payment receipt will be issued automatically.`
                            : `Record payment for ${r.reference} as PAID?\n\nOnly continue if the parish office has received the money.\n\nA parish payment receipt will be issued automatically.`
                        }
                        className="btn btn-gold btn-sm"
                        pendingLabel="Saving…"
                      >
                        <i className="fas fa-peso-sign" aria-hidden="true" /> {r.paymentMethod === "gcash" ? "Verify GCash & Mark Paid" : "Money Received · Mark Paid"}
                      </ActionButton>
                    )}
                    {r.paymentStatus === "paid" && r.paymentReceipt?.status === "issued" && r.paymentReceipt.documentId && (
                      <FileDownload className="btn btn-outline btn-sm" href={`/api/documents/${r.paymentReceipt.documentId}`} previewHref={`/api/documents/${r.paymentReceipt.documentId}?preview=1`}>
                        <i className="fas fa-receipt" aria-hidden="true" /> Receipt {r.paymentReceipt.receiptNumber}
                      </FileDownload>
                    )}
                    {r.paymentStatus === "paid" && r.paymentReceipt?.status === "pending" && (
                      <ActionButton action={receiptAction} fields={{ bookingId: r.id }} className="btn btn-outline btn-sm" pendingLabel="Generating…">
                        <i className="fas fa-rotate-right" aria-hidden="true" /> Retry receipt {r.paymentReceipt.receiptNumber}
                      </ActionButton>
                    )}
                    {r.paymentStatus === "paid" && !r.paymentReceipt && r.paidAt && r.fee !== null && r.paymentMethod && (
                      <ActionButton action={receiptAction} fields={{ bookingId: r.id }} confirm={`Issue a parish payment receipt for ${r.reference} using the recorded payment date and amount?`} className="btn btn-outline btn-sm" pendingLabel="Generating…">
                        <i className="fas fa-receipt" aria-hidden="true" /> Issue receipt
                      </ActionButton>
                    )}
                    {certEligible && (
                      <CertificateEditor
                        bookingId={r.id}
                        reference={r.reference}
                        label={cert ? "Certificate" : "Create Certificate"}
                        booking={{
                          service: r.service,
                          date,
                          location: r.location,
                          details: asObject(r.details),
                          userName: r.requesterName,
                        }}
                        saved={cert}
                      />
                    )}
                    <Link className="btn btn-outline btn-sm" href={`/admin/bookings?view=${r.id}`}>
                      <i className="fas fa-eye" aria-hidden="true" /> View booking
                    </Link>
                  </div>
                  <details className="portal-card"><summary>Private documents and receipts</summary>{r.paymentProof && <p><FileDownload href={`/api/bookings/${r.id}/legacy-proof`} previewHref={`/api/bookings/${r.id}/legacy-proof?preview=1`}>Historical payment evidence</FileDownload></p>}{r.documents.map(d => <p key={d.id}><FileDownload href={`/api/documents/${d.id}`} previewHref={`/api/documents/${d.id}?preview=1`}>{documentLabel(d.kind)}: {d.filename}</FileDownload></p>)}<UploadDocument bookingId={r.id} kind="payment_proof" />{r.paymentStatus === "paid" && !r.paymentReceipt && <UploadDocument bookingId={r.id} kind="receipt" />}{certEligible && <UploadDocument bookingId={r.id} kind="certificate" />}</details>
                </article>
              );
            })}
          </div>
        )}

        {list.pages > 1 && (
          <nav className="pagination" aria-label="Pagination">
            <Link className={list.page <= 1 ? "disabled" : ""} href={pageHref(list.page - 1)} aria-disabled={list.page <= 1}>
              ← Previous
            </Link>
            <span>
              Page {list.page} of {list.pages}
            </span>
            <Link className={list.page >= list.pages ? "disabled" : ""} href={pageHref(list.page + 1)} aria-disabled={list.page >= list.pages}>
              Next →
            </Link>
          </nav>
        )}
      </section>
    </>
  );
}
