"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
export type FormResult = { ok: boolean; message: string };
export default function FeedbackForm({
  action,
  children,
}: {
  action: (form: FormData) => Promise<FormResult>;
  children: ReactNode;
}) {
  const [result, setResult] = useState<FormResult | null>(null),
    [pending, startTransition] = useTransition(),
    router = useRouter();
  return (
    <form
      className="portal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const data = new FormData(e.currentTarget);
        startTransition(async () => {
          try {
            const response = await action(data);
            setResult(response);
            if (response.ok) router.refresh();
          } catch {
            setResult({
              ok: false,
              message:
                "Request could not be completed. Please retry or sign in again.",
            });
          }
        });
      }}
    >
      <fieldset
        disabled={pending}
        style={{ border: 0, display: "grid", gap: 14 }}
      >
        {children}
      </fieldset>
      {pending && <p role="status">Saving…</p>}
      {result && <p role={result.ok ? "status" : "alert"}>{result.message}</p>}
    </form>
  );
}
