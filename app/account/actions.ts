"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  attemptUserAuth,
  registerSchema,
  userLoginSchema,
} from "@/lib/auth/user";
import { getDb } from "@/lib/server/db";
import { getAuthSecret } from "@/lib/server/env";
import { getClientIp } from "@/lib/server/request";
import { endUserSession, startUserSession } from "@/lib/server/user-auth";
export async function accountAction(
  _previous: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const register = form.get("mode") === "register";
  const raw = {
    email: String(form.get("email") ?? "").trim(),
    password: form.get("password"),
  };
  const parsed = register
    ? registerSchema.safeParse({
        ...raw,
        name: form.get("name"),
        confirm: form.get("confirm"),
        website: form.get("website") ?? "",
      })
    : userLoginSchema.safeParse(raw);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  try {
    const result = await attemptUserAuth(getDb(), parsed.data, {
      ip: await getClientIp(),
      secret: getAuthSecret(),
      register,
    });
    if (!result.ok)
      return {
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
      error: "Account access is temporarily unavailable. Please retry.",
    };
  }
  revalidatePath("/", "layout");
  redirect("/portal");
}
export async function userLogoutAction() {
  await endUserSession();
  revalidatePath("/", "layout");
  redirect("/");
}
