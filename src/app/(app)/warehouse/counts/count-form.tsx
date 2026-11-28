"use client";

import { useActionState, useState } from "react";
import { saveCountsAction, type CountState } from "./actions";

export type CountSku = {
  id: number;
  inhouseSku: string;
  amazonSku: string;
  description: string | null;
  unitsPerCase: number;
  current: number | null;
  countedOn: string | null;
};

export type CountGroup = { listing: string; skus: CountSku[] };

function CountRow({ s, error, resetKey }: { s: CountSku; error?: string; resetKey: number }) {
  const [cases, setCases] = useState("");
  const [loose, setLoose] = useState("");
  const [lastReset, setLastReset] = useState(resetKey);
  if (lastReset !== resetKey) {
    setLastReset(resetKey);
    setCases("");
    setLoose("");
  }
  const whole = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : t.trim() === "" ? 0 : NaN);
  const filled = cases.trim() !== "" || loose.trim() !== "";
  const total = whole(cases) * s.unitsPerCase + whole(loose);
  return (
    <tr data-testid="count-row" className={error ? "row-error" : undefined}>
      <td>
        <div className="inhouse-sm">{s.inhouseSku}</div>
        <span className="subtle">{s.description ?? s.amazonSku}</span>
      </td>
      <td className="num">{s.unitsPerCase}</td>
      <td className="num">
        {s.current === null ? <span className="muted">-</span> : s.current.toLocaleString("en-US")}
        {s.countedOn && <span className="subtle">{s.countedOn}</span>}
      </td>
      <td>
        <input
          className="count-input"
          name={`cases-${s.id}`}
          inputMode="numeric"
          aria-label={`Full cases of ${s.inhouseSku}`}
          value={cases}
          onChange={(e) => setCases(e.target.value)}
        />
      </td>
      <td>
        <input
          className="count-input"
          name={`loose-${s.id}`}
          inputMode="numeric"
          aria-label={`Loose units of ${s.inhouseSku}`}
          value={loose}
          onChange={(e) => setLoose(e.target.value)}
        />
      </td>
      <td className="num" data-testid="count-total">
        {!filled ? <span className="muted">-</span> : Number.isNaN(total) ? <span className="error-text">?</span> : <strong>{total.toLocaleString("en-US")}</strong>}
        {error && <span className="error-text subtle-error">{error}</span>}
      </td>
    </tr>
  );
}

export function CountForm({ groups }: { groups: CountGroup[] }) {
  const [state, action, pending] = useActionState<CountState, FormData>(saveCountsAction, null);
  const errors = new Map((state?.issues ?? []).map((i) => [i.skuId, i.message]));
  const resetKey = state?.at ?? 0;
  return (
    <form action={action}>
      {state?.saved !== undefined && (
        <div className="alert ok" role="status">
          Saved {state.saved} {state.saved === 1 ? "count" : "counts"}. Thank you.
        </div>
      )}
      {state?.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="count-table">
          <thead>
            <tr>
              <th>In-house SKU</th>
              <th className="num">Units per case</th>
              <th className="num">Last count</th>
              <th>Full cases</th>
              <th>Loose units</th>
              <th className="num">New count (units)</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Group key={g.listing} g={g} errors={errors} resetKey={resetKey} />
            ))}
          </tbody>
        </table>
      </div>
      <button className="primary big" type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save counts"}
      </button>
    </form>
  );
}

function Group({ g, errors, resetKey }: { g: CountGroup; errors: Map<number, string>; resetKey: number }) {
  return (
    <>
      <tr className="listing-row">
        <td colSpan={6}>{g.listing}</td>
      </tr>
      {g.skus.map((s) => (
        <CountRow key={s.id} s={s} error={errors.get(s.id)} resetKey={resetKey} />
      ))}
    </>
  );
}
