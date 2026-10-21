import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/server/auth";

/** Old/guessable login URL → homepage login card. */
export default async function LoginRedirect() {
  const admin = await getCurrentAdmin().catch(() => null);
  redirect(admin ? "/admin" : "/?login=1");
}
