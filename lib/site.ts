
export const SITE = {
  name: "Via Padua",
  tagline: "Parish Management System",
  parish: "Church of San Antonio de Padua",
  location: "Ponso, Polangui, Albay",
} as const;

export type Service = {
  title: string;
  description: string;
  icon: string;
  color: "blue" | "pink" | "green" | "yellow";
  href: string;
};

export const SERVICES: Service[] = [
  {
    title: "Baptism",
    description: "Welcome new members into the Church through the sacrament of baptism.",
    icon: "fa-water",
    color: "blue",
    href: "/?services=1&service=baptism&step=form",
  },
  {
    title: "Wedding",
    description: "Celebrate the sacrament of matrimony in the presence of God.",
    icon: "fa-heart",
    color: "pink",
    href: "/?services=1&service=wedding&step=form",
  },
  {
    title: "Mass Intention",
    description: "Offer a Mass for your intentions or loved ones.",
    icon: "fa-praying-hands",
    color: "green",
    href: "/?services=1&service=mass-intention&step=form",
  },
  {
    title: "Certificates",
    description: "Baptismal, Marriage, and Confirmation certificates.",
    icon: "fa-scroll",
    color: "yellow",
    href: "/?services=1",
  },
];

export type Developer = { name: string; photo: string };

export const DEVELOPERS: Developer[] = [
  { name: "Chariz D. Abanel", photo: "/images/developers/chariz-abanel.jpg" },
  { name: "May C. Abaño", photo: "/images/developers/may-abano.jpg" },
  { name: "Queenice Sanico", photo: "/images/developers/queenice-sanico.jpg" },
];

export type ContactItem = { title: string; icon: string; lines: string[] };

export const CONTACTS: ContactItem[] = [
  { title: "Address", icon: "fa-map-marker-alt", lines: ["Ponso, Polangui", "Albay, Philippines"] },
  { title: "Phone", icon: "fa-phone-alt", lines: ["(555) 123-4567", "Office Hours: Monday to Friday, 9AM to 5PM"] },
  {
    title: "Email",
    icon: "fa-envelope",
    lines: ["info@sanantoniodepadua.org", "parish@sanantoniodepadua.org"],
  },
];
