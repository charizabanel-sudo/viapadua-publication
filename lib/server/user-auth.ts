import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { hashSessionToken, SESSION_TTL_MS } from "@/lib/auth/session";
import type { Actor } from "@/lib/portal/access";
import { signInHref } from "@/lib/auth/return-path";
import { getCurrentAdmin } from "./auth";
import { getDb } from "./db";
import { isProduction } from "./env";

export const userCookieName = () =>
  isProduction() ? "__Host-vp_user_session" : "vp_user_session";
const guestCookieName = () =>
  isProduction() ? "__Host-vp_guest_services" : "vp_guest_services";
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(userCookieName())?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await getDb().userSession.findUnique({
    where: { id: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          fullname: true,
          email: true,
          isActive: true,
          role: true,
        },
      },
    },
  });
  if (
    !session ||
    session.expiresAt <= new Date() ||
    !session.user.isActive ||
    session.user.role !== "user"
  )
    return null;
  return {
    id: session.user.id,
    name: session.user.fullname,
    email: session.user.email,
  };
});
/** Signed-out (or expired) visitors land on the homepage sign-in card, returning to `next` afterwards. */
export async function requireUser(next = "/portal") {
  const user = await getCurrentUser();
  if (!user) redirect(signInHref(next));
  return user;
}
export async function startUserSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb().userSession.create({
    data: { id: hashSessionToken(token), userId, expiresAt },
  });
  await getDb().userSession.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });
  (await cookies()).set(userCookieName(), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}
export async function endUserSession() {
  const store = await cookies();
  const token = store.get(userCookieName())?.value;
  if (token)
    await getDb().userSession.deleteMany({
      where: { id: hashSessionToken(token) },
    });
  store.delete({ name: userCookieName(), secure: isProduction(), path: "/" });
}
export async function guestAccess(create = false) {
  const store = await cookies();
  let token = store.get(guestCookieName())?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    if (!create) return undefined;
    token = randomBytes(32).toString("base64url");
  }
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  if (create)
    store.set(guestCookieName(), token, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  return { hash: hashSessionToken(token), expiresAt };
}
export async function getActor(): Promise<Actor> {
  const [admin, user, guest] = await Promise.all([
    getCurrentAdmin(),
    getCurrentUser(),
    guestAccess(),
  ]);
  return { adminId: admin?.id, userId: user?.id, guestHash: guest?.hash };
}
