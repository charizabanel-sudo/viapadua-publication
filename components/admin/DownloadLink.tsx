"use client";
import { useState, type ReactNode } from "react";
export default function DownloadLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <a
        className={className}
        href={href}
        download
        aria-disabled={busy}
        onClick={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const url = new URL(href, window.location.href);
            if (url.origin !== location.origin)
              throw Error("Download must use this website.");
            const response = await fetch(url, {
              credentials: "same-origin",
              cache: "no-store",
              redirect: "error",
            });
            if (!response.ok)
              throw Error(
                response.status === 401
                  ? "Your session expired. Sign in again to download this report."
                  : "Download failed. Please retry.",
              );
            const { downloadBlob } = await import("@/lib/certificates/pdf");
            downloadBlob(
              await response.blob(),
              response.headers
                .get("content-disposition")
                ?.match(/filename="([^"]+)"/)?.[1] ?? "ViaPadua.csv",
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "Download failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing…" : children}
      </a>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
