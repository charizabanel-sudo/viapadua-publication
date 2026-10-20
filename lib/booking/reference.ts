import { randomInt } from "node:crypto";

/** Crockford-style alphabet without I, L, O, U (unambiguous when read aloud or retyped). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Random, non-sequential public reference, e.g. "VP-7K3M-9Q2X". */
export function generateBookingReference(): string {
  let body = "";
  for (let i = 0; i < 8; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return `VP-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** Deterministic reference for imported legacy rows ("L" never appears in generated references). */
export function legacyBookingReference(id: number): string {
  return `VP-L${String(id).padStart(6, "0")}`;
}

export function isBookingReference(value: string): boolean {
  return /^VP-(?:[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}|L\d{6,})$/.test(value);
}
