/**
 * R2 storage provider — production scaffold.
 *
 * The real implementation:
 *   1. Imports @aws-sdk/client-s3 (R2 is S3-compatible)
 *   2. Configures with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *      R2_BUCKET (all read from env)
 *   3. Uses PutObjectCommand for put(), GetObjectCommand for get(),
 *      DeleteObjectCommand for delete()
 *   4. Returns the same StoragePutResult shape — no caller changes needed
 *
 * Until those env vars + the SDK are provisioned, this stub throws a
 * helpful error so misconfiguration is loud rather than silent. The factory
 * in `index.ts` only instantiates this when STORAGE_PROVIDER=r2.
 */
import type {
  DocumentStorage,
  StorageObject,
  StoragePutResult,
} from "./types";

export class R2NotConfiguredStorage implements DocumentStorage {
  readonly providerName = "r2-not-configured";

  private fail(): never {
    throw new Error(
      "R2 storage provider is not configured. To enable:\n" +
        "  1. pnpm add @aws-sdk/client-s3\n" +
        "  2. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in your env\n" +
        "  3. Replace this class with a real S3-compatible client\n" +
        "Until then, leave STORAGE_PROVIDER unset (defaults to local-filesystem)."
    );
  }

  async put(): Promise<StoragePutResult> {
    return this.fail();
  }
  async get(): Promise<StorageObject> {
    return this.fail();
  }
  async delete(): Promise<boolean> {
    return this.fail();
  }
}
