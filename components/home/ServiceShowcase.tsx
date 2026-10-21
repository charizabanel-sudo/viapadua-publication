"use client";

import { useRef, useState } from "react";
import { SERVICE_CARDS, formatPeso } from "@/lib/booking/catalog";
import { ServicesLink } from "@/components/public/PublicOverlayProvider";

export default function ServiceShowcase() {
  const [active, setActive] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const count = SERVICE_CARDS.length;
  const move = (direction: number) => setActive((index) => (index + direction + count) % count);
  return <div className="service-showcase" role="region" aria-roledescription="carousel" aria-label="Parish services"
    onKeyDown={(event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
    }}>
    <div className="showcase-stage" onTouchStart={(event) => { const touch = event.touches[0]; start.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={(event) => { const touch = event.changedTouches[0], first = start.current; start.current = null; if (first && Math.abs(touch.clientX - first.x) > 55 && Math.abs(touch.clientY - first.y) < 70) move(touch.clientX < first.x ? 1 : -1); }}>
      {SERVICE_CARDS.map((card, index) => {
        const offset = (index - active + count) % count;
        const position = offset === 0 ? "active" : offset === 1 ? "next" : offset === count - 1 ? "previous" : "away";
        return <article key={card.slug} className={`showcase-card ${position}`} aria-roledescription="slide" aria-label={`${index + 1} of ${count}: ${card.title}`} aria-hidden={index !== active} inert={index !== active}>
          <div className="showcase-top"><span className="showcase-icon"><i className={`fas ${card.icon}`} aria-hidden="true" /></span><span className="showcase-category">Parish services</span></div>
          <h3>{card.title}</h3><p className="showcase-subtitle">{card.subtitle}</p>
          <p className="showcase-description">{card.about}</p>
          <div className="showcase-price"><span>Service offering</span><strong>{formatPeso(card.fee)}</strong></div>
          <details><summary>View requirements</summary><ul>{card.requirements.map((item) => <li key={item}>{item}</li>)}</ul></details>
          <div className="showcase-actions"><ServicesLink service={card.serviceCodes.length > 1 ? card.slug : card.serviceCodes[0]} className="showcase-book">Book {card.title}<i className="fas fa-arrow-right" aria-hidden="true" /></ServicesLink>
            {card.certificate && <ServicesLink service={card.slug} step="certificate" className="showcase-certificate">Request Certificate <span>{formatPeso(card.certificate.fee)}</span></ServicesLink>}
          </div>
        </article>;
      })}
    </div>
    <div className="showcase-controls"><button type="button" onClick={() => move(-1)} aria-label="Previous service"><i className="fas fa-arrow-left" aria-hidden="true" /></button><p aria-live="polite" aria-atomic="true"><strong>{String(active + 1).padStart(2, "0")}</strong><span> / {String(count).padStart(2, "0")} · {SERVICE_CARDS[active].title}</span></p><button type="button" onClick={() => move(1)} aria-label="Next service"><i className="fas fa-arrow-right" aria-hidden="true" /></button></div>
    <p className="showcase-note">Browse freely. Book as a guest or manage requests with your account.</p>
  </div>;
}
