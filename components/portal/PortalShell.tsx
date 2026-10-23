"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ServicesLink } from "@/components/public/PublicOverlayProvider";
import { PORTAL_NAV, type PortalTab } from "@/lib/portal/nav";

/**
 * Parishioner portal frame: a sidebar on wide screens, an accessible slide-in drawer on phones.
 * Links keep the existing `/portal?tab=` deep links.
 */
export default function PortalShell({ tab, userName, logout, children }: { tab: PortalTab; userName: string; logout: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  // The phone menu bar sticks directly below the site navbar, whose height changes when it wraps.
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>("header.navbar");
    const shell = shellRef.current;
    if (!nav || !shell) return;
    const sync = () => shell.style.setProperty("--portal-bar-top", `${nav.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  const current = PORTAL_NAV.find((n) => n.tab === tab)!;

  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const items = [...drawer.querySelectorAll<HTMLElement>("a[href],button:not([disabled])")];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <div ref={shellRef} className={`portal-shell${open ? " drawer-open" : ""}`}>
      <div className="portal-mobilebar">
        <button
          ref={toggleRef}
          type="button"
          data-overlay-return
          className="portal-menu-btn"
          aria-expanded={open}
          aria-controls={drawerId}
          onClick={() => setOpen((v) => !v)}
        >
          <i className={`fas ${open ? "fa-times" : "fa-bars"}`} aria-hidden="true" />
          <span>{open ? "Close menu" : "Portal menu"}</span>
        </button>
        <span className="portal-mobile-title">
          <i className={`fas ${current.icon}`} aria-hidden="true" /> {current.label}
        </span>
      </div>
      <div
        className="portal-drawer-backdrop"
        aria-hidden="true"
        onClick={() => {
          setOpen(false);
          toggleRef.current?.focus();
        }}
      />
      <aside
        id={drawerId}
        ref={drawerRef}
        className="portal-sidebar"
        aria-label="Portal"
        {...(open ? { role: "dialog", "aria-modal": true } : {})}
      >
        <div className="portal-user">
          <span className="portal-avatar" aria-hidden="true">
            {userName.trim().charAt(0).toUpperCase() || "P"}
          </span>
          <span className="portal-user-text">
            <strong title={userName}>{userName}</strong>
            <small>Parishioner account</small>
          </span>
        </div>
        <nav aria-label="Your portal">
          <ul className="portal-nav">
            {PORTAL_NAV.map((item) => (
              <li key={item.tab}>
                <Link
                  href={`/portal?tab=${item.tab}`}
                  className={`portal-nav-item${item.tab === tab ? " active" : ""}`}
                  aria-current={item.tab === tab ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <i className={`fas ${item.icon}`} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="portal-sidebar-foot">
          {/* Opening the services card closes the phone drawer first. */}
          <span className="portal-book-wrap" onClickCapture={() => setOpen(false)}>
          <ServicesLink className="portal-book">
            <i className="fas fa-calendar-plus" aria-hidden="true" /> Book / request a certificate
          </ServicesLink>
          </span>
          {logout}
        </div>
      </aside>
      <main className="portal-main portal-content" id="portal-main">
        {children}
      </main>
    </div>
  );
}
