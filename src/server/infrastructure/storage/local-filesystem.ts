/**
 * Local filesystem document storage.
 *
 * Backs development and tests. Stores bytes under
 *   <root>/account/<accountId>/document/<documentId>/<filename>
 *
 * The root defaults to `<repo>/.storage` — gitignored — but can be overridden
 * via STORAGE_LOCAL_ROOT for cases where you want to point at a tmpfs.
 *
 * Production uses the R2 implementation. The interface is identical, so the
 * swap is a single env var flip in `storage/index.ts`.
 */
import {
  createHash,
} from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DocumentStorage,
  StorageObject,
  StoragePutResult,
} from "./types";

const DEFAULT_ROOT = path.join(process.cwd(), ".storage");

export class LocalFilesystemStorage implements DocumentStorage {
  readonly providerName = "local-filesystem";
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? process.env.STORAGE_LOCAL_ROOT ?? DEFAULT_ROOT;
  }

  private keyFor(input: {
    accountId: string;
    documentId: string;
    filename: string;
  }): string {
    // Sanitize filename — no slashes, no leading dots, no traversal segments.
    // The accountId and documentId are server-controlled UUIDs so they're
    // safe to interpolate.
    const safeFilename = input.filename
      .replace(/[/\\]/g, "_")
      .replace(/\.{2,}/g, "_") // collapse any "..", "...", etc. so traversal can't survive
      .replace(/^[._]+/, "") // strip any remaining leading dots / underscores
      .slice(0, 200);
    return path.posix.join(
      "account",
      input.accountId,
      "document",
      input.documentId,
      safeFilename
    );
  }

  private absolutePath(storageKey: string): string {
    // Defense-in-depth: refuse keys that try to escape the root.
    const normalized = path.posix.normalize(storageKey);
    if (normalized.startsWith("..") || normalized.includes("..")) {
      throw new Error("Refusing to resolve storage key with traversal");
    }
    return path.join(this.root, normalized);
  }

  async put(input: {
    accountId: string;
    documentId: string;
    filename: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<StoragePutResult> {
    const storageKey = this.keyFor(input);
    const abs = this.absolutePath(storageKey);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, input.bytes);
    const hash = createHash("sha256").update(input.bytes).digest("hex");
    return {
      storageKey,
      checksumSha256: hash,
      sizeBytes: input.bytes.byteLength,
    };
  }

  async get(storageKey: string): Promise<StorageObject> {
    const abs = this.absolutePath(storageKey);
    const bytes = await fs.readFile(abs);
    const stat = await fs.stat(abs);
    // We don't persist Content-Type on the filesystem; recover from the
    // filename extension. Production R2 will return the stored Content-Type
    // header directly.
    const ext = path.extname(storageKey).toLowerCase();
    const contentType = guessContentType(ext);
    return {
      bytes,
      contentType,
      sizeBytes: stat.size,
    };
  }

  async delete(storageKey: string): Promise<boolean> {
    const abs = this.absolutePath(storageKey);
    try {
      await fs.unlink(abs);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return false;
      throw err;
    }
  }
}

function guessContentType(ext: string): string {
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}
