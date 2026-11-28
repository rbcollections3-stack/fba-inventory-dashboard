"use client";

import { useActionState } from "react";
import { MONTH_NAMES } from "@/lib/forecast/seasonal";
import { loadHistoryAction, saveSeasonAction, type HistoryState, type SeasonState } from "./actions";

export function HistoryButton({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<HistoryState, FormData>(loadHistoryAction, null);
  return (
    <form action={action}>
      <button className="primary" type="submit" disabled={disabled || pending} data-testid="load-history">
        {pending ? "Asking Amazon... (up to a minute)" : "Load 18 months of past sales from Amazon"}
      </button>
      {state && (
        <div className={`alert ${state.ok ? "ok" : "error"}`} role="status" style={{ marginTop: 12 }} data-testid="history-result">
          {state.message}
        </div>
      )}
    </form>
  );
}

export type SeasonRow = {
  month: number;
  auto: number | null;
  typed: number | null;
  used: number;
};

export function SeasonForm({
  listingId,
  enabled,
  rows,
}: {
  listingId: number;
  enabled: boolean;
  rows: SeasonRow[];
}) {
  const [state, action, pending] = useActionState<SeasonState, FormData>(saveSeasonAction.bind(null, listingId), null);
  return (
    <form action={action} data-testid={`season-form-${listingId}`}>
      {state?.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      {state?.saved && <div className="alert ok">Saved. The Overview dates now use this pattern.</div>}
      <label className="big-check" style={{ marginBottom: 12 }}>
        <input type="checkbox" name="enabled" defaultChecked={enabled} key={`en-${enabled}`} /> Use a seasonal pattern for this
        listing
      </label>
      <div className="table-wrap">
        <table className="season-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Automatic</th>
              <th>Your number (optional)</th>
              <th className="num">Used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td>{MONTH_NAMES[r.month - 1]}</td>
                <td className="num">{r.auto === null ? <span className="muted">-</span> : `${r.auto}%`}</td>
                <td>
                  <input
                    name={`m${r.month}`}
                    type="text"
                    inputMode="numeric"
                    className="pct-input"
                    defaultValue={r.typed ?? ""}
                    placeholder={r.auto === null ? "100" : String(r.auto)}
                    key={`m${r.month}-${r.typed}`}
                    aria-label={`${MONTH_NAMES[r.month - 1]} percentage`}
                  />
                  %
                </td>
                <td className={`num ${r.used > 100 ? "pct-up" : r.used < 100 ? "pct-down" : ""}`}>{enabled ? `${r.used}%` : "off"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button type="submit" className="primary" disabled={pending}>
          Save pattern
        </button>
        <button type="submit" name="clear" value="1" disabled={pending}>
          Clear my numbers
        </button>
      </div>
    </form>
  );
}
