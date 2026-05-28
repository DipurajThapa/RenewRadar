/**
 * Storage provider interface.
 *
 * Pluggable. The local-filesystem implementation backs development and
 * tests; the R2 implementation backs production. Both honor the same
 * tenant-scoped key contract:
 *
 *   account/{accountId}/document/{documentId}/{filename}
 *
 * The storageKey returned from `put()` is what we persist in the document
 * row. `get()` and `delete()` take that same key. Callers never construct
 * storage keys themselves — that's the provider's job.
 */
export type StoragePutResult = {
  storageKey: string;
  /** SHA-256 hex digest. Used to detect duplicate uploads. */
  checksumSha256: string;
  sizeBytes: number;
};

export type StorageObject = {
  bytes: Buffer;
  contentType: string;
  sizeBytes: number;
};

export interface DocumentStorage {
  /**
   * Store bytes for an account+document and return the storage key plus
   * metadata. Implementations compute the SHA-256 as part of writing so
   * we never have to read the file twice.
   */
  put(input: {
    accountId: string;
    documentId: string;
    filename: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<StoragePutResult>;

  /** Read previously-stored bytes by their storageKey. */
  get(storageKey: string): Promise<StorageObject>;

  /** Best-effort delete. Returns true if the object existed and was removed. */
  delete(storageKey: string): Promise<boolean>;

  /**
   * Identifier for the active provider. Surfaced in logs + the security page
   * so it's never a mystery where the bytes live.
   */
  readonly providerName: string;
}
