import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";

export const metadata = { title: "Page not available at Via Padua Parish" };

export default function NotFound() {
  return (
    <div className="vp-home">
      <SiteHeader />
      <main className="pending-page">
        <div>
          <h1>Page not available yet</h1>
          <p>
            This page doesn&apos;t exist, or it is part of the legacy system and still awaiting migration to the new site.
          </p>
          <Link href="/" className="book-service">
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}
