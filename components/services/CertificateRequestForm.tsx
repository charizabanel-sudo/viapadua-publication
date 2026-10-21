"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { certificateTypes } from "@/lib/certificates/requests";
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
    [notice, setNotice] = useState("");
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
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    requestId.current ||= crypto.randomUUID();
    try {
      const form = Object.fromEntries(new FormData(e.currentTarget));
      const response = await fetch("/api/certificate-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          type,
          clientRequestId: requestId.current,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setNotice(
        `Request ${data.reference} submitted. Status: ${data.status}. Staff must verify the parish record before releasing a certificate.`,
      );
      requestId.current = "";
      onDirtyChange(false);
      const refresh = await fetch("/api/certificate-requests", {
        cache: "no-store",
      });
      if (refresh.ok) setRows((await refresh.json()).requests);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Request failed. Retry safely.",
      );
    } finally {
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
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Submitting…" : "Submit request"}
        </button>
      </form>
      <p role="status">{notice}</p>
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
            <a key={d.id} href={`/api/documents/${d.id}`} download>
              Download released PDF
            </a>
          ))}
        </article>
      ))}
    </section>
  );
}
