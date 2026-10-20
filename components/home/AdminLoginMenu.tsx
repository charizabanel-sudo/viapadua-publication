"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LoginForm from "@/components/auth/LoginForm";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Three-line trigger + centered admin login card (the only login UI).
 * `/?login=1` opens it automatically (used by /admin/login, /login and protected-page redirects).
 * Uses the existing login server action: validation, rate limiting and sessions are unchanged.
 */
export default function AdminLoginMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const dialogId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // `/?login=1` → open the card, then drop the flag so refresh/back don't reopen it.
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("login") !== "1") return;
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("login");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      setOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    emailRef.current?.focus();

    // Lock background scroll without layout shift.
    const { body, documentElement } = document;
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    const prev = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      // Trap focus inside the card.
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = prev.overflow;
      body.style.paddingRight = prev.paddingRight;
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`admin-trigger${open ? " active" : ""}`}
        aria-label="Admin login"
        title="Admin login"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => setOpen(true)}
      >
        <span className="bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {open &&
        createPortal(
          <div className="login-layer">
            <div className="login-backdrop" onMouseDown={close} aria-hidden="true" />
            <div className="login-card" id={dialogId} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
              <button type="button" className="login-close" onClick={close} aria-label="Close login">
                <i className="fas fa-times" aria-hidden="true" />
              </button>
              <div className="login-card-head">
                <div className="login-logo" aria-hidden="true">
                  <i className="fas fa-church" />
                </div>
                <h2 id={titleId}>Admin Sign In</h2>
                <p>Via Padua Parish · authorized staff only</p>
              </div>
              <LoginForm idPrefix="home-admin-" emailRef={emailRef} />
              <p className="login-card-foot">
                Parishioners don&apos;t need an account — <Link href="/services">book a service</Link>.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
