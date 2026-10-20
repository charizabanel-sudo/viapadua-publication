import SiteHeader from "@/components/SiteHeader";
import DeveloperPhoto from "@/components/DeveloperPhoto";
import HeroBackground from "@/components/home/HeroBackground";
import { AboutProvider, AboutSection, LearnMoreButton } from "@/components/AboutDisclosure";
import { ServicesLink } from "@/components/public/PublicOverlayProvider";
import ServicesBooking from "@/components/services/ServicesBooking";
import { CONTACTS, DEVELOPERS, SERVICES, SITE } from "@/lib/site";

export default function HomePage() {
  return (
    <div className="vp-home">
      <SiteHeader />

      <main>
        <AboutProvider>
          {/* ===== HERO ===== */}
          <section className="hero">
            <HeroBackground />
            <div className="hero-content">
              <div className="hero-main-icon" aria-hidden="true">
                <i className="fas fa-church" />
              </div>
              <h1>Welcome to {SITE.parish}</h1>
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
            </div>
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
          <div className="services-grid">
            {SERVICES.map((service) => (
              <div className="service-card" key={service.title}>
                <div className={`service-icon icon-${service.color}`} aria-hidden="true">
                  <i className={`fas ${service.icon}`} />
                </div>
                <h3>{service.title}</h3>
                <p>{service.description}</p>
                <ServicesLink
                  service={new URL(service.href, "https://viapadua.local").searchParams.get("service") ?? undefined}
                  className="book-now"
                  aria-label={`Book ${service.title}`}
                >
                  Book Now
                </ServicesLink>
              </div>
            ))}
          </div>
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
      <ServicesBooking gcashPayee={{ number: process.env.PARISH_GCASH_NUMBER?.trim() || null, name: process.env.PARISH_GCASH_NAME?.trim() || "Church of San Antonio de Padua" }} />
    </div>
  );
}
