/**
 * Pluggable DNS TXT resolver.
 *
 * Domain verification (T4.10 Slice 2) needs to read TXT records for a domain.
 * We hide this behind an interface so tests can inject a deterministic fake
 * instead of hitting the real resolver — same pattern as the storage / AI /
 * rate-limit providers.
 *
 * The default implementation uses Node's built-in `dns/promises`. DNS
 * resolution is free and built into the runtime — no external paid API, so
 * it's safe to ship before the "buy the APIs" milestone.
 */
import { promises as dnsPromises } from "node:dns";

export interface DnsResolver {
  /**
   * Resolve all TXT records for `host`. Each record is returned as a single
   * joined string (DNS chunks concatenated). Returns [] when the host has no
   * TXT records or doesn't resolve — never throws for the not-found case.
   */
  resolveTxt(host: string): Promise<string[]>;
}

/** Node-backed resolver. Used in production. */
export class NodeDnsResolver implements DnsResolver {
  async resolveTxt(host: string): Promise<string[]> {
    try {
      const records = await dnsPromises.resolveTxt(host);
      // resolveTxt returns string[][] — each record is an array of chunks.
      return records.map((chunks) => chunks.join(""));
    } catch (err) {
      // ENOTFOUND / ENODATA → host has no TXT records yet. That's the normal
      // "not verified yet" path, not an error we should surface.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (
        code === "ENOTFOUND" ||
        code === "ENODATA" ||
        code === "ESERVFAIL" ||
        code === "ETIMEOUT"
      ) {
        return [];
      }
      throw err;
    }
  }
}

let cached: DnsResolver | null = null;

export function getDnsResolver(): DnsResolver {
  if (cached) return cached;
  cached = new NodeDnsResolver();
  return cached;
}

/** Test-only: swap in a fake resolver. Pass nothing to reset to default. */
export function _setDnsResolverForTests(resolver?: DnsResolver): void {
  cached = resolver ?? null;
}

/**
 * In-memory resolver for tests. Map host → TXT records.
 */
export class FakeDnsResolver implements DnsResolver {
  private records = new Map<string, string[]>();

  set(host: string, txt: string[]): void {
    this.records.set(host, txt);
  }

  clear(): void {
    this.records.clear();
  }

  async resolveTxt(host: string): Promise<string[]> {
    return this.records.get(host) ?? [];
  }
}
