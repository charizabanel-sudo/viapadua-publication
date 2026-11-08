"use server";

import { redirect } from "next/navigation";
import { attemptAdminLogin, loginSchema } from "@/lib/auth/login";
import { startAdminSession } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ConfigError, getAuthSecret } from "@/lib/server/env";
import { getClientIp } from "@/lib/server/request";
import { attemptUserAuth, userLoginSchema } from "@/lib/auth/user";
import { startUserSession } from "@/lib/server/user-auth";
import { safeReturnPath } from "@/lib/auth/return-path";

export type LoginState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
  email?: string;
};

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  const rawPassword = formData.get("password") ?? "";
  const parsed = loginSchema.safeParse({ email, password: rawPassword });
  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "email" | "password";
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, email: email.slice(0, 255) };
  }

  let result: Awaited<ReturnType<typeof attemptAdminLogin>> | undefined;
  let destination: string | undefined;
  try {
    const db = getDb();
    const admin = await db.admin.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });
    if (admin) {
      result = await attemptAdminLogin(db, {
        email: parsed.data.email,
        password: parsed.data.password,
        ip: await getClientIp(),
        secret: getAuthSecret(),
      });
      if (result.ok) {
        await startAdminSession(result.admin.id);
        destination = "/admin";
      }
    } else {
      const userParsed = userLoginSchema.safeParse(parsed.data);
      if (!userParsed.success) throw new Error("User login validation failed.");
      const userResult = await attemptUserAuth(db, userParsed.data, {
        ip: await getClientIp(),
        secret: getAuthSecret(),
      });
      if (userResult.ok) {
        await startUserSession(userResult.userId);
        destination = safeReturnPath(formData.get("next")) ?? "/portal";
      }
      if ("limited" in userResult && userResult.limited) {
        return {
          error: "Too many failed attempts. Please wait and try again.",
          email: parsed.data.email,
        };
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "NEXT_REDIRECT" ||
        String((error as Error & { digest?: unknown }).digest ?? "").startsWith("NEXT_REDIRECT"))
    ) throw error;
    console.error("[login]", error instanceof ConfigError ? error.message : error);
    return { error: "Sign-in is temporarily unavailable. Please try again later.", email: parsed.data.email };
  }

  if (result && !result.ok) {
    if (result.reason === "rate_limited") {
      const minutes = Math.max(1, Math.ceil(result.retryAfterSec / 60));
      return {
        error: `Too many failed attempts. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
        email: parsed.data.email,
      };
    }
  }

  if (destination) redirect(destination);
  return { error: "Invalid email or password.", email: parsed.data.email };
}
