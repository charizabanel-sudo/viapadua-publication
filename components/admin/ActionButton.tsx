"use client";

import { useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/server/actions/admin";
import { showToast } from "./Toaster";

type Props = {
  action: (formData: FormData) => Promise<ActionResult>;
  fields: Record<string, string | number>;
  /** Asked with window.confirm before running (legacy behaviour for destructive/irreversible actions). */
  confirm?: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
  pendingLabel?: string;
};

/** Runs a server action with a pending state, then reports the result as a toast. */
export default function ActionButton({ action, fields, confirm, className = "btn btn-outline btn-sm", title, ariaLabel, children, pendingLabel }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={ariaLabel}
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
        startTransition(async () => {
          try {
            const result = await action(fd);
            showToast(result.ok, result.message);
          } catch {
            showToast(false, "Request failed. Check your connection and try again.");
          }
        });
      }}
    >
      {pending ? (
        <>
          <span className="spinner sm" aria-hidden="true" /> {pendingLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
