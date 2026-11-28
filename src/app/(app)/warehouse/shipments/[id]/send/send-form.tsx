"use client";

import { useActionState, useState } from "react";
import { markSentAction, type SendState } from "../../actions";

export type SendLine = {
  skuId: number;
  inhouseSku: string;
  amazonSku: string;
  unitsPerCase: number;
  casesSent: number;
  lastCount: number | null;
  expectedLeft: number | null;
  expectedCases: number | null;
  expectedLoose: number | null;
};

const n = (v: number) => v.toLocaleString("en-US");

function Row({ l, error }: { l: SendLine; error?: string }) {
  const [cases, setCases] = useState(l.expectedCases === null ? "" : String(l.expectedCases));
  const [loose, setLoose] = useState(l.expectedLoose ? String(l.expectedLoose) : "");
  const whole = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : t.trim() === "" ? 0 : NaN);
  const filled = cases.trim() !== "" || loose.trim() !== "";
  const total = whole(cases) * l.unitsPerCase + whole(loose);
  const differs = filled && l.expectedLeft !== null && !Number.isNaN(total) && total !== l.expectedLeft;
  return (
    <tr data-testid="send-row" className={error ? "row-error" : undefined}>
      <td>
        <div className="inhouse-sm">{l.inhouseSku}</div>
        <span className="subtle">Amazon SKU: {l.amazonSku}</span>
      </td>
      <td className="num">{n(l.casesSent)}</td>
      <td className="num">
        {l.expectedLeft === null ? <span className="muted">not counted before</span> : n(l.expectedLeft)}
      </td>
      <td>
        <input
          className="count-input"
          name={`cases-${l.skuId}`}
          inputMode="numeric"
          aria-label={`Full cases of ${l.inhouseSku} left`}
          value={cases}
          onChange={(e) => setCases(e.target.value)}
        />
      </td>
      <td>
        <input
          className="count-input"
          name={`loose-${l.skuId}`}
          inputMode="numeric"
          aria-label={`Loose units of ${l.inhouseSku} left`}
          value={loose}
          onChange={(e) => setLoose(e.target.value)}
        />
      </td>
      <td className="num" data-testid="send-total">
        {!filled ? <span className="muted">-</span> : Number.isNaN(total) ? <span className="error-text">?</span> : <strong>{n(total)}</strong>}
        {differs && <span className="subtle warn-text">Different from expected. That is fine if it is what you counted.</span>}
        {error && <span className="error-text subtle-error">{error}</span>}
      </td>
    </tr>
  );
}

export function SendForm({ shipmentId, lines }: { shipmentId: number; lines: SendLine[] }) {
  const [state, action, pending] = useActionState<SendState, FormData>(markSentAction.bind(null, shipmentId), null);
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
              <th className="num">Cases sent</th>
              <th className="num">Expected left (units)</th>
              <th>Full cases left</th>
              <th>Loose units left</th>
              <th className="num">Count left (units)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <Row key={l.skuId} l={l} error={errors.get(l.skuId)} />
            ))}
          </tbody>
        </table>
      </div>
      <button className="primary big" type="submit" disabled={pending} data-testid="confirm-sent">
        {pending ? "Saving..." : "Shipment has left: save counts"}
      </button>
    </form>
  );
}
