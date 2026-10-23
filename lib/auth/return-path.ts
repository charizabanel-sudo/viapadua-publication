/** Same-site destinations a parishioner may return to after signing in. */
const ALLOWED = [/^\/portal(?:[/?#]|$)/, /^\/(?:\?|#|$)/, /^\/services(?:[/?#]|$)/];

/** Returns a safe relative path, or null. Rejects absolute, protocol-relative, backslash and admin URLs. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || path.length > 512 || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return null;
  try {
    const url = new URL(path, "https://viapadua.invalid");
    if (url.origin !== "https://viapadua.invalid") return null;
    const normalized = url.pathname + url.search + url.hash;
    if (!ALLOWED.some((rule) => rule.test(normalized))) return null;
    // Never bounce back into a sign-in card.
    url.searchParams.delete("signin");
    url.searchParams.delete("login");
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** Homepage URL that opens the parishioner sign-in card, keeping a safe return destination. */
export function signInHref(next?: string | null): string {
  const safe = safeReturnPath(next);
  const params = new URLSearchParams({ signin: "1" });
  if (safe && safe !== "/portal") params.set("next", safe);
  return `/?${params.toString()}`;
}
