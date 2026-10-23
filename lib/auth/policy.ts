/** Password rules shared by server validation, the admin CLI and form hints. Safe to import in client code. */
export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt only uses the first 72 bytes; longer new passwords would be silently truncated. */
export const MAX_PASSWORD_BYTES = 72;
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters; maximum ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;

export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Error message for a new password, or null when it is acceptable. Never applied to existing passwords at login. */
export function newPasswordError(value: string): string | null {
  if ([...value].length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (passwordByteLength(value) > MAX_PASSWORD_BYTES) return `Password must fit in ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
  return null;
}
