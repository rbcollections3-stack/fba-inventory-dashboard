import { describe, expect, it } from "vitest";
import { isAllowedCall } from "@/lib/amazon/sp-api";
import {
  downloadLabels,
  findShipments,
  planLabels,
  readShipmentIds,
  type InboundReader,
  type LabelLine,
} from "@/lib/labels/amazon";

const box = (fba: string, n: number) => `${fba}U${String(n).padStart(6, "0")}`;

/** A pretend Amazon with one open plan holding two shipments. */
function fakeAmazon(boxesBySku: Record<string, Record<string, number>>) {
  const calls: { path: string; query: Record<string, unknown> }[] = [];
  const shipments: Record<string, string> = { "sh-1": "FBA15AAAAAAA", "sh-2": "FBA15BBBBBBB" };
  const reader: InboundReader = {
    async inboundGet<T>(path: string, query: Record<string, string | number | undefined> = {}) {
      calls.push({ path, query });
      if (path.endsWith("/inboundPlans")) return { inboundPlans: [{ inboundPlanId: "wf-old" }, { inboundPlanId: "wf-1" }] } as T;
      if (path.endsWith("/inboundPlans/wf-old")) return { shipments: [{ shipmentId: "sh-9" }] } as T;
      if (path.endsWith("/inboundPlans/wf-1")) return { shipments: [{ shipmentId: "sh-1" }, { shipmentId: "sh-2" }] } as T;
      const sh = /shipments\/(sh-\d)$/.exec(path);
      if (sh) return { shipmentConfirmationId: shipments[sh[1]] ?? "FBA15ZZZZZZZ", destination: { warehouseId: "ONT8" } } as T;
      const bx = /shipments\/(sh-\d)\/boxes$/.exec(path);
      if (bx) {
        const fba = shipments[bx[1]];
        const list: { boxId: string; items: { msku: string; quantity: number }[] }[] = [];
        let i = 0;
        for (const [sku, count] of Object.entries(boxesBySku[fba] ?? {})) {
          for (let k = 0; k < count; k++) list.push({ boxId: box(fba, ++i), items: [{ msku: sku, quantity: 6 }] });
        }
        return { boxes: list.reverse() } as T;
      }
      if (path.includes("/fba/inbound/v0/shipments/")) return { payload: { DownloadURL: "https://labels.s3.amazonaws.com/x.pdf" } } as T;
      throw new Error(`unexpected ${path}`);
    },
    async downloadFile(url: string) {
      calls.push({ path: url, query: {} });
      return { bytes: new TextEncoder().encode("%PDF-1.4").buffer as ArrayBuffer, contentType: "application/pdf" };
    },
  };
  return { reader, calls };
}

const pillow: LabelLine = { id: 1, amazonSku: "s - bamboo", inhouseSku: "7004", cases: 40, unitsPerCase: 6, tie: 7, high: 5, maxCasesPerPallet: 35 };
const queen: LabelLine = { id: 2, amazonSku: "q - bamboo", inhouseSku: "7002", cases: 10, unitsPerCase: 6, tie: 7, high: 5, maxCasesPerPallet: 35 };

describe("Amazon shipment IDs", () => {
  it("reads one or more IDs and flags anything else", () => {
    expect(readShipmentIds(" fba15aaaaaaa, FBA15BBBBBBB FBA15AAAAAAA")).toEqual({ ids: ["FBA15AAAAAAA", "FBA15BBBBBBB"], bad: [] });
    expect(readShipmentIds("12345").bad).toEqual(["12345"]);
    expect(readShipmentIds("")).toEqual({ ids: [], bad: [] });
  });
});

describe("only reading from Amazon", () => {
  it("allows the inbound look-ups and label download, GET only", () => {
    expect(isAllowedCall("GET", "/inbound/fba/2024-03-20/inboundPlans?pageSize=30")).toBe(true);
    expect(isAllowedCall("GET", "/inbound/fba/2024-03-20/inboundPlans/wf-1/shipments/sh-1/boxes")).toBe(true);
    expect(isAllowedCall("GET", "/fba/inbound/v0/shipments/FBA15AAAAAAA/labels?PageType=x")).toBe(true);
    expect(isAllowedCall("POST", "/inbound/fba/2024-03-20/inboundPlans")).toBe(false);
    expect(isAllowedCall("PUT", "/fba/inbound/v0/shipments/FBA15AAAAAAA")).toBe(false);
    expect(isAllowedCall("GET", "/orders/v0/orders")).toBe(false);
    expect(isAllowedCall("GET", "/inbound/fba/2024-03-20/inboundPlans/wf-1/shipments/sh-1/transportationOptions")).toBe(false);
  });
});

describe("finding the shipment's boxes", () => {
  it("finds each shipment ID among open plans and lists its boxes in order", async () => {
    const { reader } = fakeAmazon({ FBA15AAAAAAA: { "s - bamboo": 3 } });
    const r = await findShipments(reader, ["FBA15AAAAAAA"]);
    expect(r.missing).toEqual([]);
    expect(r.found[0]).toMatchObject({ fbaId: "FBA15AAAAAAA", inboundPlanId: "wf-1", shipmentId: "sh-1", destination: "ONT8" });
    expect(r.found[0].boxes.map((b) => b.boxId)).toEqual([box("FBA15AAAAAAA", 1), box("FBA15AAAAAAA", 2), box("FBA15AAAAAAA", 3)]);
  });

  it("goes straight to a remembered shipment without searching", async () => {
    const { reader, calls } = fakeAmazon({ FBA15AAAAAAA: { "s - bamboo": 1 } });
    await findShipments(reader, ["FBA15AAAAAAA"], { FBA15AAAAAAA: { inboundPlanId: "wf-1", shipmentId: "sh-1" } });
    expect(calls.some((c) => c.path.endsWith("/inboundPlans"))).toBe(false);
  });

  it("reports IDs Amazon does not have", async () => {
    const { reader } = fakeAmazon({});
    const r = await findShipments(reader, ["FBA15CCCCCCC"]);
    expect(r).toEqual({ found: [], missing: ["FBA15CCCCCCC"] });
  });
});

describe("sorting labels by pallet", () => {
  it("matches the pallet sheets when Amazon has every case in one shipment", async () => {
    const { reader } = fakeAmazon({ FBA15AAAAAAA: { "s - bamboo": 40, "q - bamboo": 10 } });
    const { found } = await findShipments(reader, ["FBA15AAAAAAA"]);
    const plan = planLabels([pillow, queen], found);
    expect(plan.warnings).toEqual([]);
    const pallets = plan.groups[0].pallets;
    expect(pallets.map((p) => [p.sheetNumber, p.inhouseSku, p.boxIds.length])).toEqual([
      [1, "7004", 35],
      [2, "7004", 5],
      [3, "7002", 10],
    ]);
    // Every box label lands on exactly one pallet.
    expect(new Set(pallets.flatMap((p) => p.boxIds)).size).toBe(50);
  });

  it("warns when Amazon splits a SKU or expects a different number of cases", async () => {
    const { reader } = fakeAmazon({ FBA15AAAAAAA: { "s - bamboo": 30 }, FBA15BBBBBBB: { "s - bamboo": 10, "q - bamboo": 8 } });
    const { found } = await findShipments(reader, ["FBA15AAAAAAA", "FBA15BBBBBBB"]);
    const plan = planLabels([pillow, queen], found);
    expect(plan.warnings.join(" ")).toMatch(/7004 to 2 different warehouses/);
    expect(plan.warnings.join(" ")).toMatch(/7002: Amazon expects 8 cases, the pallet sheets say 10/);
    expect(plan.groups[0].pallets.map((p) => p.boxIds.length)).toEqual([30]);
    expect(plan.groups[1].pallets.map((p) => [p.inhouseSku, p.boxIds.length, p.sheetNumber])).toEqual([
      ["7004", 10, null],
      ["7002", 8, null],
    ]);
  });

  it("warns about boxes of products that are not on the sheets", async () => {
    const { reader } = fakeAmazon({ FBA15AAAAAAA: { "s - bamboo": 40, "q - bamboo": 10, "other-sku": 2 } });
    const { found } = await findShipments(reader, ["FBA15AAAAAAA"]);
    expect(planLabels([pillow, queen], found).warnings).toEqual([
      "Amazon shipment FBA15AAAAAAA also has 2 boxes of products that are not on these pallet sheets. Ask the admin.",
    ]);
  });
});

describe("downloading labels", () => {
  it("asks Amazon for 4x6 box labels by box ID", async () => {
    const { reader, calls } = fakeAmazon({});
    const ids = [box("FBA15AAAAAAA", 1), box("FBA15AAAAAAA", 2), box("FBA15BBBBBBB", 1)];
    const file = await downloadLabels(reader, "FBA15AAAAAAA", { kind: "box", boxIds: ids });
    expect(file.contentType).toBe("application/pdf");
    expect(calls[0]).toEqual({
      path: "/fba/inbound/v0/shipments/FBA15AAAAAAA/labels",
      query: { PageType: "PackageLabel_Thermal", LabelType: "UNIQUE", PackageLabelsToPrint: `${ids[0]},${ids[1]}` },
    });
  });

  it("asks for pallet labels by number of pallets", async () => {
    const { reader, calls } = fakeAmazon({});
    await downloadLabels(reader, "FBA15AAAAAAA", { kind: "pallet", pallets: 3 });
    expect(calls[0].query).toEqual({ PageType: "PackageLabel_Thermal", LabelType: "PALLET", NumberOfPallets: 3 });
    await expect(downloadLabels(reader, "FBA15AAAAAAA", { kind: "pallet", pallets: 0 })).rejects.toThrow();
  });
});
