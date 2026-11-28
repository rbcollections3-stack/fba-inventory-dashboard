import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday } from "@/lib/dates";
import { fmtDate, fmtDays, fmtInt, fmtRate, STATUS_LABEL } from "@/lib/forecast/format";
import { dayInBusinessZone, loadForecastBoard } from "@/lib/forecast/repo";
import { daysBetween, reorderPointDays, RULES, shipPointDays } from "@/lib/forecast/rules";
import { ManualRateForm } from "./manual-rate-form";

export const metadata = { title: "SKU forecast · RB Collections FBA Dashboard" };

export default async function SkuForecastPage({ params }: PageProps<"/overview/[id]">) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const board = await loadForecastBoard(getDb(), businessToday());
  const r = board.rows.find((x) => x.id === id);
  if (!r) notFound();
  const f = r.forecast;
  const stockDay = r.fba ? dayInBusinessZone(r.fba.asOf) : null;
  const shipPoint = shipPointDays();
  const reorderPoint = reorderPointDays();
  const rate = f.dailyRate;
  const days = board.sales?.days ?? 0;

  const steps: [string, string, string][] = [];
  if (rate !== null) {
    steps.push([
      "Sales per day",
      f.rateSource === "manual"
        ? "Expected daily sales you entered"
        : `${fmtInt(r.unitsSold)} units sold in ${days} days / ${days}`,
      `${fmtRate(rate)} a day`,
    ]);
  }
  if (rate !== null && r.fba && stockDay && f.fbaCoverDays !== null && f.totalCoverDays !== null) {
    steps.push(
      [
        "FBA cover",
        `(${fmtInt(r.fba.fulfillable)} available + ${fmtInt(r.fba.inbound)} on the way) / ${fmtRate(rate)}`,
        `${fmtDays(f.fbaCoverDays)} days`,
      ],
      [
        "Ship-by date",
        `${fmtDate(stockDay)} + (${fmtDays(f.fbaCoverDays)} minus ${shipPoint}) days`,
        fmtDate(f.shipBy),
      ],
      [
        "Ship quantity",
        `${RULES.shipmentCoverDays} x ${fmtRate(rate)} = ${fmtInt(Math.round(RULES.shipmentCoverDays * rate))} units, / ${r.unitsPerCase} per case, rounded up`,
        `${fmtInt(f.shipCases)} ${f.shipCases === 1 ? "case" : "cases"} (${fmtInt(f.shipUnits)} units)`,
      ],
      [
        "Total cover",
        `(${fmtInt(r.fba.fulfillable)} + ${fmtInt(r.fba.inbound)} + ${
          r.warehouseOnHand === null ? "0 warehouse, not counted" : `${fmtInt(r.warehouseOnHand)} warehouse`
        } + 0 on order) / ${fmtRate(rate)}`,
        `${fmtDays(f.totalCoverDays)} days`,
      ],
      [
        "Reorder-by date",
        `${fmtDate(stockDay)} + (${fmtDays(f.totalCoverDays)} minus ${reorderPoint}) days`,
        fmtDate(f.reorderBy),
      ],
      [
        "Reorder quantity",
        `${RULES.chinaOrderCoverDays} x ${fmtRate(rate)} = ${fmtInt(Math.round(RULES.chinaOrderCoverDays * rate))} units, / ${r.unitsPerCase} per case, rounded up`,
        `${fmtInt(f.reorderCases)} ${f.reorderCases === 1 ? "case" : "cases"} (${fmtInt(f.reorderUnits)} units)`,
      ],
    );
  }

  return (
    <>
      <p className="small">
        <Link href="/overview">Back to Overview</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>
            {r.amazonSku} <span className={`status ${f.status}`}>{STATUS_LABEL[f.status]}</span>
          </h1>
          <p className="muted">
            In-house SKU {r.inhouseSku} · {r.listingName} · {r.unitsPerCase} units per case
          </p>
        </div>
        <div className="actions">
          <Link className="button" href={`/skus/${r.id}`}>
            Edit SKU details
          </Link>
        </div>
      </div>

      {f.notes.length > 0 && (
        <div className={`alert ${f.status === "red" ? "error" : f.status === "green" ? "ok" : "warn"}`}>
          <ul style={{ margin: 0 }}>
            {f.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>How the dates are worked out</h2>
        {steps.length === 0 ? (
          <p className="muted">There is nothing to plan from yet. See the note above.</p>
        ) : (
          <div className="table-wrap">
            <table className="calc" data-testid="calc-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Calculation</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {steps.map(([step, calc, result]) => (
                  <tr key={step}>
                    <td>{step}</td>
                    <td>{calc}</td>
                    <td className="result">{result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">
          Days of cover are rounded down, so a date is never later than the rule allows. Dates count from{" "}
          {stockDay ? fmtDate(stockDay) : "the day of the latest FBA stock"}, the day the FBA stock figures are from.
          {stockDay && daysBetween(stockDay, board.today) > 0 &&
            ` That was ${daysBetween(stockDay, board.today)} day(s) ago.`}{" "}
          Ship when FBA cover reaches {shipPoint} days ({RULES.fbaFloorDays} days minimum in FBA +{" "}
          {RULES.warehouseToFbaDays} days to get there). Reorder when total cover reaches {reorderPoint} days ({shipPoint} +{" "}
          {RULES.chinaLeadDays} days from China + {RULES.chinaBufferDays} days safety buffer). Units Amazon has reserved (
          {fmtInt(r.fba?.reserved)}) are not counted as available.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Expected daily sales (optional)</h2>
        <p>
          Real Amazon sales: <strong>{f.measuredRate === null ? "none" : `${fmtRate(f.measuredRate)} a day`}</strong>
          {board.sales && (
            <span className="muted">
              {" "}
              ({fmtInt(r.unitsSold)} units, {fmtDate(board.sales.start)} to {fmtDate(board.sales.end)})
            </span>
          )}
          .
        </p>
        <p className="muted small">
          Use this for a SKU that was out of stock and has no recent sales, or to plan lower after a busy period such as
          Black Friday. Clear it once real sales are back to normal.
        </p>
        {r.manualDailySales !== null && f.measuredRate !== null && (
          <p className="alert warn small" data-testid="manual-hint">
            You entered {fmtRate(r.manualDailySales)} a day. Real sales are now {fmtRate(f.measuredRate)} a day. Clear
            your number when you are happy to plan from real sales.
          </p>
        )}
        <ManualRateForm skuId={r.id} current={r.manualDailySales} note={r.manualNote} />
      </div>
    </>
  );
}
