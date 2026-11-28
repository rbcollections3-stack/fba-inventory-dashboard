import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { chinaOrderLines, chinaOrders, chinaReceipts, skus, users, warehouseCounts, type ChinaOrderStatus } from "@/db/schema";
import { listSkus } from "@/lib/skus/repo";
import type { CountEntry, CountIssue } from "@/lib/warehouse/counts";
import {
  casesStillToCome,
  MAX_ORDER_CASES,
  unitsStillToCome,
  type ArrivedEntry,
  type LineIssue,
  type OrderDetails,
  type OrderLine,
} from "./rules";

export type CreateResult = { ok: true; id: number } | { ok: false; error: string };

/** Saves a China order. Units per case are copied so later SKU edits do not change it. */
export async function createChinaOrder(
  db: Db,
  lines: OrderLine[],
  details: OrderDetails,
  opts: { userId: number | null },
): Promise<CreateResult> {
  if (lines.length === 0) return { ok: false, error: "Tick at least one SKU and enter its cases." };
  const ids = [...new Set(lines.map((l) => l.skuId))];
  if (ids.length !== lines.length) return { ok: false, error: "A SKU is listed twice." };
  for (const l of lines) {
    if (!Number.isInteger(l.cases) || l.cases < 1 || l.cases > MAX_ORDER_CASES) {
      return { ok: false, error: "Each SKU needs a whole number of cases, 1 or more." };
    }
  }
  const found = await db.select({ id: skus.id, unitsPerCase: skus.unitsPerCase }).from(skus).where(inArray(skus.id, ids));
  if (found.length !== ids.length) return { ok: false, error: "One of the SKUs no longer exists. Reload the page." };
  const perCase = new Map(found.map((s) => [s.id, s.unitsPerCase]));
  const id = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(chinaOrders)
      .values({ ...details, createdBy: opts.userId })
      .returning({ id: chinaOrders.id });
    await tx
      .insert(chinaOrderLines)
      .values(lines.map((l) => ({ orderId: o.id, skuId: l.skuId, cases: l.cases, unitsPerCase: perCase.get(l.skuId)! })));
    return o.id;
  });
  return { ok: true, id };
}

export type ChinaOrderLineView = {
  id: number;
  skuId: number;
  amazonSku: string;
  inhouseSku: string;
  description: string | null;
  listingName: string;
  warehouseLocation: string | null;
  cases: number;
  unitsPerCase: number;
  units: number;
  casesReceived: number;
  casesToCome: number;
  /** Latest warehouse count in units, or null if never counted. */
  warehouseOnHand: number | null;
};

export type ReceiptView = { id: number; skuId: number; inhouseSku: string; cases: number; receivedOn: string; by: string | null; at: Date };

export type ChinaOrderView = {
  id: number;
  status: ChinaOrderStatus;
  supplier: string | null;
  poNumber: string | null;
  orderedOn: string;
  expectedOn: string;
  note: string | null;
  createdAt: Date;
  createdBy: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  lines: ChinaOrderLineView[];
  receipts: ReceiptView[];
  totalCases: number;
  totalUnits: number;
  casesReceived: number;
  casesToCome: number;
};

const creator = alias(users, "creator");
const closer = alias(users, "closer");

async function loadOrders(db: Db, where: ReturnType<typeof eq> | undefined, limit: number): Promise<ChinaOrderView[]> {
  const heads = await db
    .select({
      id: chinaOrders.id,
      status: chinaOrders.status,
      supplier: chinaOrders.supplier,
      poNumber: chinaOrders.poNumber,
      orderedOn: chinaOrders.orderedOn,
      expectedOn: chinaOrders.expectedOn,
      note: chinaOrders.note,
      createdAt: chinaOrders.createdAt,
      createdBy: creator.username,
      closedAt: chinaOrders.closedAt,
      closedBy: closer.username,
    })
    .from(chinaOrders)
    .leftJoin(creator, eq(creator.id, chinaOrders.createdBy))
    .leftJoin(closer, eq(closer.id, chinaOrders.closedBy))
    .where(where)
    .orderBy(desc(chinaOrders.orderedOn), desc(chinaOrders.id))
    .limit(limit);
  if (heads.length === 0) return [];
  const orderIds = heads.map((h) => h.id);

  const [lineRows, receiptRows, stock] = await Promise.all([
    db.select().from(chinaOrderLines).where(inArray(chinaOrderLines.orderId, orderIds)).orderBy(asc(chinaOrderLines.id)),
    db
      .select({
        id: chinaReceipts.id,
        orderId: chinaReceipts.orderId,
        skuId: chinaReceipts.skuId,
        cases: chinaReceipts.cases,
        receivedOn: chinaReceipts.receivedOn,
        by: users.username,
        at: chinaReceipts.createdAt,
      })
      .from(chinaReceipts)
      .leftJoin(users, eq(users.id, chinaReceipts.createdBy))
      .where(inArray(chinaReceipts.orderId, orderIds))
      .orderBy(asc(chinaReceipts.createdAt), asc(chinaReceipts.id)),
    listSkus(db),
  ]);
  const skuById = new Map(stock.map((s) => [s.id, s]));

  return heads.map((h) => {
    const mine = receiptRows.filter((r) => r.orderId === h.id);
    const lines: ChinaOrderLineView[] = lineRows
      .filter((l) => l.orderId === h.id)
      .map((l) => {
        const s = skuById.get(l.skuId)!;
        const casesReceived = mine.filter((r) => r.skuId === l.skuId).reduce((a, r) => a + r.cases, 0);
        return {
          id: l.id,
          skuId: l.skuId,
          amazonSku: s.amazonSku,
          inhouseSku: s.inhouseSku,
          description: s.description,
          listingName: s.listingName,
          warehouseLocation: s.warehouseLocation,
          cases: l.cases,
          unitsPerCase: l.unitsPerCase,
          units: l.cases * l.unitsPerCase,
          casesReceived,
          casesToCome: casesStillToCome({ cases: l.cases, casesReceived }),
          warehouseOnHand: s.warehouseOnHand,
        };
      });
    return {
      ...h,
      status: h.status as ChinaOrderStatus,
      lines,
      receipts: mine.map((r) => ({ ...r, inhouseSku: skuById.get(r.skuId)?.inhouseSku ?? "?" })),
      totalCases: lines.reduce((a, l) => a + l.cases, 0),
      totalUnits: lines.reduce((a, l) => a + l.units, 0),
      casesReceived: lines.reduce((a, l) => a + l.casesReceived, 0),
      casesToCome: lines.reduce((a, l) => a + l.casesToCome, 0),
    };
  });
}

export async function getChinaOrder(db: Db, id: number): Promise<ChinaOrderView | null> {
  const [o] = await loadOrders(db, eq(chinaOrders.id, id), 1);
  return o ?? null;
}

/** Open orders (still on the way, or partly received), soonest arrival first. */
export async function listOpenChinaOrders(db: Db): Promise<ChinaOrderView[]> {
  const rows = await loadOrders(db, eq(chinaOrders.status, "ordered"), 200);
  return rows.sort((a, b) => (a.expectedOn < b.expectedOn ? -1 : a.expectedOn > b.expectedOn ? 1 : a.id - b.id));
}

/** Received and cancelled orders, newest first. */
export async function listClosedChinaOrders(db: Db, limit = 20): Promise<ChinaOrderView[]> {
  return loadOrders(db, ne(chinaOrders.status, "ordered"), limit);
}

/**
 * Units on order from China and not yet received, per SKU. This is the
 * "on order" figure in the reorder-by date.
 */
export async function onOrderBySku(db: Db): Promise<Map<number, number>> {
  const received = db
    .select({
      orderId: chinaReceipts.orderId,
      skuId: chinaReceipts.skuId,
      cases: sql<number>`sum(${chinaReceipts.cases})`.as("cases_received"),
    })
    .from(chinaReceipts)
    .groupBy(chinaReceipts.orderId, chinaReceipts.skuId)
    .as("received");
  const rows = await db
    .select({
      skuId: chinaOrderLines.skuId,
      cases: chinaOrderLines.cases,
      unitsPerCase: chinaOrderLines.unitsPerCase,
      casesReceived: sql<string | null>`${received.cases}`,
    })
    .from(chinaOrderLines)
    .innerJoin(chinaOrders, eq(chinaOrders.id, chinaOrderLines.orderId))
    .leftJoin(received, and(eq(received.orderId, chinaOrderLines.orderId), eq(received.skuId, chinaOrderLines.skuId)))
    .where(eq(chinaOrders.status, "ordered"));
  const out = new Map<number, number>();
  for (const r of rows) {
    const units = unitsStillToCome({ cases: r.cases, unitsPerCase: r.unitsPerCase, casesReceived: Number(r.casesReceived ?? 0) });
    if (units > 0) out.set(r.skuId, (out.get(r.skuId) ?? 0) + units);
  }
  return out;
}

export type ReceiveResult = { ok: true; complete: boolean } | { ok: false; error: string; issues?: LineIssue[] | CountIssue[] };

/**
 * Records a delivery from China: the full cases that arrived for each SKU,
 * and the shelf count taken after putting them away (which becomes the
 * warehouse stock). When every case ordered has arrived, the order closes.
 */
export async function receiveChinaOrder(
  db: Db,
  id: number,
  arrived: ArrivedEntry[],
  counts: CountEntry[],
  opts: { userId: number | null; today: string },
): Promise<ReceiveResult> {
  const o = await getChinaOrder(db, id);
  if (!o) return { ok: false, error: "This order no longer exists." };
  if (o.status !== "ordered") {
    return { ok: false, error: o.status === "received" ? "This order was already fully received." : "This order was cancelled." };
  }
  const arrivedBy = new Map(arrived.map((a) => [a.skuId, a.cases]));
  const countBy = new Map(counts.map((c) => [c.skuId, c]));
  const issues: LineIssue[] = [];
  for (const l of o.lines) {
    if (!arrivedBy.has(l.skuId)) issues.push({ skuId: l.skuId, message: "Type how many full cases arrived. Type 0 if none came." });
    else if (!countBy.has(l.skuId)) issues.push({ skuId: l.skuId, message: "Count what is on the shelf now for this SKU." });
  }
  if (issues.length > 0) return { ok: false, error: "Nothing was saved. Every SKU in the order needs both numbers.", issues };
  if (o.lines.every((l) => arrivedBy.get(l.skuId) === 0)) {
    return { ok: false, error: "Nothing was saved. Every SKU says 0 cases arrived. Only use this screen when a delivery comes in." };
  }

  return db.transaction(async (tx) => {
    // Lock the order so two people saving at once cannot both record the same delivery.
    const [locked] = await tx
      .select({ status: chinaOrders.status })
      .from(chinaOrders)
      .where(eq(chinaOrders.id, id))
      .for("update");
    if (!locked || locked.status !== "ordered") {
      return { ok: false as const, error: "This order was already received or cancelled. Reload the page." };
    }
    await tx.insert(chinaReceipts).values(
      o.lines.map((l) => ({ orderId: id, skuId: l.skuId, cases: arrivedBy.get(l.skuId)!, receivedOn: opts.today, createdBy: opts.userId })),
    );
    await tx.insert(warehouseCounts).values(
      o.lines.map((l) => {
        const c = countBy.get(l.skuId)!;
        return {
          skuId: l.skuId,
          units: c.cases * l.unitsPerCase + c.looseUnits,
          countedOn: opts.today,
          source: "china_order" as const,
          chinaOrderId: id,
          createdBy: opts.userId,
        };
      }),
    );
    // Worked out after saving, inside the lock, so an earlier delivery saved a moment ago is included.
    const totals = await tx
      .select({ skuId: chinaReceipts.skuId, cases: sql<string>`sum(${chinaReceipts.cases})` })
      .from(chinaReceipts)
      .where(eq(chinaReceipts.orderId, id))
      .groupBy(chinaReceipts.skuId);
    const got = new Map(totals.map((t) => [t.skuId, Number(t.cases)]));
    const complete = o.lines.every((l) => (got.get(l.skuId) ?? 0) >= l.cases);
    if (complete) {
      await tx.update(chinaOrders).set({ status: "received", closedAt: new Date(), closedBy: opts.userId }).where(eq(chinaOrders.id, id));
    }
    return { ok: true as const, complete };
  });
}

/** Nothing more is coming on a partly received order: stop counting the rest as on order. */
export async function closeChinaOrder(db: Db, id: number, userId: number | null): Promise<boolean> {
  const done = await db
    .update(chinaOrders)
    .set({ status: "received", closedAt: new Date(), closedBy: userId })
    .where(and(eq(chinaOrders.id, id), eq(chinaOrders.status, "ordered")))
    .returning({ id: chinaOrders.id });
  return done.length > 0;
}

/** Cancels an order that nothing has arrived for yet. */
export async function cancelChinaOrder(db: Db, id: number, userId: number | null): Promise<{ ok: boolean; error?: string }> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(chinaReceipts).where(eq(chinaReceipts.orderId, id));
  if ((r?.n ?? 0) > 0) return { ok: false, error: "Part of this order has arrived, so it cannot be cancelled. Close it instead." };
  const done = await db
    .update(chinaOrders)
    .set({ status: "cancelled", closedAt: new Date(), closedBy: userId })
    .where(and(eq(chinaOrders.id, id), eq(chinaOrders.status, "ordered")))
    .returning({ id: chinaOrders.id });
  return done.length > 0 ? { ok: true } : { ok: false, error: "This order is already closed." };
}

/** Changes the supplier, PO number, dates or note of an order. */
export async function updateChinaOrderDetails(db: Db, id: number, details: OrderDetails): Promise<void> {
  await db.update(chinaOrders).set(details).where(eq(chinaOrders.id, id));
}
