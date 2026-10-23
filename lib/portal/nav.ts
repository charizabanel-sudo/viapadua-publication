/** Parishioner portal sections. Paths stay `/portal?tab=<tab>` so existing deep links keep working. */
export type PortalTab = "bookings" | "calendar" | "receipts" | "certificates" | "messages";

export const PORTAL_NAV: readonly { tab: PortalTab; label: string; icon: string }[] = [
  { tab: "bookings", label: "My Bookings", icon: "fa-book-open" },
  { tab: "calendar", label: "Calendar", icon: "fa-calendar-alt" },
  { tab: "receipts", label: "Receipts", icon: "fa-receipt" },
  { tab: "certificates", label: "Requested Certificates", icon: "fa-scroll" },
  { tab: "messages", label: "Messages", icon: "fa-comments" },
];

export function isPortalTab(value: unknown): value is PortalTab {
  return PORTAL_NAV.some((n) => n.tab === value);
}
