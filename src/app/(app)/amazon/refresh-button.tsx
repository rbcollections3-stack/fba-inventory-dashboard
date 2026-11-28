"use client";

import { useActionState } from "react";
import { refreshFromAmazonAction, type RefreshState } from "./actions";

const NAME = { fba_inventory: "FBA stock and inbound", ledger_detail: "Daily sales (last 31 days)" } as const;

export function RefreshButton({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<RefreshState, FormData>(refreshFromAmazonAction, null);
  return (
    <form action={action}>
      <button className="primary" type="submit" disabled={disabled || pending} data-testid="refresh-amazon">
        {pending ? "Asking Amazon... (up to a minute)" : "Refresh from Amazon now"}
      </button>
      {state?.error && (
        <div className="alert error" role="alert" style={{ marginTop: 12 }}>
          {state.error}
        </div>
      )}
      {state && state.outcomes.length > 0 && (
        <ul style={{ marginTop: 12 }} data-testid="refresh-result">
          {state.outcomes.map((o) => (
            <li key={o.kind}>
              <strong>{NAME[o.kind]}:</strong>{" "}
              {o.status === "saved"
                ? `updated (found ${o.skusMatched} of your SKUs).`
                : o.status === "waiting"
                  ? "Amazon is still preparing it. It will load by itself in the next few minutes; reload this page to see it."
                  : o.status === "no_data"
                    ? "Amazon had no data for this."
                    : o.status === "skipped"
                      ? "already up to date today."
                      : <span className="error-text">{o.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
