import { gunzipSync } from "node:zlib";

/**
 * A small, read-only client for Amazon's Selling Partner API (SP-API).
 *
 * It can only request and download the two FBA reports the app reads (see
 * ALLOWED_REPORT_TYPES). It never changes anything in Seller Central and never
 * asks for reports with customer names or addresses.
 *
 * The three keys come from environment variables set in Vercel by the owner:
 * SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, SP_API_REFRESH_TOKEN. They are never
 * stored in the database, shown on a page or written to the logs.
 */

export const REPORT_TYPES = {
  fba_inventory: "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA",
  ledger_detail: "GET_LEDGER_DETAIL_VIEW_DATA",
} as const;

export type SyncKind = keyof typeof REPORT_TYPES;
export type ReportType = (typeof REPORT_TYPES)[SyncKind];

const ALLOWED_REPORT_TYPES = new Set<string>(Object.values(REPORT_TYPES));

/** Amazon.com (United States). */
export const US_MARKETPLACE_ID = "ATVPDKIKX0DER";

const ENDPOINTS = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
} as const;

const TOKEN_URL = "https://api.amazon.com/auth/o2/token";

export class SpApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type SpApiConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  marketplaceId: string;
  endpoint: string;
};

/** Which of the Amazon settings are missing, by name (never their values). */
export function missingSpApiSettings(env: Env = process.env): string[] {
  return ["SP_API_CLIENT_ID", "SP_API_CLIENT_SECRET", "SP_API_REFRESH_TOKEN"].filter((k) => !env[k]?.trim());
}

export function spApiConfigFromEnv(env: Env = process.env): SpApiConfig | null {
  if (missingSpApiSettings(env).length > 0) return null;
  const region = (env.SP_API_REGION?.trim().toLowerCase() || "na") as keyof typeof ENDPOINTS;
  return {
    clientId: env.SP_API_CLIENT_ID!.trim(),
    clientSecret: env.SP_API_CLIENT_SECRET!.trim(),
    refreshToken: env.SP_API_REFRESH_TOKEN!.trim(),
    marketplaceId: env.SP_API_MARKETPLACE_ID?.trim() || US_MARKETPLACE_ID,
    endpoint: ENDPOINTS[region] ?? ENDPOINTS.na,
  };
}

export type ReportStatus = {
  processingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL";
  reportDocumentId?: string;
  dataStartTime?: string;
  dataEndTime?: string;
  createdTime?: string;
  processingEndTime?: string;
};

/** What the sync needs from Amazon. Tests swap in a fake. */
export interface ReportsClient {
  createReport(reportType: ReportType, range?: { start: Date; end: Date }): Promise<string>;
  getReport(reportId: string): Promise<ReportStatus>;
  downloadReport(reportDocumentId: string): Promise<string>;
}

type FetchFn = typeof fetch;
type Env = Record<string, string | undefined>;

function explain(status: number, body: string): string {
  let detail = "";
  try {
    const j = JSON.parse(body) as { errors?: { code?: string; message?: string }[] };
    detail = j.errors?.map((e) => [e.code, e.message].filter(Boolean).join(": ")).join("; ") ?? "";
  } catch {
    // Not JSON; leave it out rather than echo an unknown body.
  }
  if (status === 403) {
    return (
      "Amazon refused access (403). Check that the app in Seller Central has the Amazon Fulfillment role " +
      "ticked and has been authorised, and that the keys in Vercel are the ones for this app." +
      (detail ? ` Amazon said: ${detail}` : "")
    );
  }
  if (status === 429) return "Amazon is limiting how often reports can be requested. The next check will try again.";
  return `Amazon returned an error (${status}).${detail ? ` ${detail}` : ""}`;
}

export class SpApiClient implements ReportsClient {
  private token: { value: string; expires: number } | null = null;

  constructor(
    private readonly config: SpApiConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      let code = "";
      try {
        code = (JSON.parse(text) as { error?: string }).error ?? "";
      } catch {}
      throw new SpApiError(
        code === "invalid_client"
          ? "Amazon did not accept the Client ID or Client Secret. Check SP_API_CLIENT_ID and SP_API_CLIENT_SECRET in Vercel."
          : code === "invalid_grant"
            ? "Amazon did not accept the Refresh Token (it may be mistyped or the app was de-authorised). Check SP_API_REFRESH_TOKEN in Vercel."
            : `Amazon sign-in failed (${res.status}${code ? `, ${code}` : ""}).`,
        res.status,
      );
    }
    const j = JSON.parse(text) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    // Only the Reports API is ever called.
    if (!path.startsWith("/reports/2021-06-30/")) throw new SpApiError("Blocked: the app only reads reports.");
    const res = await this.fetchFn(this.config.endpoint + path, {
      method,
      headers: {
        "x-amz-access-token": await this.accessToken(),
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "fba-inventory-dashboard/1.0 (Language=TypeScript)",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new SpApiError(explain(res.status, text), res.status);
    return JSON.parse(text) as T;
  }

  async createReport(reportType: ReportType, range?: { start: Date; end: Date }): Promise<string> {
    if (!ALLOWED_REPORT_TYPES.has(reportType)) throw new SpApiError(`Blocked report type ${reportType}.`);
    const j = await this.call<{ reportId: string }>("POST", "/reports/2021-06-30/reports", {
      reportType,
      marketplaceIds: [this.config.marketplaceId],
      ...(range ? { dataStartTime: range.start.toISOString(), dataEndTime: range.end.toISOString() } : {}),
    });
    return j.reportId;
  }

  async getReport(reportId: string): Promise<ReportStatus> {
    return this.call<ReportStatus>("GET", `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`);
  }

  async downloadReport(reportDocumentId: string): Promise<string> {
    const doc = await this.call<{ url: string; compressionAlgorithm?: string }>(
      "GET",
      `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
    );
    // The document link is a short-lived Amazon storage link; it needs no key.
    const res = await this.fetchFn(doc.url);
    if (!res.ok) throw new SpApiError(`Downloading the report from Amazon failed (${res.status}).`, res.status);
    let bytes: Buffer = Buffer.from(await res.arrayBuffer());
    if (doc.compressionAlgorithm === "GZIP") bytes = gunzipSync(bytes);
    return decodeReport(bytes, res.headers.get("content-type"));
  }
}

/**
 * Amazon's FBA reports come as UTF-8 or as Windows-1252 (Cp1252), and say
 * which in the download's content type. Bytes that are not valid UTF-8 are
 * read as Windows-1252 so product titles with accents never stop an import.
 */
export function decodeReport(bytes: Uint8Array, contentType: string | null): string {
  const charset = /charset=([^;]+)/i.exec(contentType ?? "")?.[1]?.trim().toLowerCase();
  const legacy = charset && /^(cp1252|windows-1252|iso-8859-1|latin1)$/.test(charset);
  if (!legacy) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // fall through
    }
  }
  return new TextDecoder("windows-1252").decode(bytes);
}
