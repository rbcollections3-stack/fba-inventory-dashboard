import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { groupByListing, listSkus } from "@/lib/skus/repo";

export const metadata = { title: "SKUs · RB Collections FBA Dashboard" };

export default async function SkusPage() {
  await requireAdmin();
  const skus = await listSkus(getDb());
  const groups = groupByListing(skus);
  const counted = skus.filter((s) => s.warehouseOnHand !== null);
  const totalUnits = counted.reduce((sum, s) => sum + (s.warehouseOnHand ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>SKU setup</h1>
          <p className="muted">Every SKU with its packing and pallet details. Click a SKU to edit it.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/skus/new">
            Add a SKU
          </Link>
          <Link className="button primary" href="/skus/import">
            Import spreadsheet
          </Link>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="value" data-testid="sku-count">{skus.length}</div>
          <div className="label">SKUs</div>
        </div>
        <div className="stat">
          <div className="value" data-testid="listing-count">{groups.length}</div>
          <div className="label">Listings</div>
        </div>
        <div className="stat">
          <div className="value">{totalUnits.toLocaleString("en-US")}</div>
          <div className="label">Units in warehouse</div>
        </div>
      </div>

      {skus.length === 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No SKUs yet</h2>
          <p>
            Fill in the <a href="/SKU-setup-template.xlsx">SKU template</a> with one row per SKU, then{" "}
            <Link href="/skus/import">import it</Link>.
          </p>
        </div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Amazon SKU</th>
                <th>In-house SKU</th>
                <th>Description</th>
                <th className="num">Units / case</th>
                <th className="num">Tie</th>
                <th className="num">High</th>
                <th className="num">Max cases / pallet</th>
                <th className="num">Warehouse on hand</th>
                <th>Counted</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <ListingRows key={g.listing} listing={g.listing} skus={g.skus} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ListingRows({ listing, skus }: { listing: string; skus: Awaited<ReturnType<typeof listSkus>> }) {
  return (
    <>
      <tr className="listing-row">
        <td colSpan={9}>
          {listing} <span className="muted small">({skus.length} SKUs)</span>
        </td>
      </tr>
      {skus.map((s) => (
        <tr key={s.id} data-testid="sku-row">
          <td>
            <Link href={`/skus/${s.id}`}>{s.amazonSku}</Link>
          </td>
          <td>{s.inhouseSku}</td>
          <td className="wrap">{s.description ?? <span className="muted">-</span>}</td>
          <td className="num">{s.unitsPerCase}</td>
          <td className="num">{s.tie}</td>
          <td className="num">{s.high}</td>
          <td className="num">{s.maxCasesPerPallet}</td>
          <td className="num">
            {s.warehouseOnHand === null ? <span className="muted">-</span> : s.warehouseOnHand.toLocaleString("en-US")}
          </td>
          <td>{s.countedOn ?? <span className="muted">-</span>}</td>
        </tr>
      ))}
    </>
  );
}
