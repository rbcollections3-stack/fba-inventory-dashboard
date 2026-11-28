import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { numberPallets } from "@/lib/shipments/pallets";
import { getShipment } from "@/lib/shipments/repo";
import { cancelShipmentAction, saveAmazonIdAction } from "../actions";
import { fmtWhen } from "../shipment-list";
import { PalletSheet } from "./pallet-sheet";
import { PrintButton } from "./print-button";

export const metadata = { title: "Pallet build sheets · RB Collections FBA Dashboard" };

const n = (v: number) => v.toLocaleString("en-US");

export default async function ShipmentSheetsPage({ params, searchParams }: PageProps<"/warehouse/shipments/[id]">) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const s = await getShipment(getDb(), id);
  if (!s) notFound();
  const q = await searchParams;
  const numbered = numberPallets(s.lines);
  const open = s.status === "requested";

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1>
            Shipment #{s.id}{" "}
            <span className={`badge ${open ? "warn" : s.status === "sent" ? "ok" : "off"}`} data-testid="shipment-status">
              {open ? "To build" : s.status === "sent" ? "Sent" : "Cancelled"}
            </span>
          </h1>
          <p className="muted">
            {n(s.totalPallets)} {s.totalPallets === 1 ? "pallet" : "pallets"}, {n(s.totalCases)} cases,{" "}
            {n(s.totalUnits)} units. Requested {fmtWhen(s.createdAt)}
            {s.createdBy ? ` by ${s.createdBy}` : ""}.
            {s.status === "sent" && ` Sent ${fmtWhen(s.sentAt)}${s.sentBy ? ` by ${s.sentBy}` : ""}.`}
          </p>
        </div>
        <div className="actions">
          <Link className="button" href={isAdmin ? "/shipments" : "/warehouse/shipments"}>
            Back
          </Link>
          {s.status !== "cancelled" && (
            <Link className="button" href={`/warehouse/shipments/${s.id}/labels`} data-testid="amazon-labels-link">
              Amazon box and pallet labels
            </Link>
          )}
          {s.status !== "cancelled" && <PrintButton />}
          {open && (
            <Link className="button primary" href={`/warehouse/shipments/${s.id}/send`} data-testid="mark-sent-link">
              Mark as sent
            </Link>
          )}
        </div>
      </div>

      {q.new && (
        <div className="alert ok no-print" role="status">
          Shipment created. The warehouse can see it now under Shipments to build. Create the matching shipment in
          Seller Central as usual.
        </div>
      )}
      {q.sent && (
        <div className="alert ok no-print" role="status" data-testid="sent-confirmation">
          Marked as sent. The stock left on the shelf is saved as the new warehouse count, and these units now count as
          on the way to Amazon.
        </div>
      )}
      {s.status === "cancelled" && (
        <div className="alert error no-print">This shipment was cancelled. Do not build it.</div>
      )}
      {s.note && <div className="alert warn">Note: {s.note}</div>}
      {q.idError && (
        <div className="alert error no-print" role="alert">
          That Amazon shipment ID was not saved. Amazon shipment IDs start with FBA, such as FBA15K2LMN3P. Type more
          than one with commas between them.
        </div>
      )}

      {isAdmin && s.status !== "cancelled" && (
        <div className="card no-print admin-tools">
          <form action={saveAmazonIdAction.bind(null, s.id)} className="inline-form">
            <label htmlFor="amazonShipmentId">Amazon shipment ID (needed to print Amazon labels)</label>
            <input
              id="amazonShipmentId"
              name="amazonShipmentId"
              type="text"
              maxLength={400}
              defaultValue={s.amazonShipmentId ?? ""}
              placeholder="FBA..."
            />
            <button type="submit">Save</button>
            <span className="hint muted small">
              From Seller Central after you create the shipment. If Amazon split it, type every ID with commas between.
            </span>
          </form>
          {open && (
            <form action={cancelShipmentAction.bind(null, s.id)}>
              <button type="submit" className="danger">
                Cancel this shipment
              </button>
            </form>
          )}
        </div>
      )}

      <section className="pick-list card" aria-label="Pick list">
        <div className="sheet-top">
          <div>
            <div className="sheet-pallet-no">Shipment #{s.id}: pick list</div>
            <div className="muted">
              {s.amazonShipmentId ? `Amazon shipment ${s.amazonShipmentId} · ` : ""}
              {n(s.totalPallets)} {s.totalPallets === 1 ? "pallet" : "pallets"} · {n(s.totalCases)} cases
            </div>
          </div>
        </div>
        <ol className="steps">
          <li>
            There is <strong>one sheet for each pallet</strong>. Build one pallet at a time, following its sheet from
            step 1.
          </li>
          <li>
            <strong>Never mix products on a pallet.</strong> Each pallet holds one in-house SKU only.
          </li>
          <li>Find products by the big in-house SKU. That is the label on the shelf and on the cases.</li>
          <li>
            If the units have <strong>no Amazon barcode sticker</strong> (starts with X00), print stickers with the link
            under the SKU and put one on every unit before packing.
          </li>
          <li>
            Print the <strong>Amazon box and pallet labels</strong> (button at the top) on the Rollo with 4x6 labels.
            They come sorted by pallet.
          </li>
          <li>When a pallet is done, sign its sheet and keep it with the pallet.</li>
          <li>When every pallet is built and has left, press Mark as sent and count what is left on the shelf.</li>
        </ol>
        <table className="pick-table">
          <thead>
            <tr>
              <th>In-house SKU</th>
              <th className="num">Cases</th>
              <th className="num">Units</th>
              <th>Pallets</th>
            </tr>
          </thead>
          <tbody>
            {numbered.map(({ line, pallets }) => (
              <tr key={line.id} data-testid="pick-row">
                <td>
                  <div className="inhouse-sm">{line.inhouseSku}</div>
                  <span className="subtle">Amazon SKU: {line.amazonSku}</span>
                  {line.fnsku && open && (
                    <Link
                      className="no-print small"
                      href={`/warehouse/labels/print?sku=${line.skuId}&qty=${line.units}&back=/warehouse/shipments/${s.id}`}
                    >
                      Barcode stickers for {n(line.units)} units
                    </Link>
                  )}
                </td>
                <td className="num">
                  <strong>{n(line.cases)}</strong>
                </td>
                <td className="num">{n(line.units)}</td>
                <td className="wrap">
                  {pallets.map((p) => `Pallet ${p.number}: ${p.layout.cases} cases`).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">
                <strong>{n(s.totalCases)}</strong>
              </td>
              <td className="num">{n(s.totalUnits)}</td>
              <td>{n(s.totalPallets)} pallets</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {numbered.flatMap(({ line, pallets }) =>
        pallets.map((p) => (
          <PalletSheet
            key={p.number}
            shipmentId={s.id}
            amazonShipmentId={s.amazonShipmentId}
            totalPallets={s.totalPallets}
            line={line}
            sheet={p}
          />
        )),
      )}
    </>
  );
}
