import { z } from "zod";
import { SERVICE_CARDS } from "@/lib/booking/catalog";
import { parseIsoDate, todayInParish } from "@/lib/booking/schedule";
export const certificateTypes = SERVICE_CARDS.filter((c) => c.certificate).map(
  (c) => ({ type: c.slug, name: c.certificate!.name, fee: c.certificate!.fee }),
);
export const requestSchema = z
  .object({
    clientRequestId: z.uuid(),
    type: z
      .string()
      .refine(
        (v) => certificateTypes.some((t) => t.type === v),
        "Choose a certificate type.",
      ),
    requesterName: z.string().trim().min(2).max(100),
    email: z
      .email()
      .max(255)
      .transform((v) => v.toLowerCase()),
    phone: z.string().trim().min(7).max(30),
    recipientName: z.string().trim().min(2).max(100),
    spouseName: z.string().trim().max(100).default(""),
    fatherName: z.string().trim().max(100).default(""),
    motherName: z.string().trim().max(100).default(""),
    sacramentDate: z
      .string()
      .refine(
        (v) => Boolean(parseIsoDate(v)) && v <= todayInParish(),
        "Enter the past sacrament date.",
      ),
    parish: z.string().trim().min(2).max(200),
    purpose: z.string().trim().min(3).max(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === "wedding" && !v.spouseName)
      ctx.addIssue({
        code: "custom",
        path: ["spouseName"],
        message: "Enter the other spouse's name.",
      });
    if (v.type === "baptism" && (!v.fatherName || !v.motherName))
      ctx.addIssue({
        code: "custom",
        path: ["fatherName"],
        message: "Enter both parents' names to locate the baptism record.",
      });
  });
