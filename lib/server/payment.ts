import "server-only";

/** Public GCash payee details shown on the booking payment step (homepage and portal). */
export function getGcashPayee() {
  const qrPath = process.env.PARISH_PAYMENT_QR_PATH ?? "";
  return {
    number: process.env.PARISH_GCASH_NUMBER?.trim() || null,
    name: process.env.PARISH_GCASH_NAME?.trim() || null,
    qrPath: /^\/images\/[a-zA-Z0-9/_.-]+$/.test(qrPath) ? qrPath : null,
  };
}
