import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { getChinaOrder } from "@/lib/china/repo";
import { businessToday } from "@/lib/dates";
import { PrintButton } from "../../warehouse/shipments/[id]/print-button";
import { fmtWhen } from "../../warehouse/shipments/shipment-list";
import { cancelChinaOrderAction, closeChinaOrderAction } from "../actions";
import { fmtDay, orderBadge } from "../order-list";
import { DetailsForm } from "./details-form";

export const metadata = { title: "China order · RB Collections FBA Dashboard" };

const n = (v: number) => v.toLocaleString("en-US");

export default async function ChinaOrderPage({ params, searchParams }: PageProps<"/china/[id]">) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const o = await getChinaOrder(getDb(), id);
  if (!o) notFound();
  const q = await searchParams;
  const today = businessToday();
  const badge = orderBadge(o, today);
  const open = o.status === "ordered";
  const anyReceived = o.receipts.length > 0;
  const deliveries = [...new Set(o.receipts.map((r) => `${r.at.getTime()}`))];

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1>
            China order #{o.id}{" "}
            <span className={`badge ${badge.cls}`} data-testid="china-order-status">
              {badge.label}
            </span>
          </h1>
          <p className="muted">
            {n(o.totalCases)} cases, {n(o.totalUnits)} units. Ordered {fmtDay(o.orderedOn)}, expected at the warehouse{" "}
            {fmtDay(o.expectedOn)}.{o.createdBy ? ` Saved by ${o.createdBy}.` : ""}
            {o.status !== "ordered" && o.closedAt && ` ${o.status === "received" ? "Closed" : "Cancelled"} ${fmtWhen(o.closedAt)}${o.closedBy ? ` by ${o.closedBy}` : ""}.`}
          </p>
        </div>
        <div className="actions">
          <Link className="button" href="/china">
            Back
          </Link>
          <PrintButton label="Print order sheet" />
          {open && (
            <Link className="button primary" href={`/warehouse/receiving/${o.id}`} data-testid="receive-link">
              Receive delivery
            </Link>
          )}
        </div>
      </div>

      {q.new && (
        <div className="alert ok no-print" role="status" data-testid="order-saved">
          Order saved. Its units now count as on order, so the reorder-by dates for these SKUs have moved. The warehouse
          can see it under Receiving.
        </div>
      )}
      {q.closed && (
        <div className="alert ok no-print" role="status">
          Order closed. Anything not received no longer counts as on order.
        </div>
      )}
      {q.cancelled && (
        <div className="alert ok no-print" role="status">
          Order cancelled. Its units no longer count as on order.
        </div>
      )}
      {q.cancelError && (
        <div className="alert error no-print" role="alert">
          Part of this order has arrived, so it cannot be cancelled. Use Close order instead.
        </div>
      )}

      <section className="pick-list card" aria-label="Order sheet">
        <div className="sheet-top">
          <div>
            <div className="sheet-pallet-no">China order #{o.id}</div>
            <div className="muted">
              {[o.supplier, o.poNumber && `PO ${o.poNumber}`, `ordered ${fmtDay(o.orderedOn)}`, `expected ${fmtDay(o.expectedOn)}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
        {o.note && <p>Note: {o.note}</p>}
        <table className="pick-table">
          <thead>
            <tr>
              <th>In-house SKU</th>
              <th>Product</th>
              <th className="num">Units per case</th>
              <th className="num">Cases ordered</th>
              <th className="num">Units</th>
              <th className="num">Cases received</th>
              <th className="num">Still to come</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.id} data-testid="china-line">
                <td>
                  <div className="inhouse-sm">{l.inhouseSku}</div>
                  <span className="subtle">Amazon SKU: {l.amazonSku}</span>
                </td>
                <td>{l.description ?? l.listingName}</td>
                <td className="num">{n(l.unitsPerCase)}</td>
                <td className="num">
                  <strong>{n(l.cases)}</strong>
                </td>
                <td className="num">{n(l.units)}</td>
                <td className="num">{n(l.casesReceived)}</td>
                <td className="num">{o.status === "ordered" ? n(l.casesToCome) : <span className="muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Total</td>
              <td className="num">
                <strong>{n(o.totalCases)}</strong>
              </td>
              <td className="num">{n(o.totalUnits)}</td>
              <td className="num">{n(o.casesReceived)}</td>
              <td className="num">{o.status === "ordered" ? n(o.casesToCome) : "-"}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {anyReceived && (
        <>
          <h2 className="no-print">Deliveries received</h2>
          <div className="card table-wrap no-print" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Delivery</th>
                  <th>Received</th>
                  <th>Cases that arrived</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((key, i) => {
                  const rs = o.receipts.filter((r) => `${r.at.getTime()}` === key);
                  return (
                    <tr key={key} data-testid="delivery-row">
                      <td>{i + 1}</td>
                      <td>{fmtDay(rs[0].receivedOn)}</td>
                      <td className="wrap">{rs.map((r) => `${r.inhouseSku} x ${n(r.cases)}`).join(", ")}</td>
                      <td>{rs[0].by ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {o.status !== "cancelled" && (
        <DetailsForm
          id={o.id}
          today={today}
          values={{ supplier: o.supplier, poNumber: o.poNumber, orderedOn: o.orderedOn, expectedOn: o.expectedOn, note: o.note }}
        />
      )}

      {open && (
        <div className="card no-print admin-tools">
          {anyReceived ? (
            <form action={closeChinaOrderAction.bind(null, o.id)}>
              <p className="small muted" style={{ marginTop: 0 }}>
                If the supplier will not send the {n(o.casesToCome)} cases still to come, close the order so they stop
                counting as on order.
              </p>
              <button type="submit" className="danger" data-testid="close-order">
                Close order: nothing more is coming
              </button>
            </form>
          ) : (
            <form action={cancelChinaOrderAction.bind(null, o.id)}>
              <p className="small muted" style={{ marginTop: 0 }}>
                Cancel only if this order was never placed or the supplier cancelled it.
              </p>
              <button type="submit" className="danger" data-testid="cancel-order">
                Cancel this order
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
