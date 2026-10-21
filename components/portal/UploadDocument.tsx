"use client";
import { useState, type FormEvent } from "react";
export default function UploadDocument({
  bookingId,
  requestId,
  kind = "payment_proof",
  onUploaded,
}: {
  bookingId?: number;
  requestId?: string;
  kind?: string;
  onUploaded?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    form.set("kind", kind);
    if (bookingId) form.set("bookingId", String(bookingId));
    if (requestId) form.set("requestId", requestId);
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/documents", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setMessage(
        kind === "payment_proof"
          ? "Evidence received. Payment remains unverified until staff review."
          : "Document saved privately.",
      );
      onUploaded?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="portal-form upload-form" onSubmit={submit}>
      <label>
        {kind === "payment_proof"
          ? "Submit payment evidence"
          : `Upload ${kind}`}
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,application/pdf"
          required
        />
      </label>
      <small>JPEG, PNG or PDF · up to 3 MB · private storage</small>
      {["certificate", "receipt"].includes(kind) && (
        <label className="check-label">
          <input type="checkbox" name="verified" value="true" required />I
          verified the parish record / official receipt and authorize release.
        </label>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Uploading…" : "Upload"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
