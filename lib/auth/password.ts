import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH } from "./policy";

export const BCRYPT_COST = 12;
export const MIN_ADMIN_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH;

const BCRYPT_HASH = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;

/** True for bcrypt hashes, including PHP password_hash() output ($2y$). */
export function isBcryptHash(hash: string): boolean {
  return BCRYPT_HASH.test(hash);
}

/** PHP's $2y$ is the same algorithm as $2b$; normalize so any bcrypt implementation accepts it. */
function normalize(hash: string): string {
  return hash.startsWith("$2y$") ? `$2b$${hash.slice(4)}` : hash;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!isBcryptHash(hash)) return false;
  return bcrypt.compare(plain, normalize(hash));
}

/** Legacy $2y$/low-cost hashes are upgraded after a successful login. */
export function needsRehash(hash: string): boolean {
  const m = BCRYPT_HASH.exec(hash);
  return !m || !hash.startsWith("$2b$") || Number(m[1]) < BCRYPT_COST;
}

let dummyHash: Promise<string> | null = null;

/** Hash compared against when the email is unknown, so response time doesn't reveal which admins exist. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("vp-dummy-password-for-timing", BCRYPT_COST);
  return dummyHash;
}
