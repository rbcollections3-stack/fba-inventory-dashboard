import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { groupByListing, listSkus, type SkuWithStock } from "@/lib/skus/repo";
import { latestFbaStock, recentSales, type FbaFigures } from "@/lib/amazon/repo";

type Row = SkuWithStock & { fba: FbaFigures | null; sold30: number | null };

function n(v: number | null | undefined) {
  return v === null || v === undefined ? <span className="muted">-</span> : v.toLocaleString("en-US");
}

function fmtDay(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmtWhen(d: Date) {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" });
}

export const metadata = { title: "SKUs · RB Collections FBA Dashboard" };

export default async function SkusPage() {
  await requireAdmin();
  const db = getDb();
  const [base, fba, sales] = await Promise.all([listSkus(db), latestFbaStock(db), recentSales(db, 30)]);
  const skus: Row[] = base.map((s) => ({
    ...s,
    fba: fba.get(s.id) ?? null,
    sold30: sales ? (sales.bySku.get(s.id) ?? 0) : null,
  }));
  const groups = groupByListing(skus);
  const fbaAsOf = [...fba.values()].map((f) => f.asOf).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const totalFba = [...fba.values()].reduce((sum, f) => sum + f.fulfillable, 0);
  const totalInbound = [...fba.values()].reduce((sum, f) => sum + f.inbound, 0);
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
        <div className="stat">
          <div className="value" data-testid="fba-total">{fbaAsOf ? totalFba.toLocaleString("en-US") : "-"}</div>
          <div className="label">Units available in FBA</div>
        </div>
        <div className="stat">
          <div className="value" data-testid="inbound-total">{fbaAsOf ? totalInbound.toLocaleString("en-US") : "-"}</div>
          <div className="label">Units inbound to FBA</div>
        </div>
      </div>

      {skus.length > 0 && (
        <p className="small muted" data-testid="amazon-freshness">
          {fbaAsOf ? <>FBA stock and inbound as of {fmtWhen(fbaAsOf)}. </> : <>No FBA stock loaded yet. </>}
          {sales ? <>Sold (30 days) covers {fmtDay(sales.start)} to {fmtDay(sales.end)}. </> : <>No sales loaded yet. </>}
          <Link href="/amazon">Upload Amazon reports</Link>
        </p>
      )}

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
                <th className="num" title="Units Amazon can sell now (fulfillable)">FBA available</th>
                <th className="num" title="Units Amazon is holding for orders, transfers between centers and processing">FBA reserved</th>
                <th className="num" title="Shipments created, on the way, or being checked in at Amazon">Inbound to FBA</th>
                <th className="num" title="Units shipped to customers in the last 30 days of the ledger">Sold (30 days)</th>
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

function ListingRows({ listing, skus }: { listing: string; skus: Row[] }) {
  return (
    <>
      <tr className="listing-row">
        <td colSpan={12}>
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
          <td className="num" data-testid="warehouse-cell">
            {n(s.warehouseOnHand)}
            {s.countedOn && <span className="subtle">counted {s.countedOn}</span>}
          </td>
          <td className="num" data-testid="fba-cell">{n(s.fba?.fulfillable)}</td>
          <td className="num">{n(s.fba?.reserved)}</td>
          <td
            className="num"
            data-testid="inbound-cell"
            title={
              s.fba
                ? `Not yet sent: ${s.fba.inboundWorking}. On the way: ${s.fba.inboundShipped}. Being checked in: ${s.fba.inboundReceiving}.`
                : undefined
            }
          >
            {n(s.fba?.inbound)}
          </td>
          <td className="num" data-testid="sold-cell">{n(s.sold30)}</td>
        </tr>
      ))}
    </>
  );
}
