import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday } from "@/lib/dates";
import { fmtDate, fmtDays, fmtInt, fmtRate, STATUS_LABEL } from "@/lib/forecast/format";
import { recordDailyForecast } from "@/lib/forecast/check";
import { loadForecastBoard, type SkuForecast } from "@/lib/forecast/repo";
import { RULES } from "@/lib/forecast/rules";
import { groupByListing } from "@/lib/skus/repo";

export const metadata = { title: "Overview · RB Collections FBA Dashboard" };

function fmtWhen(d: Date) {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });
}

const COLS = 11;

const cases = (n: number | null) => `${fmtInt(n)} ${n === 1 ? "case" : "cases"}`;

export default async function OverviewPage({ searchParams }: PageProps<"/overview">) {
  await requireAdmin();
  const byListing = (await searchParams).view === "listing";
  const db = getDb();
  const board = await loadForecastBoard(db, businessToday());
  // Keep today's forecast for the forecast check (only the first one each day is saved).
  await recordDailyForecast(db, board).catch(() => 0);
  const { rows } = board;
  const count = (s: string) => rows.filter((r) => r.forecast.status === s).length;
  const uncounted = rows.filter((r) => r.warehouseOnHand === null).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">
            When to ship each SKU to Amazon and when to reorder from China. Click a SKU to see how its dates are worked
            out or to enter expected daily sales.
          </p>
        </div>
        <div className="actions">
          <Link className="button primary" href="/shipments">
            Plan a shipment to Amazon
          </Link>
          <div className="toggle" role="group" aria-label="Sort">
            <Link href="/overview" aria-current={!byListing}>
              Most urgent first
            </Link>
            <Link href="/overview?view=listing" aria-current={byListing}>
              By listing
            </Link>
          </div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="value" data-testid="count-red">{count("red")}</div>
          <div className="label">
            <span className="status red">{STATUS_LABEL.red}</span> due today or late
          </div>
        </div>
        <div className="stat">
          <div className="value" data-testid="count-yellow">{count("yellow")}</div>
          <div className="label">
            <span className="status yellow">{STATUS_LABEL.yellow}</span> ship in 7 days or reorder in 14
          </div>
        </div>
        <div className="stat">
          <div className="value" data-testid="count-green">{count("green")}</div>
          <div className="label">
            <span className="status green">{STATUS_LABEL.green}</span> nothing due yet
          </div>
        </div>
        <div className="stat">
          <div className="value" data-testid="count-none">{count("none")}</div>
          <div className="label">
            <span className="status none">{STATUS_LABEL.none}</span> no sales or stock to plan from
          </div>
        </div>
      </div>

      <p className="small muted" data-testid="forecast-basis">
        {board.sales ? (
          <>
            Sales per day from Amazon sales {fmtDate(board.sales.start)} to {fmtDate(board.sales.end)} (
            {board.sales.days} days).{" "}
          </>
        ) : (
          <>No Amazon sales loaded yet. </>
        )}
        {board.stockAsOf ? <>FBA stock as of {fmtWhen(board.stockAsOf)}. </> : <>No FBA stock loaded yet. </>}
        Ship when FBA cover reaches {RULES.fbaFloorDays + RULES.warehouseToFbaDays} days; reorder when total cover reaches{" "}
        {RULES.fbaFloorDays + RULES.warehouseToFbaDays + RULES.chinaLeadDays + RULES.chinaBufferDays} days. China orders
        already placed are not tracked until Phase 6, so they count as zero.
      </p>

      {uncounted > 0 && rows.length > 0 && (
        <div className="alert warn" data-testid="uncounted-warning">
          {uncounted === rows.length
            ? "No SKUs have a warehouse count yet. "
            : `${uncounted} of ${rows.length} SKUs have no warehouse count yet. `}
          Ship-by dates are fine without one. Reorder-by dates for those SKUs
          treat the warehouse as empty, so they are shown in grey and are too early. Enter counts on{" "}
          <Link href="/warehouse/counts">Stock counts</Link>.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card">
          No SKUs yet. Add them on the <Link href="/skus">SKUs</Link> screen.
        </div>
      ) : (
        <div className="card table-wrap bleed" style={{ padding: 0 }}>
          <table className="forecast">
            <thead>
              <tr>
                <th>Status</th>
                <th>SKU</th>
                <th className="num" title="Units sold per day that the dates are planned from">Sales / day</th>
                <th className="num" title="Units Amazon can sell now">FBA available</th>
                <th className="num" title="Shipments created, on the way, or being checked in at Amazon">On the way to FBA</th>
                <th className="num">Warehouse</th>
                <th className="num" title="(FBA available + on the way) divided by sales per day">FBA cover (days)</th>
                <th title="Date the next shipment has to leave the warehouse, and its size">Ship to Amazon by</th>
                <th className="num" title="(FBA + on the way + warehouse + on order) divided by sales per day">Total cover (days)</th>
                <th title="Date to place the next China order, and its size">Reorder from China by</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {byListing
                ? groupByListing(rows).map((g) => (
                    <ListingGroup key={g.listing} listing={g.listing} rows={g.skus} />
                  ))
                : rows.map((r) => <ForecastRow key={r.id} r={r} showListing />)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ListingGroup({ listing, rows }: { listing: string; rows: SkuForecast[] }) {
  return (
    <>
      <tr className="listing-row">
        <td colSpan={COLS}>
          {listing} <span className="muted small">({rows.length} SKUs)</span>
        </td>
      </tr>
      {rows.map((r) => (
        <ForecastRow key={r.id} r={r} showListing={false} />
      ))}
    </>
  );
}

function ForecastRow({ r, showListing }: { r: SkuForecast; showListing: boolean }) {
  const f = r.forecast;
  return (
    <tr className={`row-${f.status}`} data-testid="forecast-row" data-status={f.status}>
      <td>
        <span className={`status ${f.status}`}>{STATUS_LABEL[f.status]}</span>
      </td>
      <td>
        <Link href={`/overview/${r.id}`}>{r.amazonSku}</Link>
        <span className="subtle">
          {r.inhouseSku}
          {showListing ? ` · ${r.listingName}` : ""}
        </span>
      </td>
      <td className="num" data-testid="rate-cell">
        {fmtRate(f.dailyRate)}
        {f.rateSource === "manual" && <span className="subtle">entered by hand</span>}
        {f.lowConfidence && <span className="subtle">low confidence</span>}
        {f.rateSource === "sales" && f.outOfStockDays > 0 && (
          <span className="subtle">{f.outOfStockDays} days out of stock left out</span>
        )}
        {f.seasonal && <span className="subtle">seasonal {f.seasonal.nowPct}%</span>}
      </td>
      <td className="num">
        {fmtInt(r.fba?.fulfillable)}
        {!!r.fba?.reserved && <span className="subtle" title="Held by Amazon; not counted as available">+{fmtInt(r.fba.reserved)} reserved</span>}
      </td>
      <td className="num">
        {r.fba ? fmtInt(r.fba.inbound + r.sentNotInReport) : "-"}
        {r.sentNotInReport > 0 && (
          <span className="subtle" title="Marked sent in this app; Amazon's next report will include it">
            incl. {fmtInt(r.sentNotInReport)} just sent
          </span>
        )}
      </td>
      <td className="num">
        {r.warehouseOnHand === null ? <span className="muted">not counted</span> : fmtInt(r.warehouseOnHand)}
      </td>
      <td className="num">{fmtDays(f.fbaCoverDays)}</td>
      <td className={f.shipBy ? `date-${f.shipStatus}` : undefined} data-testid="ship-by">
        {fmtDate(f.shipBy)}
        {f.shipCases !== null && (
          <span className="subtle">
            {f.warehouseShort && f.shipCasesAvailable !== null
              ? `${fmtInt(f.shipCasesAvailable)} of ${cases(f.shipCases)} in stock`
              : `${cases(f.shipCases)} (${fmtInt(f.shipUnits)} units)`}
          </span>
        )}
      </td>
      <td className="num">
        <span className={f.reorderAssumesEmptyWarehouse ? "provisional" : undefined}>{fmtDays(f.totalCoverDays)}</span>
      </td>
      <td
        className={f.reorderBy && !f.reorderAssumesEmptyWarehouse ? `date-${f.reorderStatus}` : undefined}
        data-testid="reorder-by"
      >
        <span className={f.reorderAssumesEmptyWarehouse ? "provisional" : undefined}>{fmtDate(f.reorderBy)}</span>
        {f.reorderCases !== null && (
          <span className="subtle">
            {cases(f.reorderCases)} ({fmtInt(f.reorderUnits)} units)
          </span>
        )}
      </td>
      <td className="notes">
        {f.notes.length > 0 && (
          <ul>
            {f.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}
