"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const ITEMS = [
  { href: "/admin", label: "Dashboard", icon: "fa-chart-line", exact: true },
  { href: "/admin/claims", label: "Account claims", icon: "fa-user-check" },
  { href: "/admin/scanner", label: "Documents", icon: "fa-camera" },
  { href: "/admin/requests", label: "Certificates", icon: "fa-scroll" },
  { href: "/admin/bookings", label: "Bookings", icon: "fa-book-open" },
  { href: "/admin/events", label: "Events", icon: "fa-calendar-day" },
  { href: "/admin/records", label: "Records", icon: "fa-folder-open" },
  { href: "/admin/calendar", label: "Calendar", icon: "fa-calendar-alt" },
  { href: "/admin/reports", label: "Reports", icon: "fa-chart-bar" },
  { href: "/admin/messages", label: "Messages", icon: "fa-comments" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/admin/messages", { cache: "no-store", signal: controller.signal });
          if (response.status === 401) { setUnread(0); controller.abort(); return; }
          if (response.ok) { const data = await response.json(); if (!controller.signal.aborted) setUnread(data.unread ?? 0); }
        } catch { /* The inbox displays detailed connection errors when opened. */ }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 30000);
    };
    timer = setTimeout(poll, 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return (
    <nav className="sidebar-nav" aria-label="Admin">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
            title={item.label}
            aria-label={item.label}
          >
            <i className={`fas ${item.icon}`} aria-hidden="true" />
            <span>{item.label}</span>
            {item.href === "/admin/messages" && unread > 0 && <span className="message-badge" aria-label={unread + " unread messages"}>{unread}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
