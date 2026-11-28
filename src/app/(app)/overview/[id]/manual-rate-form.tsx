"use client";

import { useActionState } from "react";
import { saveManualRateAction, type ManualRateState } from "../actions";

export function ManualRateForm({
  skuId,
  current,
  note,
}: {
  skuId: number;
  current: number | null;
  note: string | null;
}) {
  const [state, action, pending] = useActionState<ManualRateState, FormData>(
    saveManualRateAction.bind(null, skuId),
    null,
  );
  return (
    <form action={action} className="stack" data-testid="manual-rate-form">
      {state?.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      {state?.saved === "set" && <div className="alert ok">Saved. The dates now use your number.</div>}
      {state?.saved === "cleared" && <div className="alert ok">Cleared. The dates now use real Amazon sales.</div>}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="manualDailySales">Expected units sold per day</label>
          <input
            id="manualDailySales"
            name="manualDailySales"
            type="text"
            inputMode="decimal"
            defaultValue={current ?? ""}
            placeholder="Blank = use real sales"
            key={`rate-${current}`}
          />
          <span className="hint">
            Used instead of real sales while it is filled in. Leave blank to plan from the last 30 days of Amazon sales.
          </span>
        </div>
        <div className="field">
          <label htmlFor="note">Why (optional)</label>
          <input id="note" name="note" type="text" defaultValue={note ?? ""} placeholder="Back in stock, sold about 4 a day before" key={`note-${note}`} />
        </div>
      </div>
      <div className="actions">
        <button type="submit" className="primary" disabled={pending}>
          Save
        </button>
        {current !== null && (
          <button type="submit" name="clear" value="1" disabled={pending}>
            Clear and use real sales
          </button>
        )}
      </div>
    </form>
  );
}
