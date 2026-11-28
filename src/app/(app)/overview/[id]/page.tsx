import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday } from "@/lib/dates";
import { fmtDate, fmtDays, fmtInt, fmtRate, STATUS_LABEL } from "@/lib/forecast/format";
import { dayInBusinessZone, loadForecastBoard } from "@/lib/forecast/repo";
import { daysBetween, reorderPointDays, RULES, shipPointDays } from "@/lib/forecast/rules";
import { VERDICT_LABEL } from "@/lib/forecast/accuracy";
import { loadAccuracy } from "@/lib/forecast/check";
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
  const accuracy = (await loadAccuracy(getDb(), board)).skus.find((s) => s.sku.id === r.id);
  const weeks = accuracy?.weeks.slice(-8) ?? [];
  const maxWeek = Math.max(1, ...weeks.map((w) => Math.max(w.forecast, w.actual)));
  const seasonal = f.seasonal;
  const coverHow = seasonal ? "used up day by day at each month's planned rate" : `/ ${fmtRate(rate)}`;

  const steps: [string, string, string][] = [];
  if (rate !== null) {
    steps.push([
      "Sales per day",
      f.rateSource === "manual"
        ? "Expected daily sales you entered"
        : f.outOfStockDays > 0
          ? `${fmtInt(r.unitsSold)} units sold / ${f.inStockDays} days in stock (${f.outOfStockDays} of the last ${days} days out of stock, left out)`
          : `${fmtInt(r.unitsSold)} units sold in ${days} days / ${days}`,
      `${fmtRate(f.measuredRate ?? rate)} a day`,
    ]);
    if (seasonal) {
      steps.push([
        "Seasonal pattern",
        `The last ${days} days ran at ${seasonal.windowPct}% of a normal month, so a normal month sells ${fmtRate(seasonal.baseRate)} a day. This month is planned at ${seasonal.nowPct}%; later months at their own percentage.`,
        `${fmtRate(rate)} a day now`,
      ]);
    }
  }
  const onTheWay = r.fba
    ? r.sentNotInReport > 0
      ? `${fmtInt(r.fba.inbound + r.sentNotInReport)} on the way (${fmtInt(r.fba.inbound)} in Amazon's report + ${fmtInt(r.sentNotInReport)} sent since)`
      : `${fmtInt(r.fba.inbound)} on the way`
    : "";
  if (rate !== null && r.fba && stockDay && f.fbaCoverDays !== null && f.totalCoverDays !== null) {
    steps.push(
      [
        "FBA cover",
        `(${fmtInt(r.fba.fulfillable)} available + ${onTheWay}) ${coverHow}`,
        `${fmtDays(f.fbaCoverDays)} days`,
      ],
      [
        "Ship-by date",
        `${fmtDate(stockDay)} + (${fmtDays(f.fbaCoverDays)} minus ${shipPoint}) days`,
        fmtDate(f.shipBy),
      ],
      [
        "Ship quantity",
        seasonal
          ? `Sales planned for the ${RULES.shipmentCoverDays} days after it arrives = ${fmtInt(Math.round(f.shipDemandUnits ?? 0))} units, / ${r.unitsPerCase} per case, rounded up`
          : `${RULES.shipmentCoverDays} x ${fmtRate(rate)} = ${fmtInt(Math.round(RULES.shipmentCoverDays * rate))} units, / ${r.unitsPerCase} per case, rounded up`,
        `${fmtInt(f.shipCases)} ${f.shipCases === 1 ? "case" : "cases"} (${fmtInt(f.shipUnits)} units)`,
      ],
      [
        "Total cover",
        `(${fmtInt(r.fba.fulfillable)} + ${fmtInt(r.fba.inbound + r.sentNotInReport)} + ${
          r.warehouseOnHand === null ? "0 warehouse, not counted" : `${fmtInt(r.warehouseOnHand)} warehouse`
        } + 0 on order) ${coverHow}`,
        `${fmtDays(f.totalCoverDays)} days`,
      ],
      [
        "Reorder-by date",
        `${fmtDate(stockDay)} + (${fmtDays(f.totalCoverDays)} minus ${reorderPoint}) days`,
        fmtDate(f.reorderBy),
      ],
      [
        "Reorder quantity",
        seasonal
          ? `Sales planned for the ${RULES.chinaOrderCoverDays} days after it lands = ${fmtInt(Math.round(f.reorderDemandUnits ?? 0))} units, / ${r.unitsPerCase} per case, rounded up`
          : `${RULES.chinaOrderCoverDays} x ${fmtRate(rate)} = ${fmtInt(Math.round(RULES.chinaOrderCoverDays * rate))} units, / ${r.unitsPerCase} per case, rounded up`,
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

      <div className="card" id="accuracy" data-testid="sku-accuracy">
        <h2 style={{ marginTop: 0 }}>Forecast vs actual, week by week</h2>
        {weeks.length === 0 ? (
          <p className="muted">
            Not enough sales history yet. A week can be checked once there are at least two weeks of sales before it.
          </p>
        ) : (
          <>
            <p className="small">
              Last {accuracy!.summary.weeks} weeks: forecast {fmtInt(accuracy!.summary.forecast)}, sold{" "}
              {fmtInt(accuracy!.summary.actual)}.{" "}
              <strong>{VERDICT_LABEL[accuracy!.summary.verdict]}</strong>
              {accuracy!.summary.errorShare !== null &&
                ` (off by ${Math.round(accuracy!.summary.errorShare * 100)}% week by week).`}{" "}
              <Link href="/forecast-check">All SKUs</Link>
            </p>
            <div className="table-wrap">
              <table data-testid="weeks-table">
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th className="num">Forecast</th>
                    <th className="num">Sold</th>
                    <th className="num">Days in stock</th>
                    <th aria-label="Chart"></th>
                    <th>Forecast from</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weeks].reverse().map((w) => (
                    <tr key={w.weekStart}>
                      <td>{fmtDate(w.weekStart)}</td>
                      <td className="num">{fmtRate(w.forecast)}</td>
                      <td className="num">{fmtInt(w.actual)}</td>
                      <td className="num">{w.inStockDays} of 7</td>
                      <td style={{ minWidth: 140 }}>
                        <span className="week-bar forecast" style={{ width: `${(w.forecast / maxWeek) * 120}px` }} title="Forecast" />
                        <br />
                        <span className="week-bar actual" style={{ width: `${(w.actual / maxWeek) * 120}px` }} title="Sold" />
                      </td>
                      <td className="small">{w.source === "recorded" ? "Saved that Monday" : "Worked out from history"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">Grey bar = forecast, blue bar = sold.</p>
          </>
        )}
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
          Black Friday. Clear it once real sales are back to normal. While it is filled in, the SKU is planned at exactly
          this number: out-of-stock days and the <Link href="/forecast-check">seasonal pattern</Link> are not applied on
          top.
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
