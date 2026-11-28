import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { fbaInventorySnapshots, shipmentLines, shipments, skus, users, warehouseCounts, type ShipmentStatus } from "@/db/schema";
import { listSkus } from "@/lib/skus/repo";
import type { CountEntry, CountIssue } from "@/lib/warehouse/counts";
import { splitIntoPallets } from "./pallets";

/** Largest number of cases one line can ask for, to catch typos. */
export const MAX_CASES_PER_LINE = 5000;

export type RequestLine = { skuId: number; cases: number };
export type LineIssue = { skuId: number; message: string };

/** Reads the plan form: include-<id> ticks a SKU, cases-<id> is how many cases. */
export function readShipmentForm(form: FormData, skuIds: number[]): { lines: RequestLine[]; issues: LineIssue[] } {
  const lines: RequestLine[] = [];
  const issues: LineIssue[] = [];
  for (const id of skuIds) {
    if (!form.get(`include-${id}`)) continue;
    const text = String(form.get(`cases-${id}`) ?? "").trim().replace(/,/g, "");
    if (!/^\d+$/.test(text) || Number(text) < 1) {
      issues.push({ skuId: id, message: "Enter a whole number of cases, 1 or more, or untick this SKU." });
    } else if (Number(text) > MAX_CASES_PER_LINE) {
      issues.push({ skuId: id, message: `That is more than ${MAX_CASES_PER_LINE.toLocaleString("en-US")} cases. Check the number.` });
    } else {
      lines.push({ skuId: id, cases: Number(text) });
    }
  }
  return { lines, issues };
}

export type CreateResult = { ok: true; id: number } | { ok: false; error: string };

/**
 * Saves a shipment request. The SKU's packing figures are copied onto each
 * line so printed sheets never change if the SKU is edited later.
 */
export async function createShipment(
  db: Db,
  lines: RequestLine[],
  opts: { userId: number | null; note?: string | null },
): Promise<CreateResult> {
  if (lines.length === 0) return { ok: false, error: "Tick at least one SKU and enter its cases." };
  const ids = [...new Set(lines.map((l) => l.skuId))];
  if (ids.length !== lines.length) return { ok: false, error: "A SKU is listed twice." };
  const found = await db
    .select({ id: skus.id, unitsPerCase: skus.unitsPerCase, tie: skus.tie, high: skus.high, max: skus.maxCasesPerPallet })
    .from(skus)
    .where(inArray(skus.id, ids));
  const pack = new Map(found.map((s) => [s.id, s]));
  if (found.length !== ids.length) return { ok: false, error: "One of the SKUs no longer exists. Reload the page." };
  for (const l of lines) {
    if (!Number.isInteger(l.cases) || l.cases < 1 || l.cases > MAX_CASES_PER_LINE) {
      return { ok: false, error: "Each SKU needs a whole number of cases, 1 or more." };
    }
  }
  const id = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(shipments)
      .values({ createdBy: opts.userId, note: opts.note?.trim() || null })
      .returning({ id: shipments.id });
    await tx.insert(shipmentLines).values(
      lines.map((l) => {
        const p = pack.get(l.skuId)!;
        return {
          shipmentId: s.id,
          skuId: l.skuId,
          cases: l.cases,
          unitsPerCase: p.unitsPerCase,
          tie: p.tie,
          high: p.high,
          maxCasesPerPallet: p.max,
        };
      }),
    );
    return s.id;
  });
  return { ok: true, id };
}

export type ShipmentLineView = {
  id: number;
  skuId: number;
  amazonSku: string;
  inhouseSku: string;
  fnsku: string | null;
  description: string | null;
  warehouseLocation: string | null;
  listingName: string;
  cases: number;
  unitsPerCase: number;
  tie: number;
  high: number;
  maxCasesPerPallet: number;
  units: number;
  pallets: number;
  /** Latest warehouse count in units, or null if never counted. */
  warehouseOnHand: number | null;
  countedOn: string | null;
};

export type ShipmentView = {
  id: number;
  status: ShipmentStatus;
  amazonShipmentId: string | null;
  amazonLookup: Record<string, { inboundPlanId: string; shipmentId: string }> | null;
  note: string | null;
  createdAt: Date;
  createdBy: string | null;
  sentAt: Date | null;
  sentBy: string | null;
  cancelledAt: Date | null;
  lines: ShipmentLineView[];
  totalCases: number;
  totalUnits: number;
  totalPallets: number;
};

const creator = alias(users, "creator");
const sender = alias(users, "sender");

async function loadShipments(db: Db, where: ReturnType<typeof eq> | undefined, limit: number): Promise<ShipmentView[]> {
  const heads = await db
    .select({
      id: shipments.id,
      status: shipments.status,
      amazonShipmentId: shipments.amazonShipmentId,
      amazonLookup: shipments.amazonLookup,
      note: shipments.note,
      createdAt: shipments.createdAt,
      createdBy: creator.username,
      sentAt: shipments.sentAt,
      sentBy: sender.username,
      cancelledAt: shipments.cancelledAt,
    })
    .from(shipments)
    .leftJoin(creator, eq(creator.id, shipments.createdBy))
    .leftJoin(sender, eq(sender.id, shipments.sentBy))
    .where(where)
    .orderBy(desc(shipments.createdAt), desc(shipments.id))
    .limit(limit);
  if (heads.length === 0) return [];

  const [lineRows, stock] = await Promise.all([
    db
      .select()
      .from(shipmentLines)
      .where(inArray(shipmentLines.shipmentId, heads.map((h) => h.id)))
      .orderBy(asc(shipmentLines.id)),
    listSkus(db),
  ]);
  const skuById = new Map(stock.map((s) => [s.id, s]));

  return heads.map((h) => {
    const lines: ShipmentLineView[] = lineRows
      .filter((l) => l.shipmentId === h.id)
      .map((l) => {
        const s = skuById.get(l.skuId)!;
        return {
          id: l.id,
          skuId: l.skuId,
          amazonSku: s.amazonSku,
          inhouseSku: s.inhouseSku,
          fnsku: s.fnsku,
          description: s.description,
          warehouseLocation: s.warehouseLocation,
          listingName: s.listingName,
          cases: l.cases,
          unitsPerCase: l.unitsPerCase,
          tie: l.tie,
          high: l.high,
          maxCasesPerPallet: l.maxCasesPerPallet,
          units: l.cases * l.unitsPerCase,
          pallets: splitIntoPallets(l.cases, l).length,
          warehouseOnHand: s.warehouseOnHand,
          countedOn: s.countedOn,
        };
      });
    return {
      ...h,
      status: h.status as ShipmentStatus,
      lines,
      totalCases: lines.reduce((a, l) => a + l.cases, 0),
      totalUnits: lines.reduce((a, l) => a + l.units, 0),
      totalPallets: lines.reduce((a, l) => a + l.pallets, 0),
    };
  });
}

export async function getShipment(db: Db, id: number): Promise<ShipmentView | null> {
  const [s] = await loadShipments(db, eq(shipments.id, id), 1);
  return s ?? null;
}

export async function listShipments(db: Db, status?: ShipmentStatus, limit = 30): Promise<ShipmentView[]> {
  return loadShipments(db, status ? eq(shipments.status, status) : undefined, limit);
}

/** SKUs already in a shipment that has been requested but not sent, with that shipment's number. */
export async function skusInOpenShipments(db: Db): Promise<Map<number, number>> {
  const rows = await db
    .select({ skuId: shipmentLines.skuId, shipmentId: shipmentLines.shipmentId })
    .from(shipmentLines)
    .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
    .where(eq(shipments.status, "requested"))
    .orderBy(asc(shipmentLines.shipmentId));
  const out = new Map<number, number>();
  for (const r of rows) if (!out.has(r.skuId)) out.set(r.skuId, r.shipmentId);
  return out;
}

/**
 * Units marked sent in this app that Amazon's latest stock report does not
 * show yet: shipments sent after the SKU's newest FBA stock figures were
 * taken. Once a newer Amazon report arrives, Amazon's own "inbound" number
 * includes them, so they stop being added here (no double counting).
 */
export async function sentNotYetReported(db: Db): Promise<Map<number, number>> {
  const latest = db
    .select({
      skuId: fbaInventorySnapshots.skuId,
      asOf: sql<Date>`max(${fbaInventorySnapshots.asOf})`.as("as_of"),
    })
    .from(fbaInventorySnapshots)
    .groupBy(fbaInventorySnapshots.skuId)
    .as("latest");
  const rows = await db
    .select({
      skuId: shipmentLines.skuId,
      units: sql<string>`sum(${shipmentLines.cases} * ${shipmentLines.unitsPerCase})`,
    })
    .from(shipmentLines)
    .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
    .leftJoin(latest, eq(latest.skuId, shipmentLines.skuId))
    .where(and(eq(shipments.status, "sent"), sql`(${latest.asOf} is null or ${shipments.sentAt} > ${latest.asOf})`))
    .groupBy(shipmentLines.skuId);
  return new Map(rows.map((r) => [r.skuId, Number(r.units)]));
}

/**
 * What the shelf should hold once the shipment leaves: the latest count minus
 * the units shipped. Null when the SKU has never been counted.
 */
export function expectedLeft(line: Pick<ShipmentLineView, "warehouseOnHand" | "units">): number | null {
  if (line.warehouseOnHand === null) return null;
  return Math.max(0, line.warehouseOnHand - line.units);
}

export type SendResult = { ok: true } | { ok: false; error: string; issues?: CountIssue[] };

/**
 * Marks a shipment as sent and saves the stock count taken after it left,
 * one per SKU in the shipment. This is how sending lowers the warehouse count.
 */
export async function markShipmentSent(
  db: Db,
  id: number,
  counts: CountEntry[],
  opts: { userId: number | null; today: string; now?: Date },
): Promise<SendResult> {
  const s = await getShipment(db, id);
  if (!s) return { ok: false, error: "This shipment no longer exists." };
  if (s.status !== "requested") {
    return { ok: false, error: s.status === "sent" ? "This shipment was already marked as sent." : "This shipment was cancelled." };
  }
  const byId = new Map(counts.map((c) => [c.skuId, c]));
  const issues: CountIssue[] = [];
  for (const l of s.lines) {
    if (!byId.has(l.skuId)) issues.push({ skuId: l.skuId, message: "Count what is left on the shelf for this SKU." });
  }
  if (issues.length > 0) return { ok: false, error: "Nothing was saved. Every SKU in the shipment needs a count.", issues };

  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    // Only one person can mark it sent, even if two press the button together.
    const done = await tx
      .update(shipments)
      .set({ status: "sent", sentAt: now, sentBy: opts.userId })
      .where(and(eq(shipments.id, id), eq(shipments.status, "requested")))
      .returning({ id: shipments.id });
    if (done.length === 0) return { ok: false as const, error: "This shipment was already marked as sent or cancelled." };
    await tx.insert(warehouseCounts).values(
      s.lines.map((l) => {
        const c = byId.get(l.skuId)!;
        return {
          skuId: l.skuId,
          units: c.cases * l.unitsPerCase + c.looseUnits,
          countedOn: opts.today,
          source: "shipment" as const,
          shipmentId: id,
          createdBy: opts.userId,
        };
      }),
    );
    return { ok: true as const };
  });
}

export async function cancelShipment(db: Db, id: number, userId: number | null): Promise<boolean> {
  const done = await db
    .update(shipments)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: userId })
    .where(and(eq(shipments.id, id), eq(shipments.status, "requested")))
    .returning({ id: shipments.id });
  return done.length > 0;
}

export async function setAmazonShipmentId(db: Db, id: number, value: string | null): Promise<void> {
  await db.update(shipments).set({ amazonShipmentId: value?.trim() || null }).where(eq(shipments.id, id));
}

/** Remembers where Amazon keeps each shipment ID, so label lookups are quick next time. */
export async function saveAmazonLookup(
  db: Db,
  id: number,
  lookup: Record<string, { inboundPlanId: string; shipmentId: string }>,
): Promise<void> {
  await db.update(shipments).set({ amazonLookup: lookup }).where(eq(shipments.id, id));
}
