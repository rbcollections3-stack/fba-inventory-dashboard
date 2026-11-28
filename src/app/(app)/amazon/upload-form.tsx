"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { uploadAmazonReportsAction, type FileOutcome, type UploadState } from "./actions";

/** Zips a report in the browser so large ledger files fit in one upload. */
async function zipped(file: File): Promise<File> {
  if (typeof CompressionStream === "undefined") return file;
  const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
  const blob = await new Response(stream).blob();
  return new File([blob], file.name + ".gz", { type: "application/gzip" });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Outcome({ o }: { o: FileOutcome }) {
  if (!o.ok) {
    return (
      <div className="alert error" role="alert">
        {o.fileName && <strong>{o.fileName}: </strong>}
        {o.error} Nothing from this file was saved.
      </div>
    );
  }
  const r = o.result;
  const title =
    r.kind === "ledger_detail"
      ? `Inventory Ledger${r.periodStart && r.periodEnd ? `, ${fmtDate(r.periodStart)} to ${fmtDate(r.periodEnd)}` : ""}`
      : "Manage FBA Inventory";
  return (
    <div className="alert ok" role="status" data-testid="upload-ok">
      <strong>{o.fileName}</strong> saved ({title}). Found {r.skusMatched} of your SKUs.
      <ul>
        {r.kind === "ledger_detail" && r.rowsUsed === 0 && <li>No rows for your SKUs were in this file.</li>}
        {r.skusMissing.length > 0 && (
          <li>
            Not in this report: {r.skusMissing.join(", ")}.{" "}
            {r.kind === "fba_inventory" ? "Their FBA stock and inbound are set to 0." : "They show no sales for these days."}
          </li>
        )}
        {r.rowsSkipped > 0 && (
          <li>
            Skipped {r.rowsSkipped.toLocaleString("en-US")} rows for SKUs you don&apos;t track
            {r.untrackedSkus.length > 0 ? ` (${r.untrackedSkus.join(", ")}, plus Amazon resale SKUs)` : " (Amazon resale SKUs)"}.
          </li>
        )}
        {r.badRows.length > 0 && (
          <li>
            {r.badRows.length} rows could not be read and were left out, for example line {r.badRows[0].line}:{" "}
            {r.badRows[0].reason}.
          </li>
        )}
      </ul>
    </div>
  );
}

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadAmazonReportsAction, null);
  const [preparing, setPreparing] = useState(false);
  const busy = pending || preparing;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("files") as HTMLInputElement;
    const files = [...(input.files ?? [])];
    setPreparing(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", await zipped(f));
      startTransition(() => action(fd));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="stack">
        <div className="field">
          <label htmlFor="files">Amazon report files</label>
          <input id="files" name="files" type="file" accept=".txt,.tsv,.csv" multiple required />
          <span className="hint">You can pick both reports at once. The app works out which report each file is.</span>
        </div>
        <div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Uploading..." : "Upload"}
          </button>
        </div>
      </form>
      {state && (
        <div style={{ marginTop: 16 }}>
          {state.outcomes.map((o, i) => (
            <Outcome key={i} o={o} />
          ))}
          {state.outcomes.some((o) => o.ok) && (
            <p>
              <Link href="/skus">See the numbers on the SKUs screen</Link>
            </p>
          )}
        </div>
      )}
    </>
  );
}
