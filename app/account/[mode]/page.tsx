import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import AccountForm from "@/components/auth/AccountForm";
import { getCurrentAdmin } from "@/lib/server/auth";
import { getCurrentUser } from "@/lib/server/user-auth";
export default async function AccountPage({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = await params;
  if (!["login", "register"].includes(mode)) notFound();
  if (await getCurrentAdmin()) redirect("/admin");
  if (await getCurrentUser()) redirect("/portal");
  return (
    <>
      <SiteHeader />
      <main className="portal-content portal-auth portal-card">
        <h1>{mode === "register" ? "Create your account" : "Welcome back"}</h1>
        <p>Manage your parish bookings, receipts and certificate requests.</p>
        <AccountForm register={mode === "register"} />
        <p>
          <Link
            href={mode === "register" ? "/account/login" : "/account/register"}
          >
            {mode === "register"
              ? "Already registered? Sign in"
              : "Create an account"}
          </Link>
        </p>
        <p>
          Legacy accounts can use their existing password. Contact the parish
          office if access is unavailable.
        </p>
        <Link href="/services">Continue with guest services</Link>
      </main>
    </>
  );
}
