import { z } from "zod";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date");

const billingCycle = z.enum([
  "monthly",
  "quarterly",
  "annual",
  "multi_year",
]);

export const createSubscriptionSchema = z
  .object({
    vendorName: z
      .string()
      .trim()
      .min(1, "Vendor is required")
      .max(120, "Vendor name is too long"),
    productName: z
      .string()
      .trim()
      .min(1, "Product is required")
      .max(120, "Product name is too long"),
    planName: z.string().trim().max(120).optional().nullable(),
    billingCycle,
    termStartDate: dateString,
    termEndDate: dateString,
    autoRenew: z.boolean().default(true),
    noticePeriodDays: z.coerce
      .number()
      .int()
      .min(0, "Must be 0 or more")
      .max(365, "365 days max")
      .default(30),
    totalSeats: z.coerce
      .number()
      .int()
      .min(1, "At least 1 seat")
      .max(100000, "That's a lot of seats"),
    unitPriceCents: z.coerce
      .number()
      .int()
      .min(0, "Price must be 0 or more"),
    notes: z.string().max(2000).optional().nullable(),
    // Empty string ("" from the Select when "Unassigned" is picked) maps to null.
    // The server-side action additionally verifies the UUID belongs to the
    // current account before honoring it.
    ownerUserId: z
      .preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().uuid().nullable()
      )
      .optional(),
  })
  .refine(
    (data) => new Date(data.termEndDate) > new Date(data.termStartDate),
    {
      message: "Term end must be after term start",
      path: ["termEndDate"],
    }
  );

export const updateSubscriptionSchema = createSubscriptionSchema
  .innerType()
  .partial()
  .refine(
    (data) => {
      if (!data.termStartDate || !data.termEndDate) return true;
      return new Date(data.termEndDate) > new Date(data.termStartDate);
    },
    {
      message: "Term end must be after term start",
      path: ["termEndDate"],
    }
  );

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

/**
 * Convert a dollar string from form input (e.g. "49.99") into integer cents.
 * Returns null for empty / invalid input so the Zod coerce can flag it.
 */
export function dollarsToCents(input: FormDataEntryValue | null): number | null {
  if (input === null) return null;
  const str = String(input).trim();
  if (str === "") return null;
  const dollars = Number(str);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}
