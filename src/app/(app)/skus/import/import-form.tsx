"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import type { RowIssue } from "@/lib/skus/parse";
import { checkImportAction, confirmImportAction, type ImportState } from "../actions";

function IssueList({ issues }: { issues: RowIssue[] }) {
  return (
    <ul>
      {issues.slice(0, 100).map((i, n) => (
        <li key={n}>
          {i.row !== null && <strong>Row {i.row}: </strong>}
          {i.message}
        </li>
      ))}
      {issues.length > 100 && <li>...and {issues.length - 100} more.</li>}
    </ul>
  );
}

export function ImportForm() {
  const [checked, checkAction, checking] = useActionState<ImportState, FormData>(checkImportAction, { stage: "start" });
  const [result, setResult] = useState<ImportState | null>(null);
  const [saving, startSaving] = useTransition();
  // A new check replaces the result of the last save.
  const [lastChecked, setLastChecked] = useState(checked);
  if (lastChecked !== checked) {
    setLastChecked(checked);
    setResult(null);
  }

  const state = result ?? checked;

  if (state.stage === "done") {
    return (
      <div className="alert ok" role="status">
        Import finished: {state.created} new SKUs added and {state.updated} updated. Warehouse on-hand counts were
        recorded for every row. <Link href="/skus">See all SKUs</Link>
      </div>
    );
  }

  return (
    <>
      <form action={checkAction} className="stack">
        <div className="field">
          <label htmlFor="file">Filled-in SKU template (.xlsx or .csv)</label>
          <input id="file" name="file" type="file" accept=".xlsx,.csv" required />
        </div>
        <div>
          <button className="primary" type="submit" disabled={checking || saving}>
            {checking ? "Checking..." : "Check file"}
          </button>
        </div>
      </form>

      {state.stage === "problems" && (
        <div className="alert error" role="alert" style={{ marginTop: 16 }}>
          <strong>Nothing was imported.</strong> Fix these in the spreadsheet, save it and upload it again:
          <IssueList issues={state.errors} />
        </div>
      )}

      {state.stage === "preview" && (
        <div style={{ marginTop: 16 }}>
          <div className="alert ok" role="status">
            <strong>{state.fileName}</strong> looks good: {state.rows.length} SKUs ({state.newCount} new,{" "}
            {state.updateCount} already in the app will be updated). Nothing is saved until you press Import.
          </div>
          {state.warnings.length > 0 && (
            <div className="alert warn">
              Please double-check:
              <IssueList issues={state.warnings} />
            </div>
          )}
          <div className="table-wrap card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Listing</th>
                  <th>Amazon SKU</th>
                  <th>In-house SKU</th>
                  <th className="num">Units / case</th>
                  <th className="num">Tie</th>
                  <th className="num">High</th>
                  <th className="num">Max cases</th>
                  <th className="num">On hand</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    <td>{r.listing}</td>
                    <td>{r.amazonSku}</td>
                    <td>{r.inhouseSku}</td>
                    <td className="num">{r.unitsPerCase}</td>
                    <td className="num">{r.tie}</td>
                    <td className="num">{r.high}</td>
                    <td className="num">{r.maxCasesPerPallet}</td>
                    <td className="num">{r.warehouseOnHand.toLocaleString("en-US")}</td>
                    <td className="muted small">
                      {state.existing.includes(r.amazonSku.toLowerCase()) ? "update" : "new"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="primary"
            type="button"
            disabled={saving}
            onClick={() =>
              startSaving(async () => {
                setResult(await confirmImportAction(JSON.stringify(state.rows)));
              })
            }
          >
            {saving ? "Importing..." : `Import ${state.rows.length} SKUs`}
          </button>
        </div>
      )}
    </>
  );
}
