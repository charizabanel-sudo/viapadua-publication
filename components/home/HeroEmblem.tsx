"use client";

import { useRef, type PointerEvent } from "react";

export default function HeroEmblem() {
  const ref = useRef<HTMLDivElement>(null);
  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (!window.matchMedia("(hover: hover) and (min-width: 900px) and (prefers-reduced-motion: no-preference)").matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    ref.current?.style.setProperty("--tilt-x", `${-(event.clientY - box.top - box.height / 2) / 35}deg`);
    ref.current?.style.setProperty("--tilt-y", `${(event.clientX - box.left - box.width / 2) / 35}deg`);
  }
  function reset() {
    ref.current?.style.setProperty("--tilt-x", "0deg");
    ref.current?.style.setProperty("--tilt-y", "0deg");
  }
  return <div className="hero-emblem-scene" aria-hidden="true" onPointerMove={tilt} onPointerLeave={reset}>
    <div className="emblem-orbit" />
    <div className="hero-emblem" ref={ref}>
      <div className="emblem-edge" />
      <div className="emblem-face"><i className="fas fa-church" /><span>VIA PADUA</span><small>FAITH · HOPE · LOVE</small></div>
    </div>
    <span className="emblem-caption">A spiritual home. A connected community.</span>
  </div>;
}
