"use client";

import { useActionState, useState } from "react";
import { receiveAction, type ReceiveState } from "./actions";

export type ReceiveLine = {
  skuId: number;
  inhouseSku: string;
  amazonSku: string;
  description: string | null;
  unitsPerCase: number;
  casesOrdered: number;
  casesReceived: number;
  casesToCome: number;
  /** Latest warehouse count in units, or null if never counted. */
  lastCount: number | null;
};

const n = (v: number) => v.toLocaleString("en-US");
const whole = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : t.trim() === "" ? 0 : NaN);

function Row({ l, error }: { l: ReceiveLine; error?: string }) {
  const [arrived, setArrived] = useState("");
  const [cases, setCases] = useState("");
  const [loose, setLoose] = useState("");
  const [shelfTouched, setShelfTouched] = useState(false);

  // Until someone types a shelf count, fill it in with the last count plus what arrived.
  const fillShelf = (arrivedText: string) => {
    if (shelfTouched || l.lastCount === null || !/^\d+$/.test(arrivedText.trim())) return;
    const expected = l.lastCount + Number(arrivedText.trim()) * l.unitsPerCase;
    setCases(String(Math.floor(expected / l.unitsPerCase)));
    setLoose(expected % l.unitsPerCase ? String(expected % l.unitsPerCase) : "");
  };
  const arrivedNum = /^\d+$/.test(arrived.trim()) ? Number(arrived.trim()) : null;
  const filled = cases.trim() !== "" || loose.trim() !== "";
  const total = whole(cases) * l.unitsPerCase + whole(loose);
  const expected = l.lastCount !== null && arrivedNum !== null ? l.lastCount + arrivedNum * l.unitsPerCase : null;
  const differs = filled && expected !== null && !Number.isNaN(total) && total !== expected;

  return (
    <tr data-testid="receive-row" className={error ? "row-error" : undefined}>
      <td className="wrap" style={{ minWidth: 160 }}>
        <div className="inhouse-sm">{l.inhouseSku}</div>
        <span className="subtle">
          Amazon SKU: {l.amazonSku}
          {l.description ? ` · ${l.description}` : ""}
        </span>
        <span className="subtle">{n(l.unitsPerCase)} units per case</span>
      </td>
      <td className="num">
        <strong>{n(l.casesToCome)}</strong>
        {l.casesReceived > 0 && <span className="subtle">of {n(l.casesOrdered)} ordered</span>}
      </td>
      <td>
        <input
          className="count-input"
          name={`arrived-${l.skuId}`}
          inputMode="numeric"
          aria-label={`Full cases of ${l.inhouseSku} that arrived`}
          value={arrived}
          onChange={(e) => {
            setArrived(e.target.value);
            fillShelf(e.target.value);
          }}
        />
        {arrivedNum !== null && arrivedNum !== l.casesToCome && (
          <span className="subtle warn-text">
            {arrivedNum < l.casesToCome
              ? `${n(l.casesToCome - arrivedNum)} fewer than expected. That is fine if it is what came.`
              : `${n(arrivedNum - l.casesToCome)} more than expected. Check the count.`}
          </span>
        )}
      </td>
      <td>
        <input
          className="count-input"
          name={`cases-${l.skuId}`}
          inputMode="numeric"
          aria-label={`Full cases of ${l.inhouseSku} on the shelf now`}
          value={cases}
          onChange={(e) => {
            setShelfTouched(true);
            setCases(e.target.value);
          }}
        />
      </td>
      <td>
        <input
          className="count-input"
          name={`loose-${l.skuId}`}
          inputMode="numeric"
          aria-label={`Loose units of ${l.inhouseSku} on the shelf now`}
          value={loose}
          onChange={(e) => {
            setShelfTouched(true);
            setLoose(e.target.value);
          }}
        />
      </td>
      <td className="num" data-testid="receive-total">
        {!filled ? <span className="muted">-</span> : Number.isNaN(total) ? <span className="error-text">?</span> : <strong>{n(total)}</strong>}
        {l.lastCount === null && <span className="subtle">Not counted before. Count the whole shelf.</span>}
        {differs && <span className="subtle warn-text">Not the last count plus what arrived. That is fine if it is what you counted.</span>}
        {error && <span className="error-text subtle-error">{error}</span>}
      </td>
    </tr>
  );
}

export function ReceiveForm({ orderId, lines }: { orderId: number; lines: ReceiveLine[] }) {
  const [state, action, pending] = useActionState<ReceiveState, FormData>(receiveAction.bind(null, orderId), null);
  const errors = new Map((state?.issues ?? []).map((i) => [i.skuId, i.message]));
  return (
    <form action={action}>
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
              <th className="num">Expected</th>
              <th>Cases arrived</th>
              <th>Shelf: full cases</th>
              <th>Shelf: loose units</th>
              <th className="num">Shelf total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <Row key={l.skuId} l={l} error={errors.get(l.skuId)} />
            ))}
          </tbody>
        </table>
      </div>
      <button className="primary big" type="submit" disabled={pending} data-testid="confirm-received">
        {pending ? "Saving..." : "Delivery is put away: save counts"}
      </button>
    </form>
  );
}
