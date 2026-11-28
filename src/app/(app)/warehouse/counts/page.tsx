import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { groupByListing, listSkus } from "@/lib/skus/repo";
import { recentCounts } from "@/lib/warehouse/counts";
import { CountForm } from "./count-form";

export const metadata = { title: "Stock counts · RB Collections FBA Dashboard" };

export default async function CountsPage() {
  await requireUser();
  const db = getDb();
  const [all, history] = await Promise.all([listSkus(db), recentCounts(db, 30)]);
  const groups = groupByListing(all).map((g) => ({
    listing: g.listing,
    skus: g.skus.map((s) => ({
      id: s.id,
      inhouseSku: s.inhouseSku,
      amazonSku: s.amazonSku,
      description: s.description,
      unitsPerCase: s.unitsPerCase,
      current: s.warehouseOnHand,
      countedOn: s.countedOn,
    })),
  }));
  const label = new Map(all.map((s) => [s.id, s.inhouseSku]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Stock counts</h1>
          <p className="muted">Count the stock on the shelves and type it in here.</p>
        </div>
        <Link className="button" href="/warehouse">
          Back to warehouse
        </Link>
      </div>

      <div className="card">
        <ol className="steps" style={{ marginBottom: 0 }}>
          <li>Go to the shelf with the in-house SKU label shown in the first column.</li>
          <li>
            Count the <strong>full, sealed cases</strong> and type the number under <em>Full cases</em>.
          </li>
          <li>
            If there is an open case or loose items, count the single items and type that under{" "}
            <em>Loose units</em>. Otherwise leave it empty.
          </li>
          <li>Check the total in the last column, then press <strong>Save counts</strong> at the bottom.</li>
          <li>Only fill in the SKUs you counted. Empty rows keep their last count.</li>
          <li>Made a mistake? Count again and save. A new count on the same day replaces the earlier one.</li>
        </ol>
      </div>

      {all.length === 0 ? <div className="card">No SKUs have been set up yet.</div> : <CountForm groups={groups} />}

      <h2>Recent counts</h2>
      {history.length === 0 ? (
        <div className="card muted">No counts yet.</div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Count date</th>
                <th>In-house SKU</th>
                <th className="num">Units</th>
                <th>Entered by</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.countedOn}</td>
                  <td>{label.get(h.skuId) ?? "-"}</td>
                  <td className="num">{h.units.toLocaleString("en-US")}</td>
                  <td>
                    {h.source === "import" ? "SKU spreadsheet" : (h.by ?? "-")}
                    {h.source === "shipment" && <span className="subtle">after shipment #{h.shipmentId ?? "?"} left</span>}
                    {h.source === "china_order" && <span className="subtle">after China order #{h.chinaOrderId ?? "?"} arrived</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
