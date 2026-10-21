"use server";

import { redirect } from "next/navigation";
import { attemptAdminLogin, loginSchema } from "@/lib/auth/login";
import { startAdminSession } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ConfigError, getAuthSecret } from "@/lib/server/env";
import { getClientIp } from "@/lib/server/request";

export type LoginState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
  email?: string;
};

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  const parsed = loginSchema.safeParse({ email, password: formData.get("password") ?? "" });
  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "email" | "password";
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, email: email.slice(0, 255) };
  }

  let result;
  try {
    result = await attemptAdminLogin(getDb(), {
      email: parsed.data.email,
      password: parsed.data.password,
      ip: await getClientIp(),
      secret: getAuthSecret(),
    });
    if (result.ok) await startAdminSession(result.admin.id);
  } catch (error) {
    console.error("[admin-login]", error instanceof ConfigError ? error.message : error);
    return { error: "Sign-in is temporarily unavailable. Please try again later.", email: parsed.data.email };
  }

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const minutes = Math.max(1, Math.ceil(result.retryAfterSec / 60));
      return {
        error: `Too many failed attempts. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
        email: parsed.data.email,
      };
    }
    return { error: "Invalid email or password.", email: parsed.data.email };
  }

  redirect("/admin");
}
