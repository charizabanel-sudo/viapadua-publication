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
import { completeBookingAction, markPaidAction } from "@/lib/server/actions/admin";
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
                    {r.paymentStatus === "unpaid" && r.status !== "cancelled" && (
                      <ActionButton
                        action={markPaidAction}
                        fields={{ bookingId: r.id }}
                        confirm={`Record payment for ${r.reference} as PAID?\n\nOnly do this after verifying the payment${r.paymentMethod === "gcash" ? " in the parish GCash account" : " at the parish office"}.`}
                        className="btn btn-gold btn-sm"
                        pendingLabel="Saving…"
                      >
                        <i className="fas fa-peso-sign" aria-hidden="true" /> Mark as Paid
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
                  <details className="portal-card"><summary>Private documents and receipts</summary>{r.paymentProof && <p><FileDownload href={`/api/bookings/${r.id}/legacy-proof`} previewHref={`/api/bookings/${r.id}/legacy-proof?preview=1`}>Historical payment evidence</FileDownload></p>}{r.documents.map(d => <p key={d.id}><FileDownload href={`/api/documents/${d.id}`} previewHref={`/api/documents/${d.id}?preview=1`}>{d.kind}: {d.filename}</FileDownload></p>)}<UploadDocument bookingId={r.id} kind="payment_proof" />{r.paymentStatus === "paid" && <UploadDocument bookingId={r.id} kind="receipt" />}{certEligible && <UploadDocument bookingId={r.id} kind="certificate" />}</details>
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
