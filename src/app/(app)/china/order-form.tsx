"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Status } from "@/lib/forecast/rules";
import { createChinaOrderAction, type OrderState } from "./actions";

export type OrderRow = {
  id: number;
  inhouseSku: string;
  amazonSku: string;
  listingName: string;
  reorderStatus: Status;
  reorderBy: string | null;
  /** The reorder-by date treats the warehouse as empty (not counted). */
  provisional: boolean;
  /** 120 days of sales in full cases, from the forecast. */
  suggestedCases: number | null;
  unitsPerCase: number;
  totalCoverDays: number | null;
  /** Units already ordered and not yet received. */
  onOrderUnits: number;
  /** Open orders for this SKU, to link to. */
  openOrderIds: number[];
  /** Plain-language warning, for example stock runs out before a new order could arrive. */
  warning: string | null;
  defaultIncluded: boolean;
};

const STATUS_TEXT: Record<Status, string> = { red: "Order now", yellow: "Order soon", green: "Not due", none: "No date" };

function fmtDay(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const n = (v: number) => v.toLocaleString("en-US");

function Row({
  r,
  error,
  included,
  cases,
  onIncluded,
  onCases,
}: {
  r: OrderRow;
  error?: string;
  included: boolean;
  cases: string;
  onIncluded: (v: boolean) => void;
  onCases: (v: string) => void;
}) {
  const value = /^\d+$/.test(cases.trim()) ? Number(cases.trim()) : null;
  return (
    <tr data-testid="order-row" className={error ? "row-error" : included ? "row-picked" : undefined}>
      <td>
        <input
          type="checkbox"
          className="big-check"
          name={`include-${r.id}`}
          aria-label={`Order ${r.inhouseSku}`}
          checked={included}
          onChange={(e) => onIncluded(e.target.checked)}
        />
      </td>
      <td>
        <div className="inhouse-sm">{r.inhouseSku}</div>
        <span className="subtle">
          {r.amazonSku} · {r.listingName}
        </span>
      </td>
      <td>
        <span className={`status ${r.provisional ? "none" : r.reorderStatus}`}>
          {r.provisional ? "Count first" : STATUS_TEXT[r.reorderStatus]}
        </span>
        <span className={`subtle${r.provisional ? " provisional" : ""}`}>{r.reorderBy ? `by ${fmtDay(r.reorderBy)}` : ""}</span>
      </td>
      <td className="num">{r.totalCoverDays === null ? "-" : n(Math.floor(r.totalCoverDays + 1e-9))}</td>
      <td className="num">
        {r.onOrderUnits > 0 ? (
          <>
            {n(r.onOrderUnits)}
            <span className="subtle">{n(Math.ceil(r.onOrderUnits / r.unitsPerCase))} cases</span>
          </>
        ) : (
          <span className="muted">0</span>
        )}
      </td>
      <td className="num">{r.suggestedCases === null ? "-" : n(r.suggestedCases)}</td>
      <td>
        <input
          className="count-input"
          name={`cases-${r.id}`}
          inputMode="numeric"
          aria-label={`Cases of ${r.inhouseSku} to order`}
          value={cases}
          onChange={(e) => {
            onCases(e.target.value);
            if (e.target.value.trim() !== "") onIncluded(true);
          }}
        />
      </td>
      <td className="num">{included && value ? n(value * r.unitsPerCase) : <span className="muted">-</span>}</td>
      <td className="notes">
        {r.openOrderIds.length > 0 && (
          <span className="subtle">
            On order:{" "}
            {r.openOrderIds.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Link href={`/china/${id}`}>#{id}</Link>
              </span>
            ))}
          </span>
        )}
        {r.provisional && <span className="subtle">Warehouse not counted, so this date treats it as empty.</span>}
        {r.warning && <span className="subtle warn-text">{r.warning}</span>}
        {error && <span className="error-text subtle-error">{error}</span>}
      </td>
    </tr>
  );
}

export function OrderForm({ rows, today, defaultExpected }: { rows: OrderRow[]; today: string; defaultExpected: string }) {
  const [state, action, pending] = useActionState<OrderState, FormData>(createChinaOrderAction, null);
  const errors = new Map((state?.issues ?? []).map((i) => [i.skuId, i.message]));
  const dateError = (f: "orderedOn" | "expectedOn") => state?.detailIssues?.find((i) => i.field === f)?.message;
  const [included, setIncluded] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.defaultIncluded])),
  );
  const [cases, setCases] = useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.suggestedCases ? String(r.suggestedCases) : ""])),
  );
  const [orderedOn, setOrderedOn] = useState(today);
  const [expectedTouched, setExpectedTouched] = useState(false);
  const [expectedOn, setExpectedOn] = useState(defaultExpected);
  // Kept in state so a refused save does not clear what was typed.
  const [text, setText] = useState({ supplier: "", poNumber: "", note: "" });
  const bind = (k: keyof typeof text) => ({
    value: text[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setText((t) => ({ ...t, [k]: e.target.value })),
  });

  const picked = rows.filter((r) => included[r.id] && /^\d+$/.test((cases[r.id] ?? "").trim()));
  const totalCases = picked.reduce((a, r) => a + Number(cases[r.id]), 0);
  const totalUnits = picked.reduce((a, r) => a + Number(cases[r.id]) * r.unitsPerCase, 0);

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
              <th>Order</th>
              <th>SKU</th>
              <th>Reorder by</th>
              <th className="num" title="(FBA + on the way + warehouse + on order) divided by sales per day">
                Total cover (days)
              </th>
              <th className="num">Already on order (units)</th>
              <th className="num">Suggested cases</th>
              <th>Cases to order</th>
              <th className="num">Units</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row
                key={r.id}
                r={r}
                error={errors.get(r.id)}
                included={!!included[r.id]}
                cases={cases[r.id] ?? ""}
                onIncluded={(v) => setIncluded((s) => ({ ...s, [r.id]: v }))}
                onCases={(v) => setCases((s) => ({ ...s, [r.id]: v }))}
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>
                <strong>Total</strong> ({picked.length} {picked.length === 1 ? "SKU" : "SKUs"})
              </td>
              <td className="num" data-testid="order-total-cases">
                <strong>{n(totalCases)}</strong> cases
              </td>
              <td className="num">{n(totalUnits)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="supplier">Supplier (optional)</label>
            <input id="supplier" name="supplier" type="text" maxLength={120} {...bind("supplier")} />
          </div>
          <div className="field">
            <label htmlFor="poNumber">Supplier order or PO number (optional)</label>
            <input id="poNumber" name="poNumber" type="text" maxLength={80} {...bind("poNumber")} />
          </div>
          <div className="field">
            <label htmlFor="orderedOn">Date the order was placed</label>
            <input
              id="orderedOn"
              name="orderedOn"
              type="date"
              max={today}
              value={orderedOn}
              onChange={(e) => {
                setOrderedOn(e.target.value);
                if (!expectedTouched && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                  const d = new Date(e.target.value + "T00:00:00Z");
                  d.setUTCDate(d.getUTCDate() + 60);
                  setExpectedOn(d.toISOString().slice(0, 10));
                }
              }}
            />
            <span className="hint">Today, or an earlier day for an order already on the way.</span>
            {dateError("orderedOn") && <span className="error-text small">{dateError("orderedOn")}</span>}
          </div>
          <div className="field">
            <label htmlFor="expectedOn">Expected at the warehouse</label>
            <input
              id="expectedOn"
              name="expectedOn"
              type="date"
              value={expectedOn}
              onChange={(e) => {
                setExpectedTouched(true);
                setExpectedOn(e.target.value);
              }}
            />
            <span className="hint">Starts at 60 days after the order date. Change it when the supplier gives a date.</span>
            {dateError("expectedOn") && <span className="error-text small">{dateError("expectedOn")}</span>}
          </div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="note">Note (optional)</label>
          <input id="note" name="note" type="text" maxLength={500} placeholder="For example: container booked, ships from Ningbo" {...bind("note")} />
        </div>
      </div>
      <button className="primary big" type="submit" disabled={pending} data-testid="save-order">
        {pending ? "Saving..." : "Save China order"}
      </button>
    </form>
  );
}
