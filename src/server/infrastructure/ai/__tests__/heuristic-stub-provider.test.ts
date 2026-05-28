import { describe, expect, it } from "vitest";
import { HeuristicStubProvider } from "@server/infrastructure/ai/heuristic-stub-provider";

const provider = new HeuristicStubProvider();

const SAMPLE_CONTRACT = `MASTER SERVICE AGREEMENT

This Master Service Agreement ("Agreement") is entered into on July 14, 2025
between Acme Inc. ("Customer") and Atlassian Pty Ltd ("Vendor").

1. Term. The initial term commences on the Effective Date and ends on
   2026-07-14 (the "Renewal Date"). The Agreement shall automatically renew
   for successive one-year terms unless either party provides written notice
   to the other party at least 90 days prior to the end of the then-current
   term.

2. Fees. Customer shall pay an annual fee of $12,000 per year.

3. Price increases. Vendor may increase fees by up to 7% annually upon
   written notice.

4. Cancellation. Customer may terminate this Agreement by delivering written
   notice via email to renewals@vendor.example.
`;

describe("HeuristicStubProvider", () => {
  it("extracts renewal_date from an ISO date", async () => {
    const result = await provider.extract({ text: SAMPLE_CONTRACT });
    const renewal = result.fields.find((f) => f.fieldKey === "renewal_date");
    expect(renewal).toBeDefined();
    expect((renewal!.parsedValueJson as { date: string }).date).toBe("2026-07-14");
    expect(renewal!.evidenceQuote).toContain("2026-07-14");
    expect(renewal!.confidencePct).toBeGreaterThanOrEqual(80);
  });

  it("extracts notice_period_days when the contract says '90 days prior'", async () => {
    const result = await provider.extract({ text: SAMPLE_CONTRACT });
    const notice = result.fields.find((f) => f.fieldKey === "notice_period_days");
    expect(notice).toBeDefined();
    expect((notice!.parsedValueJson as { days: number }).days).toBe(90);
    expect(notice!.evidenceQuote.toLowerCase()).toContain("90");
  });

  it("flags auto_renewal as true when the contract says 'shall automatically renew'", async () => {
    const result = await provider.extract({ text: SAMPLE_CONTRACT });
    const autoRenew = result.fields.find((f) => f.fieldKey === "auto_renewal");
    expect(autoRenew).toBeDefined();
    expect((autoRenew!.parsedValueJson as { yes: boolean }).yes).toBe(true);
  });

  it("flags auto_renewal as false on a no-renewal contract", async () => {
    const noRenew = `This Agreement does not automatically renew. The parties must
      mutually agree in writing to extend the term.`;
    const result = await provider.extract({ text: noRenew });
    const autoRenew = result.fields.find((f) => f.fieldKey === "auto_renewal");
    expect(autoRenew).toBeDefined();
    expect((autoRenew!.parsedValueJson as { yes: boolean }).yes).toBe(false);
    expect(autoRenew!.confidencePct).toBeGreaterThanOrEqual(85);
  });

  it("extracts contract_value_cents in cents", async () => {
    const result = await provider.extract({ text: SAMPLE_CONTRACT });
    const value = result.fields.find((f) => f.fieldKey === "contract_value_cents");
    expect(value).toBeDefined();
    expect((value!.parsedValueJson as { cents: number }).cents).toBe(1_200_000);
  });

  it("extracts a price_increase_clause when fees can rise", async () => {
    const result = await provider.extract({ text: SAMPLE_CONTRACT });
    const increase = result.fields.find(
      (f) => f.fieldKey === "price_increase_clause"
    );
    expect(increase).toBeDefined();
    expect(increase!.evidenceQuote.toLowerCase()).toContain("7%");
  });

  it("extracts cancellation_method=email when notice is via email", async () => {
    const result = await provider.extract({ text: SAMPLE_CONTRACT });
    const cancel = result.fields.find(
      (f) => f.fieldKey === "cancellation_method"
    );
    expect(cancel).toBeDefined();
    expect((cancel!.parsedValueJson as { method: string }).method).toBe("email");
  });

  it("every returned field carries a verbatim evidenceQuote (binding principle 4)", async () => {
    const result = await provider.extract({ text: SAMPLE_CONTRACT });
    for (const field of result.fields) {
      expect(field.evidenceQuote.length).toBeGreaterThan(0);
      // The quote must be a substring (or a quoted prefix) of the source — the
      // helper expands to sentence boundaries and may trim with ellipsis.
      const head = field.evidenceQuote.replace(/…$/, "").slice(0, 30);
      expect(SAMPLE_CONTRACT).toContain(head);
    }
  });

  it("attributes evidence to a page number when pageBreaks are provided", async () => {
    // Synthesize a two-page document: page 1 has the notice clause, page 2
    // has the renewal date.
    const p1 = "...90 days prior written notice...";
    const p2 = "Renewal date 2027-01-01. ";
    const text = p1 + p2;
    const result = await provider.extract({
      text,
      pageBreaks: [p1.length],
    });
    const renewal = result.fields.find((f) => f.fieldKey === "renewal_date");
    const notice = result.fields.find((f) => f.fieldKey === "notice_period_days");
    expect(notice?.evidencePageNumber).toBe(1);
    expect(renewal?.evidencePageNumber).toBe(2);
  });

  it("returns zero cost and >=1 page charged so usage caps work", async () => {
    const result = await provider.extract({ text: "" });
    expect(result.meta.costUsdMicros).toBe(0);
    expect(result.meta.pagesCharged).toBeGreaterThanOrEqual(1);
  });

  it("returns no fields when the document has no extractable signal", async () => {
    const result = await provider.extract({
      text: "This is a generic essay about cloud computing.",
    });
    expect(result.fields).toEqual([]);
  });
});
