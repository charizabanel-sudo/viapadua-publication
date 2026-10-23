/** Human labels for private document kinds; payer uploads are never confused with parish-issued receipts. */
const LABELS: Record<string, string> = {
  payment_proof: "Payment proof (uploaded by payer, not a receipt)",
  payment_receipt: "Parish payment receipt",
  receipt: "Receipt uploaded by the parish office",
  certificate: "Certificate",
  scan: "Scanned document",
};

export function documentLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}
