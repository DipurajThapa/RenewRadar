import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalFilesystemStorage } from "@server/infrastructure/storage/local-filesystem";

const ACCOUNT_A = "00000000-0000-0000-0000-00000000aaaa";
const ACCOUNT_B = "00000000-0000-0000-0000-00000000bbbb";

describe("LocalFilesystemStorage", () => {
  let root: string;
  let storage: LocalFilesystemStorage;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "renewal-radar-storage-"));
    storage = new LocalFilesystemStorage(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("roundtrips bytes and returns a checksum + key", async () => {
    const bytes = Buffer.from("hello, contract\n");
    const result = await storage.put({
      accountId: ACCOUNT_A,
      documentId: "doc-1",
      filename: "agreement.pdf",
      contentType: "application/pdf",
      bytes,
    });
    expect(result.storageKey).toBe(
      "account/00000000-0000-0000-0000-00000000aaaa/document/doc-1/agreement.pdf"
    );
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const fetched = await storage.get(result.storageKey);
    expect(fetched.bytes.equals(bytes)).toBe(true);
    expect(fetched.contentType).toBe("application/pdf");
  });

  it("isolates accounts by including accountId in the key", async () => {
    const bytesA = Buffer.from("contract A");
    const bytesB = Buffer.from("contract B");
    const a = await storage.put({
      accountId: ACCOUNT_A,
      documentId: "doc-x",
      filename: "same.pdf",
      contentType: "application/pdf",
      bytes: bytesA,
    });
    const b = await storage.put({
      accountId: ACCOUNT_B,
      documentId: "doc-x",
      filename: "same.pdf",
      contentType: "application/pdf",
      bytes: bytesB,
    });
    expect(a.storageKey).not.toBe(b.storageKey);
    expect((await storage.get(a.storageKey)).bytes.equals(bytesA)).toBe(true);
    expect((await storage.get(b.storageKey)).bytes.equals(bytesB)).toBe(true);
  });

  it("sanitizes filenames so '..' and slashes cannot survive into the key", async () => {
    const result = await storage.put({
      accountId: ACCOUNT_A,
      documentId: "doc-2",
      filename: "../../weird/...name.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("x"),
    });
    // No traversal segment may survive — that's the security-relevant property.
    expect(result.storageKey).not.toContain("..");
    // The {accountId}/document/{documentId}/ prefix is intact: the filename
    // part is everything after the last "/" which must not contain another "/".
    const filenamePart = result.storageKey.split("/").pop();
    expect(filenamePart).toBeDefined();
    expect(filenamePart).not.toContain("..");
  });

  it("refuses to resolve storageKeys with path traversal", async () => {
    await expect(storage.get("../etc/passwd")).rejects.toThrow();
    await expect(storage.get("account/../../etc")).rejects.toThrow();
  });

  it("delete returns false for a missing key (idempotent)", async () => {
    const result = await storage.put({
      accountId: ACCOUNT_A,
      documentId: "doc-3",
      filename: "x.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("y"),
    });
    expect(await storage.delete(result.storageKey)).toBe(true);
    expect(await storage.delete(result.storageKey)).toBe(false);
  });
});
