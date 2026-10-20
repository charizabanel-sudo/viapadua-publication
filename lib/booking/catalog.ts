/**
 * Parish service catalog — the single source of truth for public prices,
 * requirements and service-specific booking fields. Used by the /services UI
 * and by the server-side validator, so fees and required fields can never be
 * set by the client.
 */

export type FieldType = "text" | "date" | "select";

export type ServiceField = {
  /** Legacy form id; also the key stored in bookings.details (compatible with old details_json). */
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  options?: readonly string[];
  /** For dates: must not be after today (birth dates, date of death, etc.). */
  pastOnly?: boolean;
  maxLength?: number;
};

/** Each inner array is one visual row; two fields render side by side. */
export type FieldRows = readonly (readonly ServiceField[])[];

export type BookableService = {
  code: string;
  /** Stored in bookings.service (matches legacy service names). */
  name: string;
  fee: number;
  fields: FieldRows;
};

export type ServiceCard = {
  slug: string;
  title: string;
  subtitle: string;
  icon: string;
  about: string;
  requirements: readonly string[];
  fee: number;
  /** Bookable service codes. More than one shows the legacy chooser (Blessing). */
  serviceCodes: readonly string[];
  /** Certificate request (workflow not migrated yet — shown as awaiting migration). */
  certificate?: { name: string; fee: number };
};

const fatherName: ServiceField = {
  name: "fatherName",
  label: "Father's Full Name",
  type: "text",
  required: true,
  placeholder: "First Name, Middle Name, Last Name",
};
const motherName: ServiceField = {
  name: "motherName",
  label: "Mother's Full Name (Maiden)",
  type: "text",
  required: true,
  placeholder: "First Name, Middle Name, Maiden Last Name",
};

function blessingFields(typeLabel: "House" | "Business"): FieldRows {
  return [
    [
      {
        name: "blessingAddress",
        label: `${typeLabel} Complete Address`,
        type: "text",
        required: true,
        placeholder: `${typeLabel} complete address`,
        maxLength: 255,
      },
    ],
    [{ name: "blessingContact", label: "Contact Person", type: "text", required: true, placeholder: "Name of contact person" }],
    [
      {
        name: "blessingNotes",
        label: "Additional Blessing Details",
        type: "text",
        required: false,
        placeholder: "e.g., Number of rooms, special requests",
        maxLength: 255,
      },
    ],
  ];
}

export const BOOKABLE_SERVICES: readonly BookableService[] = [
  {
    code: "baptism",
    name: "Baptism",
    fee: 500,
    fields: [
      [
        { name: "childName", label: "Child's Full Name", type: "text", required: true, placeholder: "Full name of the child" },
        { name: "childDob", label: "Child's Date of Birth", type: "date", required: true, pastOnly: true },
      ],
      [
        {
          name: "birthPlace",
          label: "Child's Place of Birth",
          type: "text",
          required: true,
          placeholder: "City / Municipality, Province",
        },
      ],
      [fatherName],
      [motherName],
      [
        {
          name: "godparents",
          label: "Godparents (Ninong & Ninang)",
          type: "text",
          required: false,
          placeholder: "Names of godparents (comma separated)",
          maxLength: 255,
        },
      ],
    ],
  },
  {
    code: "wedding",
    name: "Wedding",
    fee: 3000,
    fields: [
      [{ name: "groomName", label: "Groom's Full Name", type: "text", required: true, placeholder: "Groom's full name" }],
      [{ name: "brideName", label: "Bride's Full Name", type: "text", required: true, placeholder: "Bride's full name" }],
      [
        {
          name: "witnesses",
          label: "Witnesses (Ninong / Ninang / Sponsors)",
          type: "text",
          required: true,
          placeholder: "Names of witnesses (comma separated)",
          maxLength: 255,
        },
      ],
      [
        {
          name: "weddingNotes",
          label: "Wedding Details / Notes",
          type: "text",
          required: false,
          placeholder: "e.g., Number of guests, reception location",
          maxLength: 255,
        },
      ],
    ],
  },
  {
    code: "confirmation",
    name: "Confirmation",
    fee: 600,
    fields: [
      [
        { name: "candidateName", label: "Confirmation Candidate Name", type: "text", required: true, placeholder: "Full name" },
        { name: "candidateDob", label: "Date of Birth", type: "date", required: true, pastOnly: true },
      ],
      [{ name: "sponsorName", label: "Sponsor (Ninong / Ninang) Name", type: "text", required: true, placeholder: "Sponsor's full name" }],
      [fatherName, motherName],
      [
        { name: "baptizedAt", label: "Baptized At (Church)", type: "text", required: true, placeholder: "Church / parish of baptism" },
        { name: "baptizedDate", label: "Date of Baptism", type: "date", required: true, pastOnly: true },
      ],
    ],
  },
  { code: "house-blessing", name: "House Blessing", fee: 800, fields: blessingFields("House") },
  { code: "business-blessing", name: "Business Blessing", fee: 800, fields: blessingFields("Business") },
  {
    code: "funeral",
    name: "Funeral",
    fee: 1200,
    fields: [
      [
        { name: "deceasedName", label: "Name of Deceased", type: "text", required: true, placeholder: "Full name" },
        { name: "dateOfDeath", label: "Date of Death", type: "date", required: true, pastOnly: true },
      ],
      [
        {
          name: "funeralHome",
          label: "Funeral Home / Address",
          type: "text",
          required: false,
          placeholder: "Name of funeral home or wake location",
          maxLength: 255,
        },
      ],
    ],
  },
  {
    code: "mass-intention",
    name: "Mass Intention",
    fee: 300,
    fields: [
      [
        { name: "intentionPerson", label: "Name of Person", type: "text", required: true, placeholder: "Full name" },
        {
          name: "massType",
          label: "Type of Mass",
          type: "select",
          required: true,
          options: ["Thanksgiving", "Memorial", "Healing", "Birthday", "Other"],
        },
      ],
    ],
  },
];

export const SERVICE_CARDS: readonly ServiceCard[] = [
  {
    slug: "baptism",
    title: "Baptism",
    subtitle: "First sacrament of Christian initiation",
    icon: "fa-water",
    about:
      "Baptism is the first of the seven sacraments and the gateway to life in the Spirit. Through baptism, we are freed from sin and reborn as children of God.",
    requirements: [
      "Birth certificate (PSA)",
      "Parent's marriage certificate",
      "Godparents' information",
      "Baptismal seminar attendance",
    ],
    fee: 500,
    serviceCodes: ["baptism"],
    certificate: { name: "Baptismal Certificate", fee: 150 },
  },
  {
    slug: "wedding",
    title: "Wedding",
    subtitle: "Celebrate your holy matrimony",
    icon: "fa-ring",
    about:
      "Holy Matrimony is a sacred covenant between a man and woman before God. Our parish provides comprehensive support for couples preparing for marriage.",
    requirements: [
      "Birth certificates (PSA)",
      "Baptismal & confirmation certificates",
      "Marriage license (from civil registry)",
      "Pre-marriage seminar attendance",
      "Two valid IDs (each)",
    ],
    fee: 3000,
    serviceCodes: ["wedding"],
    certificate: { name: "Marriage Certificate", fee: 200 },
  },
  {
    slug: "confirmation",
    title: "Confirmation",
    subtitle: "Strengthen your faith in the Holy Spirit",
    icon: "fa-dove",
    about:
      "Confirmation completes the grace of Baptism and strengthens you with the gifts of the Holy Spirit, making you a more committed witness of Christ.",
    requirements: [
      "Baptismal certificate (PSA)",
      "Confirmation sponsor information",
      "Confirmation seminar attendance",
      "Valid ID",
    ],
    fee: 600,
    serviceCodes: ["confirmation"],
    certificate: { name: "Confirmation Certificate", fee: 150 },
  },
  {
    slug: "blessing",
    title: "Blessing",
    subtitle: "House or Business blessing",
    icon: "fa-hand-holding-heart",
    about:
      "Request a blessing for your new home or business. Choose the type of blessing below and our parish priest will schedule a visit.",
    requirements: ["Complete address of house/business", "Preferred date & time", "Contact person & number"],
    fee: 800,
    serviceCodes: ["house-blessing", "business-blessing"],
  },
  {
    slug: "funeral",
    title: "Funeral",
    subtitle: "Funeral mass service",
    icon: "fa-cross",
    about:
      "Request funeral service and mass for your loved one. Our parish offers compassionate support during this difficult time.",
    requirements: ["Death certificate", "Baptismal certificate", "Funeral service preference"],
    fee: 1200,
    serviceCodes: ["funeral"],
  },
  {
    slug: "mass-intention",
    title: "Mass Intention",
    subtitle: "Request mass intentions",
    icon: "fa-pray",
    about: "Schedule thanksgiving or memorial mass. Offer a mass intention for a loved one or for a special occasion.",
    requirements: ["Intention details", "Preferred date & time", "Mass offering"],
    fee: 300,
    serviceCodes: ["mass-intention"],
  },
];

/** Blessing chooser options (legacy blessing modal). */
export const BLESSING_OPTIONS = [
  { code: "house-blessing", title: "House Blessing", description: "Blessing for a new home", icon: "fa-home" },
  { code: "business-blessing", title: "Business Blessing", description: "Blessing for a new business", icon: "fa-store" },
] as const;

const BY_CODE = new Map(BOOKABLE_SERVICES.map((s) => [s.code, s]));
const BY_NAME = new Map(BOOKABLE_SERVICES.map((s) => [s.name.toLowerCase(), s]));

export function getBookableService(code: string): BookableService | undefined {
  return BY_CODE.get(code);
}

export function findServiceByName(name: string): BookableService | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/** Human label for a details key (used by the admin details view). */
export function detailLabel(key: string): string {
  for (const service of BOOKABLE_SERVICES) {
    for (const row of service.fields) {
      for (const field of row) if (field.name === key) return field.label;
    }
  }
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function formatPeso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}
