import type { Metadata } from "next";
import Link from "next/link";
import ServicesBooking from "@/components/services/ServicesBooking";

export const metadata: Metadata = {
  title: "Parish Services — Via Padua Parish",
  description: "Service fees, requirements and online booking for the Church of San Antonio de Padua, Ponso, Polangui, Albay.",
};

export default function ServicesPage() {
  const gcashPayee = {
    number: process.env.PARISH_GCASH_NUMBER?.trim() || null,
    name: process.env.PARISH_GCASH_NAME?.trim() || "Church of San Antonio de Padua",
  };

  return (
    <div className="vp-services">
      <header className="navbar">
        <Link href="/" className="logo-container" aria-label="Via Padua home">
          <div className="logo-icon" aria-hidden="true">
            <i className="fas fa-church" />
          </div>
          <div className="logo-text">
            VIAPADUA
            <span>Parish Management System</span>
          </div>
        </Link>
        <nav className="nav-links" aria-label="Main">
          <Link href="/">
            <i className="fas fa-home" aria-hidden="true" /> Home
          </Link>
          <Link href="/services" className="active" aria-current="page">
            <i className="fas fa-file-alt" aria-hidden="true" /> Services
          </Link>
          <Link href="/?login=1" className="nav-admin">
            <i className="fas fa-user-shield" aria-hidden="true" /> Admin Login
          </Link>
        </nav>
      </header>

      <main className="main-container">
        <div className="page-header">
          <h1 className="page-title">Parish Services</h1>
          <p className="page-subtitle">
            View available services and their requirements. Book as a guest — no account needed.
          </p>
        </div>

        <div className="blocked-notice">
          <i className="fas fa-ban" aria-hidden="true" />
          <div>
            <strong>Important:</strong> Bookings are <strong>not allowed on Sundays and Tuesdays</strong>. Please select a
            different day when scheduling your event.
          </div>
        </div>

        <ServicesBooking gcashPayee={gcashPayee} />
      </main>
    </div>
  );
}
