/**
 * Storage factory.
 *
 *   STORAGE_PROVIDER=local-filesystem (default) → LocalFilesystemStorage
 *   STORAGE_PROVIDER=r2                          → R2NotConfiguredStorage (stub)
 *
 * Cached as a module-level singleton so every caller shares the same provider
 * instance.
 */
import type { DocumentStorage } from "./types";
import { LocalFilesystemStorage } from "./local-filesystem";
import { R2NotConfiguredStorage } from "./r2-not-configured";

let cached: DocumentStorage | null = null;

export function getDocumentStorage(): DocumentStorage {
  if (cached) return cached;
  const provider = process.env.STORAGE_PROVIDER ?? "local-filesystem";
  switch (provider) {
    case "r2":
      cached = new R2NotConfiguredStorage();
      break;
    case "local-filesystem":
    default:
      cached = new LocalFilesystemStorage();
      break;
  }
  return cached;
}

/** Test-only: reset the cached provider so each test can install its own. */
export function _resetDocumentStorageForTests(provider?: DocumentStorage): void {
  cached = provider ?? null;
}

export type { DocumentStorage, StorageObject, StoragePutResult } from "./types";
