"use client";
import FileDownload from "@/components/files/FileDownload";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { certificateTypes } from "@/lib/certificates/requests";
import { newRequestId, statusMessage, submitJson, UNCERTAIN_MESSAGE } from "@/lib/client/submit";
type Progress = {
  id: string;
  reference: string;
  status: string;
  note: string | null;
  type: string;
  fee: number;
  documents: { id: string }[];
};
export default function CertificateRequestForm({
  initialType,
  onBack,
  visible,
  onDirtyChange,
}: {
  initialType: string;
  onBack: () => void;
  visible: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [type, setType] = useState(initialType),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<{ reference: string; status: string } | null>(null);
  const busyRef = useRef(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Progress[]>([]);
  const requestId = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch("/api/certificate-requests", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (r.ok) setRows((await r.json()).requests);
      } catch {
        /* Pending requests remain visible on the next refresh. */
      }
      if (!controller.signal.aborted) timer = setTimeout(load, 15000);
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [visible]);
  async function refreshRows() {
    try {
      const r = await fetch("/api/certificate-requests", { cache: "no-store" });
      if (r.ok) setRows((await r.json()).requests);
    } catch {
      /* The list refreshes again on its next poll. */
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const formElement = e.currentTarget;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setSaved(null);
    // Kept across retries so an uncertain first attempt is never saved twice.
    requestId.current ||= newRequestId();
    try {
      const form = Object.fromEntries(new FormData(formElement));
      const outcome = await submitJson<{ ok?: boolean; reference?: string; status?: string; error?: string }>("/api/certificate-requests", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, type, clientRequestId: requestId.current }),
      });
      if (outcome.kind === "uncertain") {
        setError(UNCERTAIN_MESSAGE);
        return;
      }
      const data = outcome.data;
      if (outcome.status >= 400 || !data?.reference) {
        setError(data?.error ?? statusMessage(outcome.status));
        return;
      }
      // Confirmation only after the server reports the saved record.
      setSaved({ reference: data.reference, status: data.status ?? "pending" });
      requestId.current = "";
      formElement.reset();
      onDirtyChange(false);
      requestAnimationFrame(() => confirmRef.current?.focus());
      void refreshRows();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="portal-form services-step">
      <button type="button" className="btn btn-secondary" onClick={onBack}>
        Back to services
      </button>
      <h3 ref={headingRef} tabIndex={-1} data-dialog-autofocus>Request a Certificate</h3>
      <p>
        Request a copy of an existing parish record. Review and delivery are
        handled by the parish office.
      </p>
      <form
        onSubmit={submit}
        onInput={() => onDirtyChange(true)}
        aria-busy={busy}
      >
        <label>
          Certificate type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {certificateTypes.map((t) => (
              <option key={t.type} value={t.type}>
                {t.name} · ₱{t.fee}
              </option>
            ))}
          </select>
        </label>
        {[
          ["requesterName", "Your full name"],
          ["email", "Your email"],
          ["phone", "Contact number"],
          ["recipientName", "Name on the parish record"],
          ...(type === "wedding"
            ? [["spouseName", "Other spouse's full name"]]
            : []),
          ...(type === "baptism"
            ? [
                ["fatherName", "Father's full name"],
                ["motherName", "Mother's maiden name"],
              ]
            : []),
          ["sacramentDate", "Sacrament date"],
          ["parish", "Church / place of sacrament"],
          ["purpose", "Purpose of request"],
        ].map(([name, label]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              type={
                name === "email"
                  ? "email"
                  : name === "sacramentDate"
                    ? "date"
                    : name === "phone"
                      ? "tel"
                      : "text"
              }
              required
              maxLength={
                name === "purpose" ? 500 : name === "email" ? 255 : 100
              }
              defaultValue={
                name === "parish" ? "San Antonio de Padua Parish" : undefined
              }
            />
          </label>
        ))}
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Submitting…" : "Submit request"}
        </button>
      </form>
      <div role="status" aria-live="polite">
        {saved && (
          <div className="request-confirmation" ref={confirmRef} tabIndex={-1}>
            <i className="fas fa-circle-check" aria-hidden="true" />
            <div>
              <strong>Your request has been submitted to the parish office.</strong>
              <p>
                Reference <b>{saved.reference}</b> · Status:{" "}
                <span className="status-pill">{saved.status.charAt(0).toUpperCase() + saved.status.slice(1)}</span>
              </p>
              <p>Staff verify the parish record before a certificate is released. The form is cleared for another request.</p>
            </div>
          </div>
        )}
      </div>
      <h3>Requested Certificates</h3>
      <p>
        Guest requests are available in this browser for 30 days. An account
        keeps future requests together.
      </p>
      {rows.map((r) => (
        <article className="portal-card" key={r.id}>
          <strong>
            {r.reference} · {r.type}
          </strong>
          <p>
            Status: {r.status} · Fee: ₱{r.fee}
          </p>
          {r.note && <p>{r.note}</p>}
          {r.documents.map((d) => (
            <FileDownload
              key={d.id}
              href={`/api/documents/${d.id}`}
              previewHref={`/api/documents/${d.id}?preview=1`}
            >
              Download released PDF
            </FileDownload>
          ))}
        </article>
      ))}
    </section>
  );
}
