/**
 * Sample CSV download contract test.
 *
 * The sample CSV exists so a customer with no prior data can fill in their
 * subscriptions following a working example. It is the single source of
 * "what columns matter" — both the dialog hint and any marketing copy
 * reference it.
 *
 * What must hold:
 *   - The endpoint returns a downloadable CSV (right content type +
 *     content-disposition).
 *   - The CSV header matches the canonical SUBSCRIPTION_CSV_HEADERS exactly.
 *   - Each sample row round-trips through parseSubscriptionCsv with zero
 *     per-row errors — if the schema ever drifts, this test fails before a
 *     customer ever sees the bad sample.
 */
import { describe, expect, it } from "vitest";
import { GET } from "@app/api/subscriptions/sample-csv/route";
import {
  SUBSCRIPTION_CSV_HEADERS,
  parseSubscriptionCsv,
} from "@server/infrastructure/csv/subscriptions-format";

async function readBody(res: Response): Promise<string> {
  return await res.text();
}

describe("/api/subscriptions/sample-csv", () => {
  it("returns 200 with CSV content-type and an attachment disposition", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment.*renewal-radar-sample\.csv/i
    );
  });

  it("first line is the canonical header row in the canonical order", async () => {
    const res = GET();
    const body = await readBody(res);
    const firstLine = body.split(/\r\n|\n|\r/)[0]!;
    expect(firstLine).toBe(SUBSCRIPTION_CSV_HEADERS.join(","));
  });

  it("contains exactly 3 sample rows", async () => {
    const res = GET();
    const body = await readBody(res);
    const lines = body
      .split(/\r\n|\n|\r/)
      .filter((l) => l.trim().length > 0);
    // 1 header + 3 data rows
    expect(lines.length).toBe(4);
  });

  it("every sample row parses cleanly through parseSubscriptionCsv", async () => {
    const res = GET();
    const body = await readBody(res);
    const parsed = parseSubscriptionCsv(body);
    expect(parsed.headerOk).toBe(true);
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows.length).toBe(3);
    for (const row of parsed.rows) {
      expect(row.ok).toBe(true);
    }
  });

  it("vendor name with a comma round-trips through CSV quoting", async () => {
    // 'Slack, Inc.' is the canary — if RFC 4180 escaping ever regresses,
    // the parsed vendor would either lose the suffix or include a
    // phantom field.
    const res = GET();
    const body = await readBody(res);
    const parsed = parseSubscriptionCsv(body);
    const slack = parsed.rows.find(
      (r): r is { ok: true; row: { vendor: string } } & typeof r =>
        r.ok && r.row.vendor === "Slack, Inc."
    );
    expect(slack).toBeDefined();
  });
});
