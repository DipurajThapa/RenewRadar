/**
 * Google Sheets CRM provider.
 *
 * Why hand-rolled (rather than `googleapis`):
 *   - The official `googleapis` package is ~6 MB and ships hundreds of API
 *     surfaces we don't use. The whole runtime here is one JWT signature
 *     and one fetch.
 *   - Zero new dependencies → faster install, faster cold start, smaller
 *     attack surface.
 *
 * What it does:
 *   1. Builds an OAuth 2.0 JWT signed with the service account private key.
 *   2. Exchanges the JWT for a short-lived access token (cached for ~50 min).
 *   3. POSTs an append request to the Sheets v4 REST API.
 *
 * Required env:
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL       e.g. "leads-writer@my-project.iam.gserviceaccount.com"
 *   - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY the full PEM, newlines kept as `\n`
 *   - GOOGLE_SHEETS_SPREADSHEET_ID       the long opaque id from the sheet URL
 *
 * Optional:
 *   - GOOGLE_SHEETS_RANGE                worksheet + range to append to.
 *                                        Defaults to `Leads!A:M`.
 *
 * Spreadsheet schema (one row per lead, in this column order):
 *
 *   A  Lead ID            (uuid)
 *   B  Created at         (ISO timestamp, UTC)
 *   C  Email
 *   D  Full name
 *   E  Company
 *   F  Job title
 *   G  Source             (e.g. "marketing_pricing_enterprise")
 *   H  Intent             (e.g. "enterprise")
 *   I  Message
 *   J  Consent marketing  (TRUE / FALSE)
 *   K  UTM source / medium / campaign / term / content (joined with "|")
 *   L  Page URL
 *   M  Referrer
 *
 * The first row of the sheet should hold these headers. The append uses
 * `valueInputOption=RAW` and `insertDataOption=INSERT_ROWS` so the new row
 * is added below existing data without disturbing other tabs.
 */
import crypto from "node:crypto";
import type { CrmProvider, LeadPushPayload } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_RANGE = "Leads!A:M";
/** Refresh ~10 min before Google's 60-min expiry. */
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

type CachedToken = { accessToken: string; expiresAt: number };

export class GoogleSheetsCrmProvider implements CrmProvider {
  readonly providerName = "google-sheets";

  private readonly clientEmail: string;
  private readonly privateKey: string;
  private readonly spreadsheetId: string;
  private readonly range: string;
  private cachedToken: CachedToken | null = null;

  constructor(opts: {
    clientEmail: string;
    privateKey: string;
    spreadsheetId: string;
    range?: string;
  }) {
    this.clientEmail = opts.clientEmail;
    // Env vars often arrive with literal "\n" sequences — normalize so the
    // PEM parser sees real newlines.
    this.privateKey = opts.privateKey.replace(/\\n/g, "\n");
    this.spreadsheetId = opts.spreadsheetId;
    this.range = opts.range ?? DEFAULT_RANGE;
  }

  async pushLead(payload: LeadPushPayload): Promise<{ ok: boolean }> {
    try {
      const token = await this.getAccessToken();
      const row = leadToRow(payload);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        this.spreadsheetId
      )}/values/${encodeURIComponent(
        this.range
      )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [row] }),
      });
      if (!resp.ok) {
        const body = await safeReadText(resp);
        console.error(
          `[crm] google-sheets append failed (${resp.status}): ${body}`
        );
        return { ok: false };
      }
      return { ok: true };
    } catch (err) {
      console.error("[crm] google-sheets push threw:", err);
      return { ok: false };
    }
  }

  /**
   * Get or refresh the access token. We cache it because every lead would
   * otherwise round-trip to Google's OAuth endpoint, doubling latency.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.cachedToken &&
      this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > now
    ) {
      return this.cachedToken.accessToken;
    }

    const jwt = this.signServiceAccountJwt(now);
    const params = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    });
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!resp.ok) {
      const body = await safeReadText(resp);
      throw new Error(
        `Google OAuth token exchange failed (${resp.status}): ${body}`
      );
    }
    const parsed = (await resp.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!parsed.access_token) {
      throw new Error("Google OAuth response missing access_token");
    }
    const expiresInMs = (parsed.expires_in ?? 3600) * 1000;
    this.cachedToken = {
      accessToken: parsed.access_token,
      expiresAt: now + expiresInMs,
    };
    return parsed.access_token;
  }

  /**
   * Build + sign the JWT used to exchange for an OAuth access token. The
   * shape is the standard Google service-account bearer assertion:
   *
   *   header  = { alg: "RS256", typ: "JWT" }
   *   claim   = { iss, scope, aud, exp, iat }
   *   signed  = base64url(header) + "." + base64url(claim) + "." + sig
   *
   * `iat` is now, `exp` is now + 1 hour. Google clamps to one hour even if
   * we ask for more.
   */
  private signServiceAccountJwt(nowMs: number): string {
    const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const iat = Math.floor(nowMs / 1000);
    const exp = iat + 3600;
    const claim = base64UrlEncode(
      JSON.stringify({
        iss: this.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat,
        exp,
      })
    );
    const signingInput = `${header}.${claim}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(this.privateKey);
    return `${signingInput}.${base64UrlEncodeBuffer(signature)}`;
  }
}

function leadToRow(p: LeadPushPayload): string[] {
  const m = p.metadata ?? {};
  // Pick out UTM fields and flatten into a compact pipe-separated string;
  // sheet users can split() in a formula if they want columns per UTM.
  const utm = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ]
    .map((k) => {
      const v = m[k];
      return typeof v === "string" ? `${k}=${v}` : "";
    })
    .filter(Boolean)
    .join("|");
  const pageUrl = typeof m.pageUrl === "string" ? m.pageUrl : "";
  const referrer = typeof m.referrer === "string" ? m.referrer : "";
  return [
    p.id,
    p.createdAt.toISOString(),
    p.email,
    p.fullName ?? "",
    p.company ?? "",
    p.jobTitle ?? "",
    p.source,
    p.intent,
    p.message ?? "",
    p.consentMarketing ? "TRUE" : "FALSE",
    utm,
    pageUrl,
    referrer,
  ];
}

function base64UrlEncode(s: string): string {
  return base64UrlEncodeBuffer(Buffer.from(s, "utf-8"));
}

function base64UrlEncodeBuffer(b: Buffer): string {
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function safeReadText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "<unreadable>";
  }
}
