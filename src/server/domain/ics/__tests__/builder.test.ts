/**
 * RFC 5545 §3.1 — content lines must be folded at 75 octets. Several strict
 * .ics parsers warn about unfolded long lines; this test pins the behavior.
 */
import { describe, expect, it } from "vitest";
import { buildVCalendar, foldIcsLine } from "@server/domain/ics/builder";

describe("foldIcsLine", () => {
  it("leaves a short line unchanged", () => {
    expect(foldIcsLine("BEGIN:VEVENT")).toBe("BEGIN:VEVENT");
  });

  it("folds a long line at 75 octets and prefixes each continuation with a space", () => {
    const line = "DESCRIPTION:" + "x".repeat(200);
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    // Each piece, including the leading single space on continuations, must
    // be ≤ 75 octets.
    for (const p of parts) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    }
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]!.startsWith(" ")).toBe(true);
    }
    // Unfolded reconstruction recovers the original payload.
    const reconstructed = parts
      .map((p, i) => (i === 0 ? p : p.slice(1)))
      .join("");
    expect(reconstructed).toBe(line);
  });

  it("does not split inside a UTF-8 codepoint", () => {
    // A 2-byte char (é) placed so a naïve slice at 75 octets would land mid-codepoint.
    const line = "DESCRIPTION:" + "x".repeat(62) + "é" + "y".repeat(50);
    const folded = foldIcsLine(line);
    for (const p of folded.split("\r\n")) {
      // No replacement char and bytes never exceed 75.
      expect(p.includes("�")).toBe(false);
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildVCalendar", () => {
  it("emits every content line ≤ 75 octets (RFC 5545 §3.1)", () => {
    const cal = buildVCalendar("Renewal Radar — Test feed", [
      {
        uid: "x@renewal-radar",
        dtstamp: "2026-06-02",
        dtstart: "2026-06-30",
        summary: "Atlassian — Jira Software",
        description:
          "Last day to give notice before Atlassian auto-renews on 2026-06-30. Decide in Renewal Radar.",
        alarms: [
          {
            hoursBefore: 168,
            description: "1 week to notice deadline",
          },
        ],
      },
    ]);
    for (const line of cal.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
