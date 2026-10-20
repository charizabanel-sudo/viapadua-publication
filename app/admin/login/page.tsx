import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/server/auth";

/** Legacy entry point. The homepage login card is the only login UI. */
export default async function AdminLoginRedirect() {
  const admin = await getCurrentAdmin().catch(() => null);
  redirect(admin ? "/admin/bookings" : "/?login=1");
}
