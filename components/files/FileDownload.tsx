"use client";

import { useRef, useState, type ReactNode } from "react";
import { fetchFile, saveBlob } from "@/lib/client/download";

export const DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export const CSV_TYPES = ["text/csv"] as const;

/**
 * Authenticated download link. The href still works without JavaScript; with it, the response
 * is checked before saving and a readable error replaces any "Unauthorized" page.
 */
export default function FileDownload({
  href,
  children,
  className,
  accept = DOCUMENT_TYPES,
  fallbackName = "ViaPadua-document",
  previewHref,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  accept?: readonly string[];
  fallbackName?: string;
  /** Inline version of the same file for Open / print in a new tab. */
  previewHref?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  return (
    <span className="file-download">
      <a
        className={className}
        href={href}
        download
        aria-busy={busy}
        aria-disabled={busy || undefined}
        onClick={async (event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setError("");
          try {
            const fetched = await fetchFile(href, accept, fallbackName);
            saveBlob(fetched.blob, fetched.filename);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Download failed. Please retry.");
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <>
            <i className="fas fa-circle-notch fa-spin" aria-hidden="true" /> Preparing…
          </>
        ) : (
          children
        )}
      </a>
      {error && (
        <span role="alert" className="file-error">
          {error}
        </span>
      )}
      {previewHref && (
        <a
          className={className}
          href={previewHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {" "}Open
        </a>
      )}
    </span>
  );
}
