"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { certificateTypes } from "@/lib/certificates/requests";
import { newRequestId, statusMessage, submitJson, UNCERTAIN_MESSAGE } from "@/lib/client/submit";
export default function CertificateRequestForm({
  initialType,
  initialRecipientName = "",
  onBack,
  visible,
  onDirtyChange,
  signedIn = false,
  account,
}: {
  initialType: string;
  initialRecipientName?: string;
  onBack: () => void;
  visible: boolean;
  onDirtyChange: (dirty: boolean) => void;
  signedIn?: boolean;
  account?: { fullname: string; email: string; phone?: string | null };
}) {
  const [type, setType] = useState(initialType),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<{ reference: string; status: string } | null>(null);
  const busyRef = useRef(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const requestId = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visible]);
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
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="portal-form services-step">
      <button type="button" className="btn btn-secondary services-back-button" onClick={onBack}>
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
          ...(!signedIn ? [
            ["requesterName", "Your full name"],
            ["email", "Your email"],
            ["phone", "Contact number"],
          ] : []),
          [
            "recipientName",
            type === "baptism" || type === "confirmation"
              ? "Child's Full Name"
              : "Name on the parish record",
          ],
          ...(type === "wedding"
            ? [["spouseName", "Spouse's full name"]]
            : []),
          ...(type === "baptism"
            ? [
                ["fatherName", "Father's full name (optional)"],
                ["motherName", "Mother's maiden name"],
              ]
            : []),
          ["sacramentDate", "Sacrament date"],
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
              required={name !== "fatherName"}
              maxLength={name === "email" ? 255 : 100}
              defaultValue={
                name === "recipientName" ? initialRecipientName : undefined
              }
            />
          </label>
        ))}
        {signedIn && account && (
          <>
            <input type="hidden" name="requesterName" value={account.fullname} />
            <input type="hidden" name="email" value={account.email} />
            <input type="hidden" name="phone" value={account.phone ?? ""} />
          </>
        )}
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
    </section>
  );
}
