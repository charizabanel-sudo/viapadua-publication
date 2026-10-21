"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

const ABOUT_ID = "aboutSection";

type AboutState = {
  open: boolean;
  reveal: () => void;
  close: () => void;
  sectionRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const reveal = useCallback(() => {
    setOpen(true);
    setScrollRequest((n) => n + 1);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Scroll after the section is rendered visible.
  useEffect(() => {
    if (scrollRequest > 0) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      sectionRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  }, [scrollRequest]);

  return <AboutContext.Provider value={{ open, reveal, close, sectionRef, triggerRef }}>{children}</AboutContext.Provider>;
}

export function LearnMoreButton() {
  const { open, reveal, triggerRef } = useAbout();
  return (
    <button ref={triggerRef} type="button" className="learn-more" onClick={reveal} aria-expanded={open} aria-controls={ABOUT_ID}>
      Learn More
    </button>
  );
}

export function AboutSection({ children }: { children: ReactNode }) {
  const { open, close, sectionRef } = useAbout();
  return (
    <section ref={sectionRef} id={ABOUT_ID} className={open ? "about-section show" : "about-section"} hidden={!open} aria-label="About us">
      <div className="about-section-actions">
        <button type="button" className="about-close" onClick={close} aria-controls={ABOUT_ID}>
          <i className="fas fa-times" aria-hidden="true" /> Close About Us
        </button>
      </div>
      {children}
    </section>
  );
}
