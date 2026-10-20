export type CertificateKind = "confirmation" | "marriage" | "baptism" | "generic";

export type CertificateFieldDef = { key: string; label: string; full?: boolean };

/** Booking shape expected by the legacy renderer (guest contact details mapped to userName). */
export type CertificateBooking = {
  service: string;
  date: string;
  location?: string | null;
  details?: Record<string, unknown> | null;
  userName: string;
};

export type CertificateValues = Record<string, string | number>;

export const CERT_FIELDS: Record<CertificateKind, CertificateFieldDef[]>;
export function certKind(service: string): CertificateKind;
export function certPrefill(booking: CertificateBooking, cert: Record<string, unknown>): CertificateValues;
/** `edit: true` adds data-f field markers and editor-only placeholders (never used for printing). */
export function getCertificateHTML(booking: CertificateBooking, cert: Record<string, unknown>, opts?: { edit?: boolean }): string;
export function getCertificateCSS(): string;
