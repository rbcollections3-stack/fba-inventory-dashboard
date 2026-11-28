"use client";

import { useActionState } from "react";
import { updateDetailsAction, type DetailsState } from "../actions";

export type DetailsValues = {
  supplier: string | null;
  poNumber: string | null;
  orderedOn: string;
  expectedOn: string;
  note: string | null;
};

/** Admin: change the supplier, PO number, dates and note of a China order. */
export function DetailsForm({ id, values, today }: { id: number; values: DetailsValues; today: string }) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(updateDetailsAction.bind(null, id), null);
  const dateError = (f: "orderedOn" | "expectedOn") => state?.detailIssues?.find((i) => i.field === f)?.message;
  return (
    <form action={action} className="card no-print" data-testid="details-form">
      <h3 style={{ marginTop: 0 }}>Order details</h3>
      {state?.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      {state?.saved && (
        <div className="alert ok" role="status">
          Saved.
        </div>
      )}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="supplier">Supplier</label>
          <input id="supplier" name="supplier" type="text" maxLength={120} defaultValue={values.supplier ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="poNumber">Supplier order or PO number</label>
          <input id="poNumber" name="poNumber" type="text" maxLength={80} defaultValue={values.poNumber ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="orderedOn">Date the order was placed</label>
          <input id="orderedOn" name="orderedOn" type="date" max={today} defaultValue={values.orderedOn} />
          {dateError("orderedOn") && <span className="error-text small">{dateError("orderedOn")}</span>}
        </div>
        <div className="field">
          <label htmlFor="expectedOn">Expected at the warehouse</label>
          <input id="expectedOn" name="expectedOn" type="date" defaultValue={values.expectedOn} />
          <span className="hint">Change this when the supplier or forwarder gives a new date.</span>
          {dateError("expectedOn") && <span className="error-text small">{dateError("expectedOn")}</span>}
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="note">Note</label>
        <input id="note" name="note" type="text" maxLength={500} defaultValue={values.note ?? ""} />
      </div>
      <button type="submit" style={{ marginTop: 12 }} disabled={pending}>
        {pending ? "Saving..." : "Save details"}
      </button>
    </form>
  );
}
