import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { listClosedChinaOrders, listOpenChinaOrders } from "@/lib/china/repo";
import { arrivalRisk, defaultExpectedOn } from "@/lib/china/rules";
import { businessToday } from "@/lib/dates";
import { fmtDate, fmtInt } from "@/lib/forecast/format";
import { dayInBusinessZone, loadForecastBoard } from "@/lib/forecast/repo";
import { reorderPointDays, RULES } from "@/lib/forecast/rules";
import { OrderForm, type OrderRow } from "./order-form";
import { ChinaOrderList } from "./order-list";

export const metadata = { title: "China orders · RB Collections FBA Dashboard" };

type LateRisk = { orderId: number; inhouseSku: string; expectedOn: string; runsOutOn: string; gapDays: number };

export default async function ChinaOrdersPage() {
  await requireAdmin();
  const db = getDb();
  const today = businessToday();
  const [board, open, closed] = await Promise.all([loadForecastBoard(db, today), listOpenChinaOrders(db), listClosedChinaOrders(db)]);

  const openBySku = new Map<number, number[]>();
  for (const o of open) for (const l of o.lines) if (l.casesToCome > 0) openBySku.set(l.skuId, [...(openBySku.get(l.skuId) ?? []), o.id]);

  const newOrderArrives = defaultExpectedOn(today);
  const lateRisks: LateRisk[] = [];
  const rows: OrderRow[] = board.rows.map((r) => {
    const f = r.forecast;
    const stockDay = r.fba ? dayInBusinessZone(r.fba.asOf) : null;
    let warning: string | null = null;
    if (f.dailyRate && stockDay && f.fbaUnits !== null) {
      const onHand = f.fbaUnits + (r.warehouseOnHand ?? 0);
      // The first open order for this SKU: does it land before stock runs out?
      const first = open.find((o) => o.lines.some((l) => l.skuId === r.id && l.casesToCome > 0));
      if (first) {
        const risk = arrivalRisk({ stockDay, unitsOnHand: onHand, dailyRate: f.dailyRate, expectedOn: first.expectedOn });
        if (risk.gapDays > 0) {
          lateRisks.push({ orderId: first.id, inhouseSku: r.inhouseSku, expectedOn: first.expectedOn, runsOutOn: risk.runsOutOn, gapDays: risk.gapDays });
        }
      }
      const due = f.reorderStatus === "red" || f.reorderStatus === "yellow";
      if (due && r.warehouseOnHand !== null) {
        const risk = arrivalRisk({ stockDay, unitsOnHand: onHand + r.onOrder, dailyRate: f.dailyRate, expectedOn: newOrderArrives });
        if (risk.gapDays > 0) {
          warning = `Even ordered today, stock may run out about ${fmtInt(risk.gapDays)} days before this order can sell at Amazon. Ask the supplier for a faster ship date.`;
        }
      }
    }
    const due = (f.reorderStatus === "red" || f.reorderStatus === "yellow") && !f.reorderAssumesEmptyWarehouse;
    return {
      id: r.id,
      inhouseSku: r.inhouseSku,
      amazonSku: r.amazonSku,
      listingName: r.listingName,
      reorderStatus: f.reorderStatus,
      reorderBy: f.reorderBy,
      provisional: f.reorderAssumesEmptyWarehouse,
      suggestedCases: f.reorderCases,
      unitsPerCase: r.unitsPerCase,
      totalCoverDays: f.totalCoverDays,
      onOrderUnits: r.onOrder,
      openOrderIds: openBySku.get(r.id) ?? [],
      warning,
      defaultIncluded: due && !!f.reorderCases,
    };
  });
  // Due SKUs first, then the rest in Overview order.
  const rank = (r: OrderRow) => (r.provisional ? 2 : r.reorderStatus === "red" ? 0 : r.reorderStatus === "yellow" ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b));
  const dueCount = rows.filter((r) => r.defaultIncluded).length;
  const notCounted = rows.filter((r) => r.provisional).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>China orders</h1>
          <p className="muted">
            What to reorder from China, and what is already on the way. Place the order with the supplier as usual,
            then save it here so the units count as on order and the warehouse knows what to expect.
          </p>
        </div>
        <Link className="button" href="/overview">
          Back to overview
        </Link>
      </div>

      <h2>On order from China</h2>
      {lateRisks.length > 0 && (
        <div className="alert warn" data-testid="late-risk">
          <strong>May arrive too late:</strong>
          <ul>
            {lateRisks.map((l) => (
              <li key={`${l.orderId}-${l.inhouseSku}`}>
                {l.inhouseSku}: stock runs out around {fmtDate(l.runsOutOn)}, but <Link href={`/china/${l.orderId}`}>order #{l.orderId}</Link>{" "}
                is expected {fmtDate(l.expectedOn)} and needs about {RULES.warehouseToFbaDays} more days to reach Amazon. About {fmtInt(l.gapDays)}{" "}
                days without stock.
              </li>
            ))}
          </ul>
        </div>
      )}
      {open.length === 0 ? (
        <div className="card muted" data-testid="no-china-orders">
          Nothing on order. If you already have orders on the way, save each one below with the day you placed it.
        </div>
      ) : (
        <ChinaOrderList orders={open} today={today} linkBase="/china" />
      )}

      <h2>Plan a new China order</h2>
      <p className="small muted" data-testid="order-summary">
        {dueCount === 0
          ? `No counted SKU is due to reorder in the next ${RULES.reorderSoonDays} days. You can still tick any SKU.`
          : `${dueCount} ${dueCount === 1 ? "SKU is" : "SKUs are"} due to reorder within ${RULES.reorderSoonDays} days and ticked below.`}{" "}
        The app suggests {RULES.chinaOrderCoverDays} days of sales, in full cases. Reorder when total cover (Amazon +
        on the way + warehouse + already on order) reaches {reorderPointDays()} days.
        {notCounted > 0 &&
          ` ${notCounted} ${notCounted === 1 ? "SKU has" : "SKUs have"} no warehouse count yet, so their dates treat the warehouse as empty and they are not ticked. Count them on the Stock counts screen first.`}
      </p>
      {board.rows.length === 0 ? (
        <div className="card">
          No SKUs yet. Add them on the <Link href="/skus">SKUs</Link> screen.
        </div>
      ) : (
        <OrderForm rows={rows} today={today} defaultExpected={newOrderArrives} />
      )}

      <h2>Received and cancelled</h2>
      {closed.length === 0 ? (
        <div className="card muted">No orders received or cancelled yet.</div>
      ) : (
        <ChinaOrderList orders={closed} today={today} linkBase="/china" />
      )}
    </>
  );
}
