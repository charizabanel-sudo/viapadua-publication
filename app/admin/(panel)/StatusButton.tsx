"use client";

import { useFormStatus } from "react-dom";
import { updateBookingStatusAction } from "./actions";

const LABELS = {
  confirm: { short: "Confirm", long: "Confirm Booking", question: "Confirm this booking?", className: "approve-button", icon: "M5 12l4 4L19 6" },
  cancel: { short: "Cancel", long: "Cancel Booking", question: "Cancel this booking? This cannot be undone here.", className: "reject-button", icon: "M6 6l12 12M18 6L6 18" },
} as const;

type Props = { bookingId: number; reference: string; action: keyof typeof LABELS; returnTo: string; size?: "short" | "long" };

/** Confirm/cancel form; asks for confirmation like the legacy admin page. */
export default function StatusButton({ bookingId, reference, action, returnTo, size = "short" }: Props) {
  const label = LABELS[action];
  return (
    <form
      action={updateBookingStatusAction}
      onSubmit={(e) => {
        if (!window.confirm(`${label.question}\n\nReference: ${reference}`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton className={label.className} icon={label.icon} text={size === "long" ? label.long : label.short} />
    </form>
  );
}

function SubmitButton({ className, icon, text }: { className: string; icon: string; text: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={`action-button ${className}`} type="submit" disabled={pending}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={icon} />
      </svg>
      {pending ? "Saving…" : text}
    </button>
  );
}
