"use client";

import { Suspense, useId, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import AccountForm from "@/components/auth/AccountForm";
import { PublicDialog, ServicesLink, usePublicOverlay } from "@/components/public/PublicOverlayProvider";
import { safeReturnPath } from "@/lib/auth/return-path";

/** Unified sign-in for parishioner and authorized staff accounts. */
export default function UserSignInMenu() {
  const { active, requestOpen } = usePublicOverlay();
  const pathname = usePathname();
  const open = active === "signin";
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (pathname !== "/") return;
    event.preventDefault();
    requestOpen("signin");
  }
  return (
    <>
      <Link href="/?signin=1" scroll={false} className={`nav-btn${open ? " active" : ""}`} aria-haspopup="dialog" aria-controls="public-dialog-signin" aria-expanded={open} onClick={click}>
        Sign in
      </Link>
      <Suspense fallback={null}><UserSignInDialog /></Suspense>
    </>
  );
}

function UserSignInDialog() {
  const { active, requestClose } = usePublicOverlay();
  const params = useSearchParams();
  const titleId = useId();
  const next = active === "signin" ? safeReturnPath(params.get("next")) : null;
  const registerHref = next ? `/account/register?next=${encodeURIComponent(next)}` : "/account/register";
  return (
    <PublicDialog kind="signin" labelledBy={titleId} className="login-layer login-card-workspace">
      <div className="login-card">
        <button type="button" className="login-close" onClick={requestClose} aria-label="Close sign in"><i className="fas fa-times" aria-hidden="true" /></button>
        <div className="login-card-head">
          <div className="login-logo" aria-hidden="true"><i className="fas fa-church" /></div>
        <h2 id={titleId}>Sign In</h2>
        <p>Access your account or parish staff dashboard</p>
        </div>
        {/* Remount after a sign-out/sign-in cycle so stale errors never reappear. */}
        {active === "signin" && <AccountForm idPrefix="home-user-" next={next} />}
        <p className="login-card-foot">
          New here? <Link href={registerHref}>Create an account</Link> · <ServicesLink>Book as a guest</ServicesLink>
        </p>
      </div>
    </PublicDialog>
  );
}
