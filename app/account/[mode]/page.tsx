import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import AccountForm from "@/components/auth/AccountForm";
import { safeReturnPath, signInHref } from "@/lib/auth/return-path";
import { getCurrentAdmin } from "@/lib/server/auth";
import { getCurrentUser } from "@/lib/server/user-auth";
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ mode: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { mode } = await params;
  if (!["login", "register"].includes(mode)) notFound();
  const raw = (await searchParams).next;
  const next = safeReturnPath(Array.isArray(raw) ? raw[0] : raw);
  if (await getCurrentUser()) redirect(next ?? "/portal");
  // Sign-in is a floating card on the homepage; this old URL opens it.
  if (mode === "login") redirect(signInHref(next));
  if (await getCurrentAdmin()) redirect("/admin");
  return (
    <>
      <SiteHeader />
      <main className="portal-content portal-auth portal-card">
        <span className="login-role">Parishioner account</span>
        <h1>Create your account</h1>
        <p>Manage your parish bookings, receipts and certificate requests.</p>
        <AccountForm register next={next} idPrefix="register-" />
        <p>
          <Link href={signInHref(next)}>Already registered? Sign in</Link>
        </p>
        <p>
          Legacy accounts can use their existing password. Contact the parish
          office if access is unavailable.
        </p>
        <Link href="/?services=1">Continue with guest services</Link>
      </main>
    </>
  );
}
