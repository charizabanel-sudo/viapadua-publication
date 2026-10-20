"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Dashboard", icon: "fa-chart-line", exact: true },
  { href: "/admin/bookings", label: "Bookings", icon: "fa-book-open" },
  { href: "/admin/events", label: "Events", icon: "fa-calendar-day" },
  { href: "/admin/records", label: "Records", icon: "fa-folder-open" },
  { href: "/admin/calendar", label: "Calendar", icon: "fa-calendar-alt" },
  { href: "/admin/reports", label: "Reports", icon: "fa-chart-bar" },
];

export default function AdminNav() {
  const pathname = usePathname();
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
          >
            <i className={`fas ${item.icon}`} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
