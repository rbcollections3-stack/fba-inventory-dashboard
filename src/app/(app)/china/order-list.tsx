import Link from "next/link";
import type { ChinaOrderView } from "@/lib/china/repo";
import { daysBetween } from "@/lib/forecast/rules";

const n = (v: number) => v.toLocaleString("en-US");

export function fmtDay(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The badge for an order: on the way, due, late, partly received, received, cancelled. */
export function orderBadge(o: Pick<ChinaOrderView, "status" | "expectedOn" | "casesReceived">, today: string) {
  if (o.status === "received") return { label: "Received", cls: "ok" };
  if (o.status === "cancelled") return { label: "Cancelled", cls: "off" };
  const away = daysBetween(today, o.expectedOn);
  if (o.casesReceived > 0) return { label: "Part received", cls: "warn" };
  if (away < 0) return { label: `Late ${n(-away)} ${away === -1 ? "day" : "days"}`, cls: "off" };
  if (away <= 7) return { label: away === 0 ? "Due today" : `Due in ${n(away)} ${away === 1 ? "day" : "days"}`, cls: "warn" };
  return { label: "On the way", cls: "ok" };
}

/** A table of China orders. Used on the admin's China orders screen and the warehouse's Receiving screen. */
export function ChinaOrderList({
  orders,
  today,
  linkBase,
  showSupplier = true,
}: {
  orders: ChinaOrderView[];
  today: string;
  /** "/china" for the admin, "/warehouse/receiving" for the warehouse. */
  linkBase: string;
  showSupplier?: boolean;
}) {
  return (
    <div className="card table-wrap" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Status</th>
            <th>What is in it (cases)</th>
            <th className="num">Cases</th>
            <th>Ordered</th>
            <th>Expected at warehouse</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const b = orderBadge(o, today);
            return (
              <tr key={o.id} data-testid="china-order-row">
                <td>
                  <Link href={`${linkBase}/${o.id}`} className="inhouse-sm">
                    #{o.id}
                  </Link>
                  {showSupplier && (o.supplier || o.poNumber) && (
                    <span className="subtle">{[o.supplier, o.poNumber && `PO ${o.poNumber}`].filter(Boolean).join(" · ")}</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${b.cls}`}>{b.label}</span>
                </td>
                <td className="wrap">
                  {o.lines.map((l) => `${l.inhouseSku} x ${n(l.cases)}`).join(", ")}
                  {o.casesReceived > 0 && o.status === "ordered" && (
                    <span className="subtle">{n(o.casesToCome)} cases still to come</span>
                  )}
                  {o.note && <span className="subtle">Note: {o.note}</span>}
                </td>
                <td className="num">{n(o.totalCases)}</td>
                <td>{fmtDay(o.orderedOn)}</td>
                <td>{fmtDay(o.expectedOn)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
