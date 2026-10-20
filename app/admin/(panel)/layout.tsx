import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import AdminNav from "@/components/admin/AdminNav";
import Toaster from "@/components/admin/Toaster";
import { requireAdmin } from "@/lib/server/auth";
import { logoutAction } from "./actions";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Admin — Via Padua Parish",
  robots: { index: false, follow: false },
};

export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const displayName = admin.name.length > 14 ? `${admin.name.slice(0, 14)}…` : admin.name;

  return (
    <div className={`vp-admin ${inter.variable}`}>
      <div className="dashboard">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon" aria-hidden="true">
              <i className="fas fa-church" />
            </div>
            <div className="logo-text">
              <h2>Via Padua</h2>
              <p>Parish Management</p>
            </div>
          </div>

          <AdminNav />

          <div className="sidebar-user">
            <div className="user-left">
              <div className="user-avatar" aria-hidden="true">
                {admin.name.trim().charAt(0).toUpperCase() || "A"}
              </div>
              <div className="user-info">
                <strong title={admin.name}>{displayName}</strong>
                <span>Admin</span>
              </div>
            </div>
            <form action={logoutAction} className="logout-form">
              <button type="submit" className="logout" title="Log out" aria-label="Log out">
                <i className="fas fa-right-from-bracket" aria-hidden="true" />
              </button>
            </form>
          </div>
        </aside>

        <main className="main-content">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
