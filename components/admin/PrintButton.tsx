"use client";

import { useState } from "react";

/**
 * Opens the server-generated PDF report in a new tab (the browser's PDF viewer
 * has its own Print button). It no longer calls window.print(), so the on-screen
 * analytics cards and bars are never printed.
 */
export default function PrintButton({ label = "Print", href }: { label?: string; href: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function downloadReport() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("application/pdf")) throw new Error("bad response");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = filenameMatch?.[1] ?? "Via_Padua_Report.pdf";
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("The report could not be prepared. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={downloadReport} disabled={busy}>
        <i className="fas fa-print" aria-hidden="true" /> {busy ? "Preparing…" : label}
      </button>
      {error && <span role="alert" style={{ color: "#b3261e", fontSize: 13 }}>{error}</span>}
    </>
  );
}