import SiteHeader from "@/components/SiteHeader";
import DeveloperPhoto from "@/components/DeveloperPhoto";
import HeroBackground from "@/components/home/HeroBackground";
import HeroEmblem from "@/components/home/HeroEmblem";
import ServiceShowcase from "@/components/home/ServiceShowcase";
import { AboutProvider, AboutSection, LearnMoreButton } from "@/components/AboutDisclosure";
import { ServicesLink } from "@/components/public/PublicOverlayProvider";
import ServicesBooking from "@/components/services/ServicesBooking";
import { CONTACTS, DEVELOPERS, SITE } from "@/lib/site";
import { getGcashPayee } from "@/lib/server/payment";

export default function HomePage() {
  return (
    <div className="vp-home">
      <SiteHeader />

      <main>
        <AboutProvider>
          {/* ===== HERO ===== */}
          <section className="hero">
            <HeroBackground />
            <div className="hero-layout"><div className="hero-content">
              <span className="hero-eyebrow">Via Padua · Our parish, together</span>
              <h1><span>Welcome to</span> {SITE.parish}</h1>
              <div className="hero-location">
                <i className="fas fa-map-marker-alt" aria-hidden="true" /> {SITE.location}
              </div>
              <p>Building a community of faith, hope, and love. Join us in worship and fellowship.</p>
              <div className="hero-buttons">
                <ServicesLink className="book-service">
                  Book a Service
                </ServicesLink>
                <LearnMoreButton />
              </div>
            </div><HeroEmblem /></div>
          </section>

          {/* ===== ABOUT / DEVELOPERS (hidden until Learn More) ===== */}
          <AboutSection>
            <div className="about-content">
              <div className="about-badge">
                <i className="fas fa-info-circle" aria-hidden="true" /> About Us
              </div>

              <h2>{SITE.parish} Parish</h2>

              <div className="church-info">
                <h3>
                  <i className="fas fa-map-marker-alt" aria-hidden="true" /> Our Location
                </h3>
                <p>
                  The <strong>{SITE.parish} Parish</strong> is located in <strong>{SITE.location}</strong>. It
                  serves as a spiritual home for the faithful of the community, offering sacraments, worship
                  services, and pastoral care to all who seek guidance and fellowship.
                </p>
              </div>

              <p>
                This parish management system was created with love and dedication by three passionate students who
                wanted to make parish services simpler and more accessible for everyone.
              </p>

              <div className="developers-grid">
                {DEVELOPERS.map((dev) => (
                  <div className="developer-card" key={dev.name}>
                    <DeveloperPhoto name={dev.name} src={dev.photo} />
                    <div className="developer-name">{dev.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </AboutSection>
        </AboutProvider>

        {/* ===== SERVICES ===== */}
        <section className="services" aria-labelledby="services-title">
          <div className="section-title">
            <h2 id="services-title">Our Services</h2>
            <p>Experience the sacraments and services we offer</p>
          </div>
          <ServiceShowcase />
        </section>

        {/* ===== CONTACT ===== */}
        <section className="contact" aria-labelledby="contact-title">
          <div className="contact-title">
            <h2 id="contact-title">Contact Us</h2>
            <p>We&apos;re here to serve you</p>
          </div>
          <div className="contact-grid">
            {CONTACTS.map((item) => (
              <div className="contact-card" key={item.title}>
                <div className="contact-icon" aria-hidden="true">
                  <i className={`fas ${item.icon}`} />
                </div>
                <h3>{item.title}</h3>
                <p>
                  {item.lines.map((line, i) => (
                    <span key={line}>
                      {i > 0 && <br />}
                      {line}
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <ServicesBooking gcashPayee={getGcashPayee()} />
    </div>
  );
}
