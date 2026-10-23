"use client";

import { useState } from "react";
import { canShareFile, openBlob, shareBlob } from "@/lib/client/download";

/** Fallback for browsers that ignore downloads (iOS, in-app browsers): open or share the file already fetched. */
export default function FileActions({ blob, filename }: { blob: Blob; filename: string }) {
  const [error, setError] = useState("");
  const shareable = canShareFile(blob, filename);
  return (
    <span className="file-actions">
      <span className="file-actions-label">Not saved?</span>
      <button type="button" className="file-action" onClick={() => openBlob(blob)}>
        <i className="fas fa-up-right-from-square" aria-hidden="true" /> Open
      </button>
      {shareable && (
        <button
          type="button"
          className="file-action"
          onClick={() => {
            setError("");
            shareBlob(blob, filename).catch((e: Error) => setError(e.message));
          }}
        >
          <i className="fas fa-share-from-square" aria-hidden="true" /> Share / save
        </button>
      )}
      {error && <span role="alert" className="file-error">{error}</span>}
    </span>
  );
}
