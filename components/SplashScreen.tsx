"use client";

import { useEffect } from "react";
import { SPLASH_KEY } from "@/lib/splash";

const MIN_VISIBLE_MS = 650;
const REDUCED_MIN_MS = 250;
const FADE_MS = 380;

/** Full-screen church-logo splash, dismissed as soon as the page is ready (with a short minimum). */
export default function SplashScreen() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("vp-splash-on")) return;
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      /* private mode: splash may show again next load, which is harmless */
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let hideTimer = 0;
    let removeTimer = 0;
    const dismiss = () => {
      const wait = Math.max(0, (reduced ? REDUCED_MIN_MS : MIN_VISIBLE_MS) - (performance.now() - started));
      hideTimer = window.setTimeout(() => {
        root.classList.add("vp-splash-leaving");
        removeTimer = window.setTimeout(() => root.classList.remove("vp-splash-on", "vp-splash-leaving"), reduced ? 0 : FADE_MS);
      }, wait);
    };
    // Dismiss once fonts/layout are ready, but never wait on slow images.
    const ready = document.fonts?.ready ?? Promise.resolve();
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      dismiss();
    };
    ready.then(once, once);
    const cap = window.setTimeout(once, 1200);
    return () => {
      window.clearTimeout(cap);
      window.clearTimeout(hideTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  return (
    <div className="vp-splash" aria-hidden="true">
      <div className="vp-splash-inner">
        {/* Inline SVG of the site logo, so the splash never depends on an image request. */}
        <svg className="vp-splash-logo" viewBox="0 0 64 64" width="88" height="88" focusable="false">
          <rect width="64" height="64" rx="14" fill="#ffffff" />
          <g transform="translate(12 16) scale(0.0625)" fill="#123b70">
            <path d="M344 24c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 24-32 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l32 0 0 46.4L183.3 210c-14.5 8.7-23.3 24.3-23.3 41.2L160 512l96 0 0-96c0-35.3 28.7-64 64-64s64 28.7 64 64l0 96 96 0 0-260.8c0-16.9-8.8-32.5-23.3-41.2L344 142.4 344 96l32 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-32 0 0-24zM24.9 330.3C9.5 338.8 0 354.9 0 372.4L0 464c0 26.5 21.5 48 48 48l80 0 0-238.4L24.9 330.3zM592 512c26.5 0 48-21.5 48-48l0-91.6c0-17.5-9.5-33.6-24.9-42.1L512 273.6 512 512l80 0z" />
          </g>
        </svg>
        <div className="vp-splash-name">Via Padua</div>
        <div className="vp-splash-sub">Parish Management System</div>
        <div className="vp-splash-bar">
          <span />
        </div>
      </div>
    </div>
  );
}
