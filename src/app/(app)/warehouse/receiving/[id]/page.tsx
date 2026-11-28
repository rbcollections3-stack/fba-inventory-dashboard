import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { getChinaOrder } from "@/lib/china/repo";
import { businessToday } from "@/lib/dates";
import { fmtDay, orderBadge } from "../../../china/order-list";
import { ReceiveForm, type ReceiveLine } from "../receive-form";

export const metadata = { title: "Receive China order · RB Collections FBA Dashboard" };

const n = (v: number) => v.toLocaleString("en-US");

export default async function ReceiveOrderPage({ params, searchParams }: PageProps<"/warehouse/receiving/[id]">) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const o = await getChinaOrder(getDb(), id);
  if (!o || o.status === "cancelled") notFound();
  const q = await searchParams;
  const badge = orderBadge(o, businessToday());
  const lines: ReceiveLine[] = o.lines.map((l) => ({
    skuId: l.skuId,
    inhouseSku: l.inhouseSku,
    amazonSku: l.amazonSku,
    description: l.description,
    unitsPerCase: l.unitsPerCase,
    casesOrdered: l.cases,
    casesReceived: l.casesReceived,
    casesToCome: l.casesToCome,
    lastCount: l.warehouseOnHand,
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            Receive China order #{o.id}{" "}
            <span className={`badge ${badge.cls}`} data-testid="receive-status">
              {badge.label}
            </span>
          </h1>
          <p className="muted">
            {n(o.totalCases)} cases ordered, expected {fmtDay(o.expectedOn)}.
            {o.casesReceived > 0 && ` ${n(o.casesReceived)} cases already received.`}
          </p>
        </div>
        <div className="actions">
          <Link className="button" href={user.role === "admin" ? `/china/${o.id}` : "/warehouse/receiving"}>
            Back
          </Link>
        </div>
      </div>

      {q.saved === "all" && (
        <div className="alert ok" role="status" data-testid="received-confirmation">
          Saved. Everything on this order has arrived. The shelf counts are the new warehouse stock.
        </div>
      )}
      {q.saved === "part" && (
        <div className="alert ok" role="status" data-testid="received-confirmation">
          Saved. Some cases on this order have not arrived yet, so it stays open for the next delivery. The shelf counts
          are the new warehouse stock.
        </div>
      )}
      {o.note && <div className="alert warn">Note: {o.note}</div>}

      {o.status === "received" ? (
        <div className="card" data-testid="order-done">
          This order is fully received. Nothing more to do.
        </div>
      ) : (
        <>
          <div className="card">
            <ol className="steps" style={{ marginBottom: 0 }}>
              <li>Check the delivery is from China and the cases show the in-house SKUs below.</li>
              <li>
                For each SKU, count the <strong>full, sealed cases that arrived</strong> and type the number. Type 0 if
                none of that SKU came.
              </li>
              <li>Put the cases away on the shelf for that SKU.</li>
              <li>
                Count the shelf: <strong>full cases</strong> and any <strong>loose units</strong>. The boxes fill in with
                the last count plus what arrived. If the shelf is different, type what you see.
              </li>
              <li>
                Press <strong>Delivery is put away: save counts</strong>.
              </li>
              <li>If a case is damaged or a SKU is missing, tell the office.</li>
            </ol>
          </div>
          <ReceiveForm orderId={o.id} lines={lines} />
        </>
      )}
    </>
  );
}
