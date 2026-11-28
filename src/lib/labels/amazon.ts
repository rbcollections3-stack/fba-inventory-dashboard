import { splitIntoPallets, type PackConfig } from "@/lib/shipments/pallets";

/**
 * Amazon box and pallet labels for a shipment the owner created in Seller
 * Central ("Send to Amazon"). Mo chose on 2026-11-28 that the app only reads
 * from Amazon: it finds the shipment and its boxes, then downloads Amazon's own
 * 4x6 labels. It never creates or changes a shipment.
 *
 * Amazon calls used (all GET, Amazon Fulfillment role):
 *  - Fulfillment Inbound 2024-03-20 listInboundPlans, getInboundPlan,
 *    getShipment, listShipmentBoxes: which boxes are in the shipment, and the
 *    Amazon SKU in each box.
 *  - Fulfillment Inbound v0 getLabels: the label file (PDF).
 */

/** The read-only Amazon calls this needs. SpApiClient has them; tests pass a fake. */
export interface InboundReader {
  inboundGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  downloadFile(url: string): Promise<{ bytes: ArrayBuffer; contentType: string }>;
}

const V2024 = "/inbound/fba/2024-03-20";

/** Amazon shipment IDs look like FBA15K2LMN3P. */
const FBA_ID = /^FBA[0-9A-Z]{5,17}$/;
/** Box IDs are the shipment ID, U, and the box number: FBA15K2LMN3PU000001. */
const BOX_ID = /^FBA[0-9A-Z]{5,17}U\d{6}$/;
/** Amazon's 2024-03-20 plan and shipment ids. */
const PLAN_OR_SHIPMENT_ID = /^[A-Za-z0-9-]{1,64}$/;

export function isFbaShipmentId(v: string): boolean {
  return FBA_ID.test(v);
}

export function isBoxId(v: string): boolean {
  return BOX_ID.test(v);
}

/**
 * Reads the Amazon shipment ID box. Amazon can split one shipment into
 * several (one per warehouse), so more than one ID may be typed, separated by
 * commas or spaces.
 */
export function readShipmentIds(text: string): { ids: string[]; bad: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  const ids = [...new Set(parts.filter((p) => FBA_ID.test(p)))];
  const bad = parts.filter((p) => !FBA_ID.test(p));
  return { ids, bad };
}

export type AmazonBox = { boxId: string; msku: string | null; units: number };

export type FoundShipment = {
  fbaId: string;
  inboundPlanId: string;
  shipmentId: string;
  /** Amazon warehouse code, such as ONT8. */
  destination: string | null;
  boxes: AmazonBox[];
};

export type LookupResult = { found: FoundShipment[]; missing: string[] };

type PlanList = { inboundPlans?: { inboundPlanId: string }[]; pagination?: { nextToken?: string } };
type Plan = { shipments?: { shipmentId: string }[] };
type Shipment = {
  shipmentConfirmationId?: string;
  destination?: { warehouseId?: string };
};
type BoxList = {
  boxes?: { boxId?: string; items?: { msku?: string; quantity?: number }[] }[];
  pagination?: { nextToken?: string };
};

/** How many of the newest open plans to look through for the shipment IDs. */
const MAX_PLAN_PAGES = 3;

/**
 * Finds each Amazon shipment ID among the open inbound plans (newest first)
 * and lists its boxes. `known` holds where an ID was found before, so the
 * search is skipped next time.
 */
export async function findShipments(
  client: InboundReader,
  fbaIds: string[],
  known: Record<string, { inboundPlanId: string; shipmentId: string }> = {},
): Promise<LookupResult> {
  const where = new Map<string, { inboundPlanId: string; shipmentId: string; destination: string | null }>();
  const wanted = new Set(fbaIds.filter(isFbaShipmentId));

  // Re-check remembered locations first; a cancelled plan simply falls back to the search.
  for (const id of wanted) {
    const k = known[id];
    if (!k || !PLAN_OR_SHIPMENT_ID.test(k.inboundPlanId) || !PLAN_OR_SHIPMENT_ID.test(k.shipmentId)) continue;
    try {
      const s = await client.inboundGet<Shipment>(`${V2024}/inboundPlans/${k.inboundPlanId}/shipments/${k.shipmentId}`);
      if (s.shipmentConfirmationId?.toUpperCase() === id) {
        where.set(id, { ...k, destination: s.destination?.warehouseId ?? null });
      }
    } catch {
      // Search below.
    }
  }

  let token: string | undefined;
  for (let page = 0; page < MAX_PLAN_PAGES && [...wanted].some((id) => !where.has(id)); page++) {
    const list = await client.inboundGet<PlanList>(`${V2024}/inboundPlans`, {
      pageSize: 30,
      status: "ACTIVE",
      sortBy: "LAST_UPDATED_TIME",
      sortOrder: "DESC",
      paginationToken: token,
    });
    for (const p of list.inboundPlans ?? []) {
      if (!PLAN_OR_SHIPMENT_ID.test(p.inboundPlanId)) continue;
      const plan = await client.inboundGet<Plan>(`${V2024}/inboundPlans/${p.inboundPlanId}`);
      for (const sh of plan.shipments ?? []) {
        if (!PLAN_OR_SHIPMENT_ID.test(sh.shipmentId)) continue;
        const s = await client.inboundGet<Shipment>(`${V2024}/inboundPlans/${p.inboundPlanId}/shipments/${sh.shipmentId}`);
        const fba = s.shipmentConfirmationId?.toUpperCase();
        if (fba && wanted.has(fba) && !where.has(fba)) {
          where.set(fba, { inboundPlanId: p.inboundPlanId, shipmentId: sh.shipmentId, destination: s.destination?.warehouseId ?? null });
        }
      }
      if ([...wanted].every((id) => where.has(id))) break;
    }
    token = list.pagination?.nextToken;
    if (!token) break;
  }

  const found: FoundShipment[] = [];
  for (const id of fbaIds) {
    const w = where.get(id);
    if (!w) continue;
    const boxes: AmazonBox[] = [];
    let next: string | undefined;
    do {
      const page = await client.inboundGet<BoxList>(
        `${V2024}/inboundPlans/${w.inboundPlanId}/shipments/${w.shipmentId}/boxes`,
        { pageSize: 1000, paginationToken: next },
      );
      for (const b of page.boxes ?? []) {
        const boxId = b.boxId?.toUpperCase();
        if (!boxId || !isBoxId(boxId)) continue;
        const items = b.items ?? [];
        const mskus = [...new Set(items.map((i) => i.msku).filter((m): m is string => !!m))];
        boxes.push({
          boxId,
          // A box with more than one SKU never happens with one SKU per case; flag it as unknown.
          msku: mskus.length === 1 ? mskus[0] : null,
          units: items.reduce((a, i) => a + (i.quantity ?? 0), 0),
        });
      }
      next = page.pagination?.nextToken;
    } while (next);
    boxes.sort((a, b) => a.boxId.localeCompare(b.boxId));
    found.push({ fbaId: id, ...w, boxes });
  }
  return { found, missing: fbaIds.filter((id) => !where.has(id)) };
}

export type LabelLine = PackConfig & {
  id: number;
  amazonSku: string;
  inhouseSku: string;
  cases: number;
  unitsPerCase: number;
};

export type LabelPallet = {
  /** The pallet number on the pallet sheets, when the boxes match the sheet exactly. */
  sheetNumber: number | null;
  inhouseSku: string;
  amazonSku: string;
  boxIds: string[];
};

export type LabelGroup = {
  fbaId: string;
  destination: string | null;
  pallets: LabelPallet[];
  /** Boxes Amazon lists for SKUs that are not in this app shipment. */
  otherBoxes: AmazonBox[];
};

export type LabelPlan = {
  groups: LabelGroup[];
  /** Plain warnings for the admin and staff: anything that does not match the pallet sheets. */
  warnings: string[];
};

/**
 * Puts each pallet's box labels together, in the same order as the pallet
 * sheets. Every case of a SKU is the same, so any of that SKU's box labels can
 * go on any of its cases; what matters is that each case gets a label for its
 * own SKU and shipment.
 */
export function planLabels(lines: LabelLine[], found: FoundShipment[]): LabelPlan {
  const warnings: string[] = [];
  const groups: LabelGroup[] = found.map((f) => ({ fbaId: f.fbaId, destination: f.destination, pallets: [], otherBoxes: [] }));
  const lineBySku = new Map(lines.map((l) => [l.amazonSku.toLowerCase(), l]));

  for (const [gi, f] of found.entries()) {
    for (const b of f.boxes) {
      if (!b.msku || !lineBySku.has(b.msku.toLowerCase())) groups[gi].otherBoxes.push(b);
    }
  }

  let sheetNo = 0;
  for (const line of lines) {
    const split = splitIntoPallets(line.cases, line);
    const firstSheet = sheetNo + 1;
    sheetNo += split.length;
    const per = found.map((f) => f.boxes.filter((b) => b.msku?.toLowerCase() === line.amazonSku.toLowerCase()));
    const where = per.map((boxes, gi) => ({ gi, boxes })).filter((x) => x.boxes.length > 0);
    const amazonCases = where.reduce((a, x) => a + x.boxes.length, 0);

    if (amazonCases === 0) {
      warnings.push(`Amazon has no boxes of ${line.inhouseSku} (${line.amazonSku}) in these shipments. Do not send its pallets until the admin checks Seller Central.`);
      continue;
    }
    const matchesSheets = where.length === 1 && amazonCases === line.cases;
    if (!matchesSheets) {
      if (where.length > 1) {
        warnings.push(
          `Amazon is sending ${line.inhouseSku} to ${where.length} different warehouses, so its pallets are different from the pallet sheets. Build them as listed here.`,
        );
      }
      if (amazonCases !== line.cases) {
        warnings.push(
          `${line.inhouseSku}: Amazon expects ${amazonCases} ${amazonCases === 1 ? "case" : "cases"}, the pallet sheets say ${line.cases}. Ask the admin which is right before building.`,
        );
      }
    }
    for (const { gi, boxes } of where) {
      const sizes = splitIntoPallets(boxes.length, line);
      let at = 0;
      sizes.forEach((size, i) => {
        groups[gi].pallets.push({
          sheetNumber: matchesSheets ? firstSheet + i : null,
          inhouseSku: line.inhouseSku,
          amazonSku: line.amazonSku,
          boxIds: boxes.slice(at, at + size).map((b) => b.boxId),
        });
        at += size;
      });
    }
  }
  for (const g of groups) {
    if (g.otherBoxes.length > 0) {
      warnings.push(
        `Amazon shipment ${g.fbaId} also has ${g.otherBoxes.length} ${g.otherBoxes.length === 1 ? "box" : "boxes"} of products that are not on these pallet sheets. Ask the admin.`,
      );
    }
  }
  return { groups, warnings };
}

export type LabelKind = "box" | "pallet";

type LabelsResponse = { payload?: { DownloadURL?: string } };

/**
 * Downloads Amazon's labels as a PDF for a 4x6 thermal printer: one box
 * label per box ID given, or 4 identical pallet labels per pallet (Amazon
 * prints 4 per pallet, one for each side).
 */
export async function downloadLabels(
  client: InboundReader,
  fbaId: string,
  request: { kind: "box"; boxIds: string[] } | { kind: "pallet"; pallets: number },
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!isFbaShipmentId(fbaId)) throw new Error("Not an Amazon shipment ID.");
  const query: Record<string, string | number> = { PageType: "PackageLabel_Thermal" };
  if (request.kind === "box") {
    const ids = request.boxIds.filter((b) => isBoxId(b) && b.startsWith(fbaId));
    if (ids.length === 0 || ids.length > 999) throw new Error("No box labels to print.");
    query.LabelType = "UNIQUE";
    query.PackageLabelsToPrint = ids.join(",");
  } else {
    if (!Number.isInteger(request.pallets) || request.pallets < 1 || request.pallets > 100) {
      throw new Error("No pallet labels to print.");
    }
    query.LabelType = "PALLET";
    query.NumberOfPallets = request.pallets;
  }
  const res = await client.inboundGet<LabelsResponse>(`/fba/inbound/v0/shipments/${fbaId}/labels`, query);
  const url = res.payload?.DownloadURL;
  if (!url) throw new Error("Amazon did not return a label file.");
  return client.downloadFile(url);
}
