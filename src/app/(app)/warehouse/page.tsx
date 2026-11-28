import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { listShipments } from "@/lib/shipments/repo";
import { groupByListing, listSkus } from "@/lib/skus/repo";
import { ShipmentList } from "./shipments/shipment-list";

export const metadata = { title: "Warehouse · RB Collections FBA Dashboard" };

export default async function WarehousePage() {
  await requireUser();
  const db = getDb();
  const [all, toBuild] = await Promise.all([listSkus(db), listShipments(db, "requested")]);
  const groups = groupByListing(all);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Warehouse</h1>
          <p className="muted">Shipments to build, and how each product is packed and stacked.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/warehouse/shipments">
            All shipments
          </Link>
          <Link className="button primary" href="/warehouse/counts">
            Enter stock counts
          </Link>
        </div>
      </div>
      <h2>Shipments to build</h2>
      {toBuild.length === 0 ? (
        <div className="card muted" data-testid="no-shipments">
          Nothing to build right now.
        </div>
      ) : (
        <ShipmentList shipments={toBuild} />
      )}
      <h2>How each product is packed</h2>
      {groups.length === 0 && <div className="card">No SKUs have been set up yet.</div>}
      {groups.map((g) => (
        <section key={g.listing}>
          <h3>{g.listing}</h3>
          <div className="wh-grid">
            {g.skus.map((s) => (
              <div className="wh-card" key={s.id} data-testid="wh-card">
                <div className="inhouse">{s.inhouseSku}</div>
                <div className="muted small">Amazon SKU: {s.amazonSku}</div>
                {s.description && <div>{s.description}</div>}
                <dl>
                  <dt>Units per case</dt>
                  <dd>{s.unitsPerCase}</dd>
                  <dt>Cases per layer</dt>
                  <dd>{s.tie}</dd>
                  <dt>Layers</dt>
                  <dd>{s.high}</dd>
                  <dt>Max cases / pallet</dt>
                  <dd>{s.maxCasesPerPallet}</dd>
                  {s.warehouseLocation && (
                    <>
                      <dt>Location</dt>
                      <dd>{s.warehouseLocation}</dd>
                    </>
                  )}
                </dl>
                {s.notes && <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>Note: {s.notes}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
