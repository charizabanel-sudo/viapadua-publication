"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

/** Only parallax on larger, hover-capable screens when the user hasn't asked for reduced motion. */
const PARALLAX_QUERY = "(prefers-reduced-motion: no-preference) and (min-width: 768px) and (hover: hover)";
const SPEED = 0.25;

/**
 * Decorative hero background: parish altar photo under a navy gradient with a faint light/pattern layer.
 * Parallax is a translate3d on this layer only; foreground text never moves and scrolling is never intercepted.
 */
export default function HeroBackground() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const hero = layer?.parentElement;
    if (!layer || !hero) return;

    const mql = window.matchMedia(PARALLAX_QUERY);
    let frame = 0;

    const apply = () => {
      frame = 0;
      // Stop updating once the hero is fully off-screen.
      if (hero.getBoundingClientRect().bottom < 0) return;
      // The hero sits at the top of the page, so scroll distance drives the offset (0 at the top).
      // The layer moves slower than the page, so any gap it opens stays above the visible area.
      layer.style.transform = `translate3d(0, ${Math.round(Math.max(0, window.scrollY) * SPEED)}px, 0)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const sync = () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      frame = 0;
      if (mql.matches) {
        window.addEventListener("scroll", onScroll, { passive: true });
        apply();
      } else {
        layer.style.transform = "";
      }
    };

    sync();
    mql.addEventListener("change", sync);
    return () => {
      mql.removeEventListener("change", sync);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="hero-bg" ref={layerRef} aria-hidden="true">
      <Image
        src="/images/church/altar.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        quality={60}
        className="hero-photo"
      />
      <div className="hero-overlay" />
      <div className="hero-pattern" />
    </div>
  );
}
