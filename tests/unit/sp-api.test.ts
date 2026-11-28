import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeReport, missingSpApiSettings, SpApiClient, spApiConfigFromEnv, SpApiError, US_MARKETPLACE_ID } from "@/lib/amazon/sp-api";
import { ledgerRange, startOfBusinessDay, trimLedger } from "@/lib/amazon/sync";
import type { LedgerReport } from "@/lib/amazon/parse";

const env = { SP_API_CLIENT_ID: "id-1", SP_API_CLIENT_SECRET: "secret-1", SP_API_REFRESH_TOKEN: "Atzr|refresh-1" };

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: Record<string, (c: Call) => Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error("unexpected call " + url);
    return routes[key]({ url, init });
  }) as typeof fetch;
  return { fn, calls };
}

const tokenOk = () => Response.json({ access_token: "Atza|access", expires_in: 3600, token_type: "bearer" });

describe("Amazon settings", () => {
  it("names missing settings without showing values", () => {
    expect(missingSpApiSettings({})).toEqual(["SP_API_CLIENT_ID", "SP_API_CLIENT_SECRET", "SP_API_REFRESH_TOKEN"]);
    expect(missingSpApiSettings({ ...env, SP_API_REFRESH_TOKEN: "  " })).toEqual(["SP_API_REFRESH_TOKEN"]);
    expect(spApiConfigFromEnv({})).toBeNull();
  });

  it("defaults to the US marketplace and North America endpoint", () => {
    const c = spApiConfigFromEnv(env)!;
    expect(c.marketplaceId).toBe(US_MARKETPLACE_ID);
    expect(c.endpoint).toBe("https://sellingpartnerapi-na.amazon.com");
  });
});

describe("SpApiClient", () => {
  it("signs in with the refresh token once and requests a report", async () => {
    const f = fakeFetch({
      "api.amazon.com/auth/o2/token": tokenOk,
      "/reports/2021-06-30/reports": () => Response.json({ reportId: "R1" }, { status: 202 }),
    });
    const client = new SpApiClient(spApiConfigFromEnv(env)!, f.fn);
    const start = new Date("2026-10-01T07:00:00Z");
    const end = new Date("2026-11-01T06:59:59Z");
    expect(await client.createReport("GET_LEDGER_DETAIL_VIEW_DATA", { start, end })).toBe("R1");
    expect(await client.createReport("GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA")).toBe("R1");
    expect(f.calls.filter((c) => c.url.includes("/token"))).toHaveLength(1);
    const tokenBody = String(f.calls[0].init?.body);
    expect(tokenBody).toContain("grant_type=refresh_token");
    const create = f.calls[1];
    expect((create.init?.headers as Record<string, string>)["x-amz-access-token"]).toBe("Atza|access");
    expect(JSON.parse(String(create.init?.body))).toEqual({
      reportType: "GET_LEDGER_DETAIL_VIEW_DATA",
      marketplaceIds: [US_MARKETPLACE_ID],
      dataStartTime: start.toISOString(),
      dataEndTime: end.toISOString(),
    });
    expect(JSON.parse(String(f.calls[2].init?.body))).not.toHaveProperty("dataStartTime");
  });

  it("refuses any report type other than the two FBA reports", async () => {
    const f = fakeFetch({ "/token": tokenOk });
    const client = new SpApiClient(spApiConfigFromEnv(env)!, f.fn);
    await expect(client.createReport("GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL" as never)).rejects.toThrow(/Blocked/);
    expect(f.calls).toHaveLength(0);
  });

  it("downloads and unzips a report document", async () => {
    const text = "sku\tafn-fulfillable-quantity\nA\t5\n";
    const f = fakeFetch({
      "/token": tokenOk,
      "/documents/D1": () => Response.json({ reportDocumentId: "D1", url: "https://s3.example/doc", compressionAlgorithm: "GZIP" }),
      "s3.example": () => new Response(gzipSync(Buffer.from(text)), { headers: { "content-type": "text/plain; charset=UTF-8" } }),
    });
    const client = new SpApiClient(spApiConfigFromEnv(env)!, f.fn);
    expect(await client.downloadReport("D1")).toBe(text);
    // The storage link is fetched without the Amazon access token.
    expect(f.calls.at(-1)?.init?.headers).toBeUndefined();
  });

  it("explains bad keys and missing roles in plain words, without echoing keys", async () => {
    const bad = fakeFetch({ "/token": () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    const e1 = await new SpApiClient(spApiConfigFromEnv(env)!, bad.fn).getReport("R1").catch((e) => e);
    expect(e1).toBeInstanceOf(SpApiError);
    expect(e1.message).toMatch(/Refresh Token/);
    expect(e1.message).not.toContain("refresh-1");

    const denied = fakeFetch({
      "/token": tokenOk,
      "/reports/": () => Response.json({ errors: [{ code: "Unauthorized", message: "Access to requested resource is denied." }] }, { status: 403 }),
    });
    const e2 = await new SpApiClient(spApiConfigFromEnv(env)!, denied.fn).getReport("R1").catch((e) => e);
    expect(e2.status).toBe(403);
    expect(e2.message).toMatch(/Amazon Fulfillment role/);
  });
});

describe("decodeReport", () => {
  it("reads UTF-8 and Windows-1252 reports", () => {
    expect(decodeReport(Buffer.from("Café", "utf8"), "text/plain; charset=UTF-8")).toBe("Café");
    expect(decodeReport(Uint8Array.from([0x43, 0x61, 0x66, 0xe9]), "text/plain; charset=Cp1252")).toBe("Café");
    expect(decodeReport(Uint8Array.from([0x43, 0x61, 0x66, 0xe9]), null)).toBe("Café");
  });
});

describe("ledger dates", () => {
  it("finds midnight Pacific in summer and winter", () => {
    expect(startOfBusinessDay("2026-07-01", "America/Los_Angeles").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(startOfBusinessDay("2026-12-01", "America/Los_Angeles").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("asks for the last 31 whole days, ending yesterday", () => {
    const r = ledgerRange(new Date("2026-11-28T00:30:00Z")); // Nov 27, 4:30 PM Pacific
    expect(r.startDay).toBe("2026-10-27");
    expect(r.endDay).toBe("2026-11-26");
    expect(r.start.toISOString()).toBe("2026-10-27T07:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-27T07:59:59.000Z");
  });

  it("drops part days outside the range and ends on the last day with data", () => {
    const row = (day: string) => ({ msku: "A", day, eventType: "Shipments", disposition: "SELLABLE", quantity: -1 });
    const report: LedgerReport = {
      kind: "ledger_detail",
      rows: [row("2026-10-26"), row("2026-10-27"), row("2026-11-25"), row("2026-11-27")],
      rowsRead: 4,
      periodStart: "2026-10-26",
      periodEnd: "2026-11-27",
      badRows: [],
    };
    const t = trimLedger(report, "2026-10-27", "2026-11-26");
    expect(t.rows.map((r) => r.day)).toEqual(["2026-10-27", "2026-11-25"]);
    expect([t.periodStart, t.periodEnd]).toEqual(["2026-10-27", "2026-11-25"]);
    expect(trimLedger(report, "2026-01-01", "2026-01-31").periodStart).toBeNull();
  });
});
