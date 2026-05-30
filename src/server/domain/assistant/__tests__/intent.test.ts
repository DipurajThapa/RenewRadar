import { describe, expect, it } from "vitest";
import { classifyIntent } from "@server/domain/assistant/intent";

describe("classifyIntent", () => {
  it("routes common phrasings to the right intent", () => {
    expect(classifyIntent("what's my biggest risk?")).toBe("account_risk");
    expect(classifyIntent("what needs my attention today?")).toBe("needs_you");
    expect(classifyIntent("what renews next month?")).toBe("upcoming_renewals");
    expect(classifyIntent("how much do we spend on Acme?")).toBe("vendor_spend");
    expect(classifyIntent("what's typical for Acme?")).toBe("vendor_benchmark");
    expect(classifyIntent("show me our savings")).toBe("savings_summary");
    expect(classifyIntent("which compliance certs are expiring?")).toBe(
      "expiring_compliance"
    );
    expect(classifyIntent("give me an overview")).toBe("kpis");
  });

  it("prefers the more specific intent when keywords overlap", () => {
    // "benchmark" beats "spend".
    expect(classifyIntent("benchmark our spend on Acme")).toBe(
      "vendor_benchmark"
    );
    // compliance "expiring" beats renewal "expir".
    expect(classifyIntent("any compliance docs expiring?")).toBe(
      "expiring_compliance"
    );
  });

  it("falls back to unknown for unmappable questions", () => {
    expect(classifyIntent("what's the weather like?")).toBe("unknown");
    expect(classifyIntent("tell me a joke")).toBe("unknown");
  });
});
