"use client";
import { useState } from "react";
export default function PaymentQr({ path }: { path: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!path || failed)
    return (
      <p className="notice-box">
        The original payment QR is not available yet. Ask the parish office for
        its verified payment instructions.
      </p>
    );
  return (
    <figure className="payment-qr">
      {/* The original file is served unchanged; no image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={path}
        alt="Original parish payment QR with InstaPay and masked recipient details"
        onError={() => setFailed(true)}
      />
      <figcaption>
        Use the details shown on this original QR. A scanned QR or entered
        reference does not verify payment.
      </figcaption>
      <a href={path} download>
        Download original QR image
      </a>
    </figure>
  );
}
