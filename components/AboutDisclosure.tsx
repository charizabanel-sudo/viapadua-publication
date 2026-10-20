"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const ABOUT_ID = "aboutSection";

type AboutState = { open: boolean; reveal: () => void; sectionRef: React.RefObject<HTMLElement | null> };

const AboutContext = createContext<AboutState | null>(null);

function useAbout(): AboutState {
  const ctx = useContext(AboutContext);
  if (!ctx) throw new Error("useAbout must be used inside <AboutProvider>");
  return ctx;
}

export function AboutProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const sectionRef = useRef<HTMLElement | null>(null);

  const reveal = useCallback(() => {
    setOpen(true);
    setScrollRequest((n) => n + 1);
  }, []);

  // Scroll after the section is rendered visible.
  useEffect(() => {
    if (scrollRequest > 0) {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollRequest]);

  return <AboutContext.Provider value={{ open, reveal, sectionRef }}>{children}</AboutContext.Provider>;
}

export function LearnMoreButton() {
  const { open, reveal } = useAbout();
  return (
    <button type="button" className="learn-more" onClick={reveal} aria-expanded={open} aria-controls={ABOUT_ID}>
      Learn More
    </button>
  );
}

export function AboutSection({ children }: { children: ReactNode }) {
  const { open, sectionRef } = useAbout();
  return (
    <section ref={sectionRef} id={ABOUT_ID} className={open ? "about-section show" : "about-section"} aria-label="About us">
      {children}
    </section>
  );
}
