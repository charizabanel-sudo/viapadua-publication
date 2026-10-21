import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSession, deleteSession, findActiveSession, type SessionAdmin } from "@/lib/auth/session";
import { getDb } from "./db";
import { isProduction } from "./env";
import { getUserAgent } from "./request";

/** "__Host-" prefix (HTTPS only) pins the cookie to this host and path "/". */
export function sessionCookieName(): string {
  return isProduction() ? "__Host-vp_admin_session" : "vp_admin_session";
}

/** Download handlers use their incoming request cookie, with the same session rules as pages. */
export async function getAdminForRequest(request: { cookies: { get(name: string): { value: string } | undefined } }): Promise<SessionAdmin | null> {
  const token = request.cookies.get(sessionCookieName())?.value;
  return token ? findActiveSession(getDb(), token) : null;
}

export async function startAdminSession(adminId: number): Promise<void> {
  const { token, expiresAt } = await createSession(getDb(), adminId, await getUserAgent());
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token) await deleteSession(getDb(), token);
  // __Host- cookies also require Secure and Path=/ on the expiry response.
  store.delete({ name: sessionCookieName(), secure: isProduction(), path: "/" });
}

/** Current admin for this request, or null. Cached per request. */
export const getCurrentAdmin = cache(async (): Promise<SessionAdmin | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  return findActiveSession(getDb(), token);
});

/** Server-side authorization guard for admin pages and server actions. */
export async function requireAdmin(): Promise<SessionAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/?login=1");
  return admin;
}
