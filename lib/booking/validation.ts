import { z } from "zod";
import { getBookableService, type BookableService, type ServiceField } from "./catalog";
import { checkBookingDate, isValidTime, isWithinServiceHours, EARLIEST_TIME, LATEST_TIME, parseIsoDate, todayInParish, formatTime12h } from "./schedule";

export type PaymentMethodInput = "gcash" | "church";

export type ValidBooking = {
  service: BookableService;
  requester: { name: string; email: string; phone: string };
  date: string;
  time: string;
  notes: string;
  paymentMethod: PaymentMethodInput;
  gcash: { accountName: string; number: string; reference: string } | null;
  details: Record<string, string>;
};

export type FieldErrors = Record<string, string>;

export type ValidationResult = { ok: true; data: ValidBooking } | { ok: false; formError?: string; fieldErrors: FieldErrors };

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Normalizes PH mobile numbers to 09XXXXXXXXX; accepts other international numbers as +digits. */
export function normalizePhone(value: string): string | null {
  const compact = value.replace(/[\s\-().]/g, "");
  if (/^09\d{9}$/.test(compact)) return compact;
  if (/^\+?639\d{9}$/.test(compact)) return `0${compact.replace(/^\+?63/, "")}`;
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  return null;
}

function cleanText(max: number, label: string) {
  return z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .max(max, `${label} must be at most ${max} characters.`)
        .refine((v) => !CONTROL_CHARS.test(v), `${label} contains invalid characters.`),
    );
}

const requiredText = (max: number, label: string) =>
  cleanText(max, label).pipe(z.string().min(1, `${label} is required.`));

const phoneSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: `Enter a valid mobile number (e.g. 0917 123 4567).` });
        return z.NEVER;
      }
      return phone;
    });

const baseSchema = z.object({
  serviceCode: z.string().trim().min(1, "Please choose a service."),
  bookFullName: requiredText(100, "Full name").pipe(z.string().min(2, "Full name is too short.")),
  bookEmail: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email address is required.")
    .max(255, "Email address is too long.")
    .pipe(z.email("Enter a valid email address.")),
  bookContact: phoneSchema("Contact number"),
  bookDate: z.string().trim().min(1, "Preferred date is required."),
  bookTime: z.string().trim().min(1, "Preferred time is required."),
  bookNotes: cleanText(1000, "Notes").optional().default(""),
  payment_method: z.enum(["gcash", "church"], { error: "Please choose a payment method." }),
});

const gcashSchema = z.object({
  gcashAccountName: requiredText(100, "GCash account name"),
  gcashNumber: phoneSchema("GCash number"),
  gcashRefNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(
      z
        .string()
        .min(1, "GCash reference number is required.")
        .regex(/^[A-Za-z0-9]{6,30}$/, "Enter the reference number exactly as shown on your GCash receipt."),
    ),
});

function fieldSchema(field: ServiceField, today: string): z.ZodType<string> {
  if (field.type === "select") {
    const options = field.options ?? [];
    const base = z.string().trim();
    return field.required
      ? base.refine((v) => options.includes(v), `${field.label} is required.`)
      : base.refine((v) => v === "" || options.includes(v), `Choose a valid ${field.label.toLowerCase()}.`);
  }
  if (field.type === "date") {
    return z
      .string()
      .trim()
      .superRefine((v, ctx) => {
        if (v === "") {
          if (field.required) ctx.addIssue({ code: "custom", message: `${field.label} is required.` });
          return;
        }
        if (!parseIsoDate(v) || v < "1900-01-01") ctx.addIssue({ code: "custom", message: `Enter a valid ${field.label.toLowerCase()}.` });
        else if (field.pastOnly && v > today) ctx.addIssue({ code: "custom", message: `${field.label} cannot be in the future.` });
      });
  }
  const max = field.maxLength ?? 100;
  return field.required ? requiredText(max, field.label) : cleanText(max, field.label);
}

function collectErrors(error: z.ZodError, into: FieldErrors) {
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!into[key]) into[key] = issue.message;
  }
}

/** Validates a raw booking submission. Fee and service name always come from the catalog, never the client. */
export function validateBookingInput(raw: Record<string, string>, now: Date = new Date()): ValidationResult {
  const fieldErrors: FieldErrors = {};
  const get = (k: string) => (typeof raw[k] === "string" ? raw[k] : "");

  const service = getBookableService(get("serviceCode"));
  if (!service) return { ok: false, formError: "Please choose a valid service.", fieldErrors };

  const base = baseSchema.safeParse({
    serviceCode: get("serviceCode"),
    bookFullName: get("bookFullName"),
    bookEmail: get("bookEmail"),
    bookContact: get("bookContact"),
    bookDate: get("bookDate"),
    bookTime: get("bookTime"),
    bookNotes: get("bookNotes"),
    payment_method: get("payment_method") || undefined,
  });
  if (!base.success) collectErrors(base.error, fieldErrors);

  const date = get("bookDate").trim();
  if (date && !fieldErrors.bookDate) {
    const dateError = checkBookingDate(date, now);
    if (dateError) fieldErrors.bookDate = dateError.message;
  }

  const time = get("bookTime").trim();
  if (time && !fieldErrors.bookTime) {
    if (!isValidTime(time)) fieldErrors.bookTime = "Enter a valid time.";
    else if (!isWithinServiceHours(time)) {
      fieldErrors.bookTime = `Please choose a time between ${formatTime12h(EARLIEST_TIME)} and ${formatTime12h(LATEST_TIME)}.`;
    }
  }

  const today = todayInParish(now);
  const details: Record<string, string> = {};
  for (const row of service.fields) {
    for (const field of row) {
      const parsed = fieldSchema(field, today).safeParse(get(field.name));
      if (!parsed.success) fieldErrors[field.name] ??= parsed.error.issues[0]?.message ?? "Invalid value.";
      else if (parsed.data !== "") details[field.name] = parsed.data;
    }
  }

  let gcash: ValidBooking["gcash"] = null;
  if (base.success && base.data.payment_method === "gcash") {
    const g = gcashSchema.safeParse({
      gcashAccountName: get("gcashAccountName"),
      gcashNumber: get("gcashNumber"),
      gcashRefNumber: get("gcashRefNumber"),
    });
    if (!g.success) collectErrors(g.error, fieldErrors);
    else gcash = { accountName: g.data.gcashAccountName, number: g.data.gcashNumber, reference: g.data.gcashRefNumber };
  }

  if (!base.success || Object.keys(fieldErrors).length > 0) {
    return { ok: false, formError: "Please correct the highlighted fields.", fieldErrors };
  }

  return {
    ok: true,
    data: {
      service,
      requester: { name: base.data.bookFullName, email: base.data.bookEmail, phone: base.data.bookContact },
      date: base.data.bookDate,
      time: base.data.bookTime,
      notes: base.data.bookNotes,
      paymentMethod: base.data.payment_method,
      gcash,
      details,
    },
  };
}

/** GCash field names (used by the client to route errors back to the GCash step). */
export const GCASH_FIELDS = ["gcashAccountName", "gcashNumber", "gcashRefNumber"] as const;
