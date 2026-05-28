/**
 * Pure URL-param parsers for the Notice Deadlines page.
 *
 * Lives outside the `"use client"` filters component so both the server
 * page and the client filter UI can import without crossing the
 * client/server boundary (Next.js can't expose plain functions exported
 * from "use client" files to server components).
 */

import type {
  NoticeDeadlineRange,
  NoticeDeadlineStatus,
} from "@server/infrastructure/db/repositories/notice-deadlines";

export function parseRange(value?: string): NoticeDeadlineRange {
  if (value === "30") return 30;
  if (value === "365") return 365;
  return 90;
}

export function parseStatus(value?: string): NoticeDeadlineStatus {
  if (
    value === "action_needed" ||
    value === "notice_window" ||
    value === "upcoming" ||
    value === "missed"
  ) {
    return value;
  }
  return "all";
}
