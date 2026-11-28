import Link from "next/link";
import { getDb } from "@/db";
import { spApiConfigFromEnv } from "@/lib/amazon/sp-api";
import { HISTORY_DAYS, latestHistoryRequest } from "@/lib/amazon/sync";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday } from "@/lib/dates";
import { ACCURACY, VERDICT_LABEL, type AccuracySummary } from "@/lib/forecast/accuracy";
import { loadAccuracy, recordDailyForecast } from "@/lib/forecast/check";
import { fmtDate, fmtInt } from "@/lib/forecast/format";
import { loadForecastBoard } from "@/lib/forecast/repo";
import { MONTH_NAMES, monthRate } from "@/lib/forecast/seasonal";
import { HistoryButton, SeasonForm, type SeasonRow } from "./forms";

export const metadata = { title: "Forecast check · RB Collections FBA Dashboard" };

function pct(share: number | null): string {
  return share === null ? "-" : `${Math.round(Math.abs(share) * 100)}%`;
}

function direction(s: AccuracySummary): string {
  if (s.biasShare === null) return "-";
  const p = Math.round(Math.abs(s.biasShare) * 100);
  if (p < 3) return "about right";
  return s.biasShare > 0 ? `${p}% too high` : `${p}% too low`;
}

const VERDICT_CLASS = { good: "green", fair: "yellow", poor: "red", too_few: "none", none: "none" } as const;

function Verdict({ s }: { s: AccuracySummary }) {
  return <span className={`status ${VERDICT_CLASS[s.verdict]}`}>{VERDICT_LABEL[s.verdict]}</span>;
}

function monthLabel(ym: string): string {
  return `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1].slice(0, 3)} ${ym.slice(0, 4)}`;
}

function fmtWhen(d: Date) {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });
}

export default async function ForecastCheckPage() {
  await requireAdmin();
  const db = getDb();
  const board = await loadForecastBoard(db, businessToday());
  await recordDailyForecast(db, board).catch(() => 0);
  const [report, lastHistory] = await Promise.all([loadAccuracy(db, board), latestHistoryRequest(db)]);
  const range = board.history.range;
  const keysSet = spApiConfigFromEnv() !== null;
  const seasons = [...board.history.seasons.values()].sort((a, b) => a.listingName.localeCompare(b.listingName));
  const anyAutoReady = seasons.some((s) => s.auto.ready);
  const fullMonths = range ? Math.floor(range.days / 30.44) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Forecast check</h1>
          <p className="muted">
            How well the forecast matches what really sold, and the seasonal pattern each listing is planned with.
          </p>
        </div>
      </div>

      <div className="card" data-testid="history-card">
        <h2 style={{ marginTop: 0 }}>Sales history in the app</h2>
        {range ? (
          <p>
            <strong data-testid="history-range">
              {fmtDate(range.first)} to {fmtDate(range.last)}
            </strong>{" "}
            ({fmtInt(range.days)} days, about {fullMonths} {fullMonths === 1 ? "month" : "months"}).
          </p>
        ) : (
          <p>No Amazon sales are loaded yet.</p>
        )}
        {!anyAutoReady && (
          <div className="alert warn">
            <p style={{ marginTop: 0 }}>
              <strong>What this means for the seasonal pattern:</strong> working out busy and slow months by itself needs
              sales for every calendar month, so at least 12 months of history. Until then:
            </p>
            <ul style={{ marginBottom: 0 }}>
              <li>Days a SKU was out of stock are already left out of the sales rate, so a stock-out no longer makes it look like a slow seller.</li>
              <li>You can type your own percentage for months you know are busy or slow (below). They are used straight away.</li>
              <li>Or load up to 18 months of past sales from Amazon, and the automatic pattern turns on by itself for every listing that sold in all 12 months.</li>
              <li>The forecast check below works with the history there is, and gets better each week.</li>
            </ul>
          </div>
        )}
        <h3>Load past sales</h3>
        <p className="small">
          Amazon keeps the Inventory Ledger for 18 months. This asks Amazon for the last {HISTORY_DAYS} days in one report
          (read only, the same report as the daily pull). Days already in the app are replaced with Amazon&apos;s figures,
          so nothing is counted twice.
        </p>
        <HistoryButton disabled={!keysSet} />
        {!keysSet && <p className="small muted">The Amazon keys are not set up, so use the upload below instead.</p>}
        {lastHistory && (
          <p className="small muted" data-testid="history-status">
            Last request {fmtWhen(lastHistory.requestedAt)}:{" "}
            {lastHistory.status === "requested"
              ? "Amazon is still preparing it."
              : lastHistory.status === "saved"
                ? "loaded."
                : lastHistory.status === "no_data"
                  ? "Amazon had no data."
                  : `did not work (${lastHistory.message ?? "no reason given"}).`}
          </p>
        )}
        <details className="small">
          <summary>Or download it from Seller Central yourself</summary>
          <ol>
            <li>In Seller Central open Reports, then Fulfillment, then Inventory Ledger.</li>
            <li>Choose Detailed view, set the date range to the last 18 months, and click Generate report.</li>
            <li>When it is ready, click Download.</li>
            <li>
              Upload the file on the <Link href="/amazon">Amazon reports</Link> page, the same as any other report.
            </li>
          </ol>
        </details>
      </div>

      <div className="card" data-testid="accuracy-card">
        <h2 style={{ marginTop: 0 }}>Forecast vs actual</h2>
        <p className="small">
          Each week (Monday to Sunday) the units the forecast expected at the start of the week are compared with what
          actually sold. Out-of-stock days are left out on both sides. Figures are the last {ACCURACY.summaryWeeks} full
          weeks. Up to {Math.round(ACCURACY.goodShare * 100)}% off is good, up to {Math.round(ACCURACY.fairShare * 100)}%
          is fair.
        </p>
        <div className="stat-row">
          <div className="stat">
            <div className="label">Forecast, units</div>
            <div className="value" data-testid="total-forecast">
              {fmtInt(report.total.forecast)}
            </div>
          </div>
          <div className="stat">
            <div className="label">Actually sold, units</div>
            <div className="value" data-testid="total-actual">
              {fmtInt(report.total.actual)}
            </div>
          </div>
          <div className="stat">
            {/* The look stacks these bottom to top: number first, then the labels. */}
            <div className="label small">Overall the forecast was {direction(report.total)}.</div>
            <div className="label">Off by, week by week</div>
            <div className="value" data-testid="total-error">
              {pct(report.total.errorShare)}
            </div>

          </div>
          <div className="stat">
            <div className="label">Rating</div>
            <div style={{ marginTop: 8 }}>
              <Verdict s={report.total} />
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table data-testid="accuracy-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Forecast</th>
                <th className="num">Sold</th>
                <th className="num">Off by</th>
                <th>Forecast was</th>
                <th>Rating</th>
              </tr>
            </thead>
            {report.byListing.map((l) => (
              <tbody key={l.listingId}>
                <tr className="listing-row">
                  <td colSpan={6}>
                    <strong>{l.listingName}</strong>{" "}
                    <span className="muted small">
                      {fmtInt(l.summary.forecast)} forecast, {fmtInt(l.summary.actual)} sold, off by {pct(l.summary.errorShare)}
                    </span>
                  </td>
                </tr>
                {report.skus
                  .filter((s) => s.sku.listingId === l.listingId)
                  .sort((a, b) => a.sku.amazonSku.localeCompare(b.sku.amazonSku))
                  .map((s) => (
                    <tr key={s.sku.id} data-testid="accuracy-row">
                      <td>
                        <Link href={`/overview/${s.sku.id}#accuracy`}>{s.sku.amazonSku}</Link>
                        <span className="subtle">{s.sku.inhouseSku}</span>
                      </td>
                      <td className="num">{s.summary.weeks ? fmtInt(s.summary.forecast) : "-"}</td>
                      <td className="num">{s.summary.weeks ? fmtInt(s.summary.actual) : "-"}</td>
                      <td className="num">{s.summary.weeks ? pct(s.summary.errorShare) : "-"}</td>
                      <td>{s.summary.weeks ? direction(s.summary) : "-"}</td>
                      <td>
                        <Verdict s={s.summary} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="small muted">
          The app saves its forecast every morning from now on. Weeks before that are worked out afterwards with the same
          rule (last 30 days of sales per in-stock day, with the seasonal pattern), so they do not include numbers you typed
          by hand. Open a SKU to see it week by week.
        </p>
      </div>

      <div className="card" data-testid="season-card">
        <h2 style={{ marginTop: 0 }}>Seasonal pattern</h2>
        <p className="small">
          100% is a normal month. 150% means the month sells half as much again; 70% means 30% less. The last 30 days of
          sales are first turned into a normal-month rate, then every future day is planned at its own month&apos;s
          percentage, so ship and reorder dates move earlier ahead of a busy season and quantities grow to match. A number
          you type for a month always wins over the automatic one.
        </p>
        <p className="small">
          <strong>Expected daily sales typed on a SKU still win.</strong> If you typed a number for a SKU on its Overview
          page, that SKU is planned at exactly your number and the seasonal pattern is not added on top. Clear it there to
          let the pattern work.
        </p>
        <p className="small muted">Click a listing to see or change its months.</p>
        {seasons.map((s) => {
          const rows: SeasonRow[] = Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            auto: s.auto.ready ? s.auto.pct[i] : null,
            typed: s.setting.typed.get(i + 1) ?? null,
            used: s.monthPct ? s.monthPct[i] : 100,
          }));
          const covered = s.auto.ready ? [] : s.auto.coveredMonths;
          const usable = s.months.filter((m) => monthRate(m) !== null);
          return (
            <details
              key={s.listingId}
              className="season-block"
              data-testid="season-listing"
              open={s.setting.typed.size > 0 || s.auto.ready || !s.setting.enabled}
            >
              <summary>
                <strong>{s.listingName}</strong>{" "}
                <span className="muted small">
                  {!s.setting.enabled
                    ? "switched off"
                    : s.monthPct
                      ? s.monthPct
                          .map((p, i) => (p === 100 ? null : `${MONTH_NAMES[i].slice(0, 3)} ${p}%`))
                          .filter(Boolean)
                          .join(", ")
                      : "every month 100% (no pattern yet)"}
                </span>
              </summary>
              <p className="small">
                {s.auto.ready ? (
                  <>Automatic pattern worked out from {s.auto.usableMonths} months of sales history.</>
                ) : (
                  <>
                    Automatic pattern not ready yet: sales history covers {covered.length} of 12 calendar months
                    {covered.length > 0 && ` (${covered.map((m) => MONTH_NAMES[m - 1].slice(0, 3)).join(", ")})`}.
                    {usable.length > 0 &&
                      ` Months with enough data: ${usable.map((m) => monthLabel(m.month)).join(", ")}.`}{" "}
                    Months with no number of yours are planned at 100%.
                  </>
                )}
              </p>
              <SeasonForm listingId={s.listingId} enabled={s.setting.enabled} rows={rows} />
            </details>
          );
        })}
      </div>
    </>
  );
}
