"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  attemptUserAuth,
  registerSchema,
  userLoginSchema,
} from "@/lib/auth/user";
import { safeReturnPath } from "@/lib/auth/return-path";
import { getDb } from "@/lib/server/db";
import { getAuthSecret } from "@/lib/server/env";
import { getClientIp } from "@/lib/server/request";
import { endUserSession, startUserSession } from "@/lib/server/user-auth";
export type AccountState = {
  error?: string;
  field?: "name" | "email" | "password" | "confirm";
  email?: string;
  name?: string;
};
export async function accountAction(
  _previous: AccountState,
  form: FormData,
): Promise<AccountState> {
  const register = form.get("mode") === "register";
  const raw = {
    email: String(form.get("email") ?? "").trim(),
    password: form.get("password"),
  };
  // Typed values (never passwords) are returned so a failed attempt keeps them.
  const keep = {
    email: raw.email.slice(0, 255),
    name: register ? String(form.get("name") ?? "").slice(0, 100) : undefined,
  };
  const parsed = register
    ? registerSchema.safeParse({
        ...raw,
        name: form.get("name"),
        confirm: form.get("confirm"),
        website: form.get("website") ?? "",
      })
    : userLoginSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = String(issue?.path[0] ?? "");
    const field = (["name", "email", "password", "confirm"] as const).find(
      (f) => f === path,
    );
    const message =
      field === "email"
        ? "Enter a valid email address."
        : field === "password" && !register
          ? "Enter your password."
          : (issue?.message ?? "Check your details.");
    return {
      ...keep,
      field: field ?? (issue?.message === "Passwords must match." ? "confirm" : undefined),
      error: message,
    };
  }
  try {
    const result = await attemptUserAuth(getDb(), parsed.data, {
      ip: await getClientIp(),
      secret: getAuthSecret(),
      register,
    });
    if (!result.ok)
      return {
        ...keep,
        error:
          "limited" in result && result.limited
            ? "Too many attempts. Please try again in 15 minutes."
            : register
              ? "Registration could not be completed with those details. If you already have an account, sign in or contact the parish office."
              : "Invalid email or password.",
      };
    await startUserSession(result.userId);
  } catch (e) {
    console.error("[account]", e);
    return {
      ...keep,
      error: "Account access is temporarily unavailable. Please retry.",
    };
  }
  revalidatePath("/", "layout");
  redirect(safeReturnPath(form.get("next")) ?? "/portal");
}
export async function userLogoutAction() {
  await endUserSession();
  revalidatePath("/", "layout");
  redirect("/");
}
