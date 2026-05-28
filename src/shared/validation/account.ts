import { z } from "zod";

export const updateAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Account name is required")
    .max(120, "Account name is too long"),
  billingEmail: z.string().email("Enter a valid email"),
  timezone: z
    .string()
    .min(3, "Time zone is required")
    .max(60, "Time zone is too long"),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "UTC",
] as const;
