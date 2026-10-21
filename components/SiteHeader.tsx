import AccountLink from "@/components/auth/AccountLink";
import Link from "next/link";
import AdminLoginMenu from "@/components/home/AdminLoginMenu";
import NavbarShell from "@/components/home/NavbarShell";
import { SITE } from "@/lib/site";

export default function SiteHeader() {
  return (
    <NavbarShell>
      <div className="nav-container">
        <Link href="/" className="logo" aria-label={`${SITE.name} home`}>
          <div className="logo-box" aria-hidden="true">
            <i className="fas fa-church" />
          </div>
          <div className="logo-text">
            <h3>{SITE.name}</h3>
            <span>{SITE.tagline}</span>
          </div>
        </Link>
        <nav className="nav-buttons" aria-label="Main">
          <AccountLink />
          <AdminLoginMenu />
        </nav>
      </div>
    </NavbarShell>
  );
}
