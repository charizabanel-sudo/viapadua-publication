"use client";

import { useState, useTransition, type FormEvent } from "react";
import { updateReceiptNumberAction } from "@/lib/server/actions/admin";
import { showToast } from "./Toaster";

export default function ReceiptNumberEditor({
  receiptId,
  receiptNumber,
}: {
  receiptId: string;
  receiptNumber: string;
}) {
  const [value, setValue] = useState(receiptNumber);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await updateReceiptNumberAction(formData);
        showToast(result.ok, result.message);
        if (result.ok) setValue(String(formData.get("receiptNumber")).trim());
      } catch {
        showToast(false, "Request failed. Check your connection and try again.");
      }
    });
  }

  return (
    <form className="receipt-number-editor" onSubmit={save}>
      <input type="hidden" name="receiptId" value={receiptId} />
      <label>
        Receipt number
        <input
          name="receiptNumber"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={32}
          pattern="[A-Za-z0-9][A-Za-z0-9/-]{0,31}"
          required
          aria-label={`Receipt number ${receiptNumber}`}
        />
      </label>
      <button
        type="submit"
        className="btn btn-outline btn-sm"
        disabled={pending || value.trim() === receiptNumber}
        aria-busy={pending}
      >
        {pending ? "Saving…" : "Update number"}
      </button>
    </form>
  );
}
