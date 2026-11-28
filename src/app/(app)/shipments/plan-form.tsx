"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Status } from "@/lib/forecast/rules";
import { splitIntoPallets } from "@/lib/shipments/pallets";
import { createShipmentAction, type PlanState } from "./actions";

export type PlanRow = {
  id: number;
  inhouseSku: string;
  amazonSku: string;
  listingName: string;
  shipStatus: Status;
  shipBy: string | null;
  /** 45 days of sales in full cases, from the forecast. */
  suggestedCases: number | null;
  warehouseOnHand: number | null;
  unitsPerCase: number;
  tie: number;
  high: number;
  maxCasesPerPallet: number;
  /** A shipment already requested for this SKU and not yet sent. */
  openShipmentId: number | null;
  defaultCases: number | null;
  defaultIncluded: boolean;
};

const STATUS_TEXT: Record<Status, string> = { red: "Ship now", yellow: "Ship soon", green: "Not due", none: "No date" };

function fmtDay(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const n = (v: number) => v.toLocaleString("en-US");

function Row({ r, error }: { r: PlanRow; error?: string }) {
  const [included, setIncluded] = useState(r.defaultIncluded);
  const [cases, setCases] = useState(r.defaultCases === null ? "" : String(r.defaultCases));
  const value = /^\d+$/.test(cases.trim()) ? Number(cases.trim()) : null;
  const pallets = value ? splitIntoPallets(value, r) : [];
  const fullOnShelf = r.warehouseOnHand === null ? null : Math.floor(r.warehouseOnHand / r.unitsPerCase);
  const overShelf = included && value !== null && fullOnShelf !== null && value > fullOnShelf;

  return (
    <tr data-testid="plan-row" className={error ? "row-error" : included ? "row-picked" : undefined}>
      <td>
        <input
          type="checkbox"
          className="big-check"
          name={`include-${r.id}`}
          aria-label={`Include ${r.inhouseSku}`}
          checked={included}
          onChange={(e) => setIncluded(e.target.checked)}
        />
      </td>
      <td>
        <div className="inhouse-sm">{r.inhouseSku}</div>
        <span className="subtle">
          {r.amazonSku} · {r.listingName}
        </span>
      </td>
      <td>
        <span className={`status ${r.shipStatus}`}>{STATUS_TEXT[r.shipStatus]}</span>
        <span className="subtle">{r.shipBy ? `by ${fmtDay(r.shipBy)}` : ""}</span>
      </td>
      <td className="num">{r.suggestedCases === null ? "-" : n(r.suggestedCases)}</td>
      <td className="num">
        {fullOnShelf === null ? <span className="muted">not counted</span> : n(fullOnShelf)}
      </td>
      <td>
        <input
          className="count-input"
          name={`cases-${r.id}`}
          inputMode="numeric"
          aria-label={`Cases of ${r.inhouseSku}`}
          value={cases}
          onChange={(e) => {
            setCases(e.target.value);
            if (e.target.value.trim() !== "") setIncluded(true);
          }}
        />
      </td>
      <td className="num" data-testid="plan-pallets">
        {included && value ? (
          <>
            <strong>{pallets.length}</strong>
            <span className="subtle">{pallets.join(" + ")} cases</span>
          </>
        ) : (
          <span className="muted">-</span>
        )}
      </td>
      <td className="num">{included && value ? n(value * r.unitsPerCase) : <span className="muted">-</span>}</td>
      <td className="notes">
        {r.openShipmentId !== null && (
          <span className="subtle">
            Already in <Link href={`/warehouse/shipments/${r.openShipmentId}`}>shipment #{r.openShipmentId}</Link>, not
            sent yet.
          </span>
        )}
        {overShelf && <span className="subtle warn-text">More than the {n(fullOnShelf!)} full cases last counted.</span>}
        {included && r.warehouseOnHand === null && <span className="subtle">Warehouse not counted. Check the shelf.</span>}
        {error && <span className="error-text subtle-error">{error}</span>}
      </td>
    </tr>
  );
}

export function PlanForm({ rows }: { rows: PlanRow[] }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(createShipmentAction, null);
  const errors = new Map((state?.issues ?? []).map((i) => [i.skuId, i.message]));
  return (
    <form action={action}>
      {state?.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="plan-table">
          <thead>
            <tr>
              <th>Send</th>
              <th>SKU</th>
              <th>Due</th>
              <th className="num">Suggested cases</th>
              <th className="num">Full cases on shelf</th>
              <th>Cases to send</th>
              <th className="num">Pallets</th>
              <th className="num">Units</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.id} r={r} error={errors.get(r.id)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="field" style={{ maxWidth: 520, marginBottom: 12 }}>
        <label htmlFor="note">Note for the warehouse (optional)</label>
        <input id="note" name="note" type="text" maxLength={500} placeholder="For example: pickup Tuesday 10 AM" />
      </div>
      <button className="primary big" type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create shipment and pallet sheets"}
      </button>
    </form>
  );
}
