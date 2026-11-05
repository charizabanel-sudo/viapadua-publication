import FileDownload from "@/components/files/FileDownload";
import FeedbackForm from "@/components/portal/FeedbackForm";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { reviewCertificateRequest } from "@/lib/server/actions/portal";
import UploadDocument from "@/components/portal/UploadDocument";
import CertificateEditor from "@/components/admin/CertificateEditor";

const CERTIFICATE_DETAIL_FIELDS: Record<string, readonly { key: string; label: string }[]> = {
  baptism: [
    { key: "recipientName", label: "Name on parish record" },
    { key: "fatherName", label: "Father's full name" },
    { key: "motherName", label: "Mother's maiden name" },
    { key: "sacramentDate", label: "Sacrament date" },
    { key: "parish", label: "Church / place of sacrament" },
  ],
  confirmation: [
    { key: "recipientName", label: "Name on parish record" },
    { key: "sacramentDate", label: "Sacrament date" },
    { key: "parish", label: "Church / place of sacrament" },
  ],
  wedding: [
    { key: "recipientName", label: "Name on parish record" },
    { key: "spouseName", label: "Spouse's full name" },
    { key: "sacramentDate", label: "Sacrament date" },
    { key: "parish", label: "Church / place of sacrament" },
  ],
};

export default async function RequestsPage() {
  await requireAdmin();
  const rows = await getDb().certificateRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      documents: { select: { id: true, kind: true, filename: true } },
    },
  });
  return (
    <div className="portal-content">
      <h1>Certificate Requests</h1>
      <p>
        Check the original parish register and requester authority before
        processing or releasing a copy.
      </p>
      {rows.map((r) => {
        const d = r.details as Record<string, string>;
        const detailFields = CERTIFICATE_DETAIL_FIELDS[r.type] ??
          [];
        return (
          <article className="portal-card" key={r.id}>
            <h2>
              {r.reference} · {r.type}
            </h2>
            <p>
              {r.requesterName} · {r.email} · {r.phone}
            </p>
            <p>
              Status: <strong>{r.status}</strong> · Fee: ₱{String(r.fee)}
            </p>
            <dl>
              {detailFields.map(({ key, label }) => {
                const value = String(d[key] ?? "").trim();
                return value ? (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ) : null;
              })}
            </dl>
            <FeedbackForm action={reviewCertificateRequest}>
              <input type="hidden" name="id" value={r.id} />
              <label>
                Decision
                <select
                  name="status"
                  defaultValue={
                    r.status === "released" ? "processing" : r.status
                  }
                >
                  <option value="pending">Pending</option>
                  <option value="processing">
                    Processing · parish record checked
                  </option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
              <label>
                Message to requester
                <textarea
                  name="note"
                  maxLength={1000}
                  defaultValue={r.adminNote ?? ""}
                />
              </label>
              <button className="btn btn-primary">Save review</button>
            </FeedbackForm>
            {r.status === "processing" && (
              <>
                <CertificateEditor
                  bookingId={0}
                  requestId={r.id}
                  reference={r.reference}
                  booking={{
                    service: r.type,
                    date: d.sacramentDate,
                    userName: d.recipientName,
                    details: {
                      ...d,
                      childName: d.recipientName,
                      fullName: d.recipientName,
                      groomName: d.recipientName,
                      brideName: d.spouseName,
                    },
                  }}
                  saved={r.certificate as Record<string, unknown> | null}
                  label="Prepare certificate"
                />
                <UploadDocument requestId={r.id} kind="certificate" />
              </>
            )}
            {r.documents.map((file) => (
              <p key={file.id}>
                <FileDownload
                  href={`/api/documents/${file.id}`}
                  previewHref={`/api/documents/${file.id}?preview=1`}
                >
                  {file.kind}: {file.filename}
                </FileDownload>
              </p>
            ))}
          </article>
        );
      })}
      {!rows.length && <p>No requests yet.</p>}
    </div>
  );
}
