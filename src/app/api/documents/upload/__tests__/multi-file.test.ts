/**
 * Multi-file upload route tests — the P8.1 onboarding intake change.
 *
 * The route now accepts up to N files in one POST and returns a per-file
 * result list so the UI can show "8 uploaded, 2 skipped". We pin:
 *
 *   - Happy path: 3 valid files → all 3 succeed
 *   - Partial failure: 1 valid + 1 invalid MIME → ok:true overall, results
 *     array shows both with the right status
 *   - Backward compat: legacy `file` (singular) field still works
 *   - Empty post: 400 with a clear message
 *   - Over the per-request cap: 400 before any work happens
 *
 * Mocks `getCurrentAccountAndUser` and the Inngest client so we exercise
 * the route handler against the real test DB without network.
 */
import {
  describe,
  expect,
  it,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  documentsTable,
  type Account,
  type User,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";

// ─── Mocks installed before the route imports ──────────────────────────
let mockedAccount: Account | undefined;
let mockedUser: User | undefined;
vi.mock("@server/middleware/current-user", () => ({
  getCurrentAccountAndUser: async () => {
    if (!mockedAccount || !mockedUser) {
      throw new Error("test setup forgot to set mocked account/user");
    }
    return { account: mockedAccount, user: mockedUser };
  },
}));
const inngestSend = vi.fn().mockResolvedValue(undefined);
vi.mock("@server/jobs/client", () => ({
  inngest: { send: (...args: unknown[]) => inngestSend(...args) },
}));

import { POST } from "@app/api/documents/upload/route";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  inngestSend.mockClear();
  const [account] = await db
    .select()
    .from((await import("@server/infrastructure/db/schema")).accountsTable)
    .where(
      eq(
        (await import("@server/infrastructure/db/schema")).accountsTable.id,
        ids.accountA.id
      )
    );
  const [user] = await db
    .select()
    .from((await import("@server/infrastructure/db/schema")).usersTable)
    .where(
      eq(
        (await import("@server/infrastructure/db/schema")).usersTable.id,
        ids.accountA.userId
      )
    );
  mockedAccount = account;
  mockedUser = user;
});

// ─── Helpers ────────────────────────────────────────────────────────────
function pdfBlob(name: string): File {
  // The local extractor accepts any PDF-shaped buffer for the upload path;
  // extraction itself runs later via Inngest.
  const bytes = Buffer.from(`%PDF-1.4\nfake body for ${name}`, "utf-8");
  return new File([bytes], name, { type: "application/pdf" });
}

function exeBlob(name: string): File {
  return new File([Buffer.from("MZ\0\0", "utf-8")], name, {
    type: "application/x-msdownload",
  });
}

function postWithFiles(args: {
  files?: File[];
  legacyFile?: File;
  subscriptionId?: string;
}): Promise<Response> {
  const form = new FormData();
  for (const f of args.files ?? []) form.append("files", f);
  if (args.legacyFile) form.append("file", args.legacyFile);
  if (args.subscriptionId) form.append("subscriptionId", args.subscriptionId);
  const req = new Request("http://localhost/api/documents/upload", {
    method: "POST",
    body: form,
  });
  return POST(req);
}

// ─── Happy path ─────────────────────────────────────────────────────────

describe("multi-file upload route", () => {
  it("accepts 3 files in one POST and persists all 3", async () => {
    const res = await postWithFiles({
      files: [pdfBlob("a.pdf"), pdfBlob("b.pdf"), pdfBlob("c.pdf")],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      uploaded: number;
      skipped: number;
      results: Array<{ ok: boolean; filename: string }>;
    };
    expect(data.ok).toBe(true);
    expect(data.uploaded).toBe(3);
    expect(data.skipped).toBe(0);
    expect(data.results.map((r) => r.filename).sort()).toEqual([
      "a.pdf",
      "b.pdf",
      "c.pdf",
    ]);

    const rows = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.accountId, ids.accountA.id));
    expect(rows.length).toBe(3);

    // One Inngest event per successful upload.
    expect(inngestSend).toHaveBeenCalledTimes(3);
  });

  it("partial failure: 1 valid + 1 disallowed MIME returns mixed results", async () => {
    const res = await postWithFiles({
      files: [pdfBlob("contract.pdf"), exeBlob("malware.exe")],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      uploaded: number;
      skipped: number;
      results: Array<{ ok: boolean; filename: string; error?: string }>;
    };
    expect(data.ok).toBe(true);
    expect(data.uploaded).toBe(1);
    expect(data.skipped).toBe(1);
    const exe = data.results.find((r) => r.filename === "malware.exe");
    expect(exe?.ok).toBe(false);
    expect(exe?.error).toMatch(/mime|unsupported|invalid/i);
    const pdf = data.results.find((r) => r.filename === "contract.pdf");
    expect(pdf?.ok).toBe(true);

    // Only one Inngest event fires — the failed upload never queues.
    expect(inngestSend).toHaveBeenCalledTimes(1);
  });

  it("accepts the legacy `file` (single) field for backward compat", async () => {
    const res = await postWithFiles({ legacyFile: pdfBlob("legacy.pdf") });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; uploaded: number };
    expect(data.ok).toBe(true);
    expect(data.uploaded).toBe(1);
  });

  it("surfaces alreadyExisted=true on a duplicate upload + skips Inngest", async () => {
    // First upload — new contract, fires extraction.
    const first = await postWithFiles({ files: [pdfBlob("dup.pdf")] });
    const firstData = (await first.json()) as {
      results: Array<{ ok: boolean; alreadyExisted?: boolean }>;
    };
    expect(firstData.results[0]?.alreadyExisted).toBe(false);
    expect(inngestSend).toHaveBeenCalledTimes(1);

    // Second upload of identical bytes (same checksum) — UI gets the
    // signal, and Inngest does NOT re-fire (no duplicate budget charge).
    const second = await postWithFiles({ files: [pdfBlob("dup.pdf")] });
    const secondData = (await second.json()) as {
      results: Array<{
        ok: boolean;
        alreadyExisted?: boolean;
        originalUploadedAt?: string;
      }>;
    };
    expect(secondData.results[0]?.ok).toBe(true);
    expect(secondData.results[0]?.alreadyExisted).toBe(true);
    expect(secondData.results[0]?.originalUploadedAt).toBeTruthy();
    expect(inngestSend).toHaveBeenCalledTimes(1); // unchanged
  });
});

// ─── Guard rails ────────────────────────────────────────────────────────

describe("multi-file upload route — guard rails", () => {
  it("returns 400 when no files are attached", async () => {
    const res = await postWithFiles({ files: [] });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { ok: boolean; error?: string };
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/missing/i);
  });

  it("returns 400 when more than the per-request cap is attached", async () => {
    const files = Array.from({ length: 11 }, (_, i) => pdfBlob(`f${i}.pdf`));
    const res = await postWithFiles({ files });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { ok: boolean; error?: string };
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/too many/i);

    // No documents written and no Inngest event fired — the cap check happens
    // BEFORE any per-file work, so a denial is cheap.
    const rows = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.accountId, ids.accountA.id));
    expect(rows.length).toBe(0);
    expect(inngestSend).not.toHaveBeenCalled();
  });
});
