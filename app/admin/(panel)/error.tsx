"use client";

import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card error-state" role="alert">
      <i className="fas fa-triangle-exclamation" aria-hidden="true" />
      <h2>Something went wrong</h2>
      <p>This page couldn&apos;t load. Check the database connection and try again.</p>
      <button type="button" className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
