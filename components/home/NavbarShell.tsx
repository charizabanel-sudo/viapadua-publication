"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Sticky navbar that gains a subtle shadow once the page is scrolled (height never changes). */
export default function NavbarShell({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 8);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <header className={`navbar${scrolled ? " scrolled" : ""}`}>{children}</header>;
}
