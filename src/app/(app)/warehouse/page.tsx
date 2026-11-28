import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { groupByListing, listSkus } from "@/lib/skus/repo";

export const metadata = { title: "Warehouse · RB Collections FBA Dashboard" };

export default async function WarehousePage() {
  await requireUser();
  const groups = groupByListing(await listSkus(getDb()));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Warehouse</h1>
          <p className="muted">
            How each product is packed and stacked. Pallet build sheets for requested shipments will appear on
            this screen in a later update.
          </p>
        </div>
        <Link className="button primary" href="/warehouse/counts">
          Enter stock counts
        </Link>
      </div>
      {groups.length === 0 && <div className="card">No SKUs have been set up yet.</div>}
      {groups.map((g) => (
        <section key={g.listing}>
          <h2>{g.listing}</h2>
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
