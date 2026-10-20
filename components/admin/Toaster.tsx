"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; ok: boolean; message: string };

const EVENT = "vp-admin-toast";

/** Shows a short-lived result message for admin actions. */
export function showToast(ok: boolean, message: string) {
  window.dispatchEvent(new CustomEvent<{ ok: boolean; message: string }>(EVENT, { detail: { ok, message } }));
}

export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 1;
    const onToast = (e: Event) => {
      const { ok, message } = (e as CustomEvent<{ ok: boolean; message: string }>).detail;
      const id = next++;
      setToasts((list) => [...list.slice(-2), { id, ok, message }]);
      window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ok ? 4500 : 8000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.ok ? "success" : "error"}`}>
          <i className={`fas ${t.ok ? "fa-check-circle" : "fa-exclamation-circle"}`} aria-hidden="true" />
          <span>{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}>
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
