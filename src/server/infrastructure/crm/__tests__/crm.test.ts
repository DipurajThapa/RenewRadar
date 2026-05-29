import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleStubCrmProvider } from "@server/infrastructure/crm/console-stub-provider";
import { HubspotNotConfiguredProvider } from "@server/infrastructure/crm/hubspot-not-configured";
import {
  _resetCrmProviderForTests,
  getCrmProvider,
  pushLeadToCrm,
} from "@server/infrastructure/crm";
import type { LeadPushPayload } from "@server/infrastructure/crm/types";

const samplePayload: LeadPushPayload = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "sample@example.com",
  fullName: "Sample User",
  company: "Acme",
  jobTitle: "IT Director",
  source: "marketing_home_final_cta",
  intent: "demo",
  message: null,
  status: "new",
  consentMarketing: true,
  metadata: { utm_source: "twitter", pageUrl: "https://example.com/?x=1" },
  createdAt: new Date("2026-05-28T12:00:00Z"),
};

describe("ConsoleStubCrmProvider", () => {
  // The provider routes through the structured logger, which writes
  // info-level entries through `console.info` as JSON envelopes.
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits one structured line and returns ok:true", async () => {
    const provider = new ConsoleStubCrmProvider();
    const result = await provider.pushLead(samplePayload);
    expect(result.ok).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]![0] as string;
    const json = JSON.parse(line);
    expect(json.level).toBe("info");
    expect(json.event).toBe("crm_push_lead");
    expect(json.component).toBe("crm.console-stub");
    expect(json.leadId).toBe(samplePayload.id);
    expect(json.email).toBe(samplePayload.email);
  });
});

describe("HubspotNotConfiguredProvider", () => {
  it("returns ok:false with a helpful error log", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = new HubspotNotConfiguredProvider();
    const result = await provider.pushLead(samplePayload);
    expect(result.ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("CRM factory", () => {
  const original = process.env.CRM_PROVIDER;
  afterEach(() => {
    _resetCrmProviderForTests();
    if (original === undefined) delete process.env.CRM_PROVIDER;
    else process.env.CRM_PROVIDER = original;
  });

  it("defaults to console-stub when CRM_PROVIDER is unset", () => {
    delete process.env.CRM_PROVIDER;
    _resetCrmProviderForTests();
    expect(getCrmProvider().providerName).toBe("console-stub");
  });

  it("returns the hubspot stub when CRM_PROVIDER=hubspot", () => {
    process.env.CRM_PROVIDER = "hubspot";
    _resetCrmProviderForTests();
    expect(getCrmProvider().providerName).toBe("hubspot-not-configured");
  });

  it("falls back to console-stub when google-sheets env is missing", () => {
    process.env.CRM_PROVIDER = "google-sheets";
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    _resetCrmProviderForTests();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = getCrmProvider();
    expect(provider.providerName).toBe("console-stub");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("caches the resolved provider", () => {
    delete process.env.CRM_PROVIDER;
    _resetCrmProviderForTests();
    expect(getCrmProvider()).toBe(getCrmProvider());
  });
});

describe("pushLeadToCrm helper", () => {
  afterEach(() => {
    _resetCrmProviderForTests();
  });

  it("swallows provider errors so lead capture is not affected", async () => {
    _resetCrmProviderForTests({
      providerName: "throwing",
      async pushLead() {
        throw new Error("boom");
      },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(pushLeadToCrm(samplePayload)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
