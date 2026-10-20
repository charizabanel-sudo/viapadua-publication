import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./globals.css";
import "./styles/home.css";
import "./styles/services.css";
import "./styles/admin.css";
import "./styles/admin-ui.css";
import "./styles/admin-modules.css";
import "./styles/certificate-editor.css";
import "./styles/login-card.css";
import "./styles/splash.css";
import "./styles/public-overlays.css";
import "./styles/messaging.css";
import SplashScreen from "@/components/SplashScreen";
import { SPLASH_BOOT_SCRIPT } from "@/lib/splash";
import { PublicOverlayProvider } from "@/components/public/PublicOverlayProvider";
import GuestChat from "@/components/messaging/GuestChat";

export const metadata: Metadata = {
  title: "Via Padua Parish",
  description:
    "Church of San Antonio de Padua Parish in Ponso, Polangui, Albay. Building a community of faith, hope, and love.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#071f42",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-paint splash script may add a class to <html>.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT_SCRIPT }} />
      </head>
      <body>
        <SplashScreen />
        <PublicOverlayProvider>
          {children}
          <GuestChat />
        </PublicOverlayProvider>
      </body>
    </html>
  );
}
