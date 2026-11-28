import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { listAmazonImports } from "@/lib/amazon/repo";
import { missingSpApiSettings } from "@/lib/amazon/sp-api";
import { amazonSyncStatus, type KindStatus } from "@/lib/amazon/sync";
import { RefreshButton } from "./refresh-button";
import { UploadForm } from "./upload-form";

// The Refresh button waits for Amazon, which can take a few minutes.
export const maxDuration = 300;

export const metadata = { title: "Amazon reports · RB Collections FBA Dashboard" };

const KIND_LABEL = { ledger_detail: "Inventory Ledger", fba_inventory: "Manage FBA Inventory" } as const;

function when(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" });
}

const SYNC_NAME = { fba_inventory: "FBA stock and inbound", ledger_detail: "Daily sales" } as const;

function SyncRow({ s }: { s: KindStatus }) {
  const l = s.latest;
  let state: React.ReactNode = <span className="badge off">Never pulled</span>;
  if (l?.status === "requested") state = <span className="badge warn">Waiting for Amazon</span>;
  else if (l?.status === "saved") state = <span className="badge ok">OK</span>;
  else if (l?.status === "no_data") state = <span className="badge warn">Amazon had no data</span>;
  else if (l?.status === "failed") state = <span className="badge off">Failed</span>;
  return (
    <tr data-testid={`sync-${s.kind}`}>
      <td>{SYNC_NAME[s.kind]}</td>
      <td>{state}</td>
      <td>{s.lastSaved?.finishedAt ? when(s.lastSaved.finishedAt) : "-"}</td>
      <td className="wrap">{l?.status === "failed" ? l.message : ""}</td>
    </tr>
  );
}

export default async function AmazonReportsPage() {
  await requireAdmin();
  const db = getDb();
  const [imports, sync] = await Promise.all([listAmazonImports(db), amazonSyncStatus(db)]);
  const missing = missingSpApiSettings();
  const connected = missing.length === 0;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Amazon reports</h1>
          <p className="muted">
            FBA stock, units inbound to Amazon and daily sales come from Amazon automatically every morning. Uploading
            reports by hand still works as a backup.
          </p>
        </div>
      </div>

      <div className="card" data-testid="amazon-connection">
        <h2 style={{ marginTop: 0 }}>
          Automatic Amazon connection{" "}
          {connected ? <span className="badge ok">Keys set up</span> : <span className="badge off">Not set up</span>}
        </h2>
        {connected ? (
          <p className="muted">
            Every morning the app asks Amazon for your FBA stock, units inbound to Amazon and the last 31 days of
            sales, and loads them by itself. It only reads reports; it never changes anything in Seller Central.
          </p>
        ) : (
          <p className="muted">
            The Amazon keys are not in Vercel yet (missing: {missing.join(", ")}). Until they are, upload reports
            below. See &quot;Connect Amazon&quot; in SETUP.md for the steps.
          </p>
        )}
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Status</th>
                <th>Last loaded</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {sync.map((s) => (
                <SyncRow key={s.kind} s={s} />
              ))}
            </tbody>
          </table>
        </div>
        <RefreshButton disabled={!connected} />
      </div>

      <h2>Upload reports by hand (backup)</h2>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Which reports to download</h2>
        <ol className="steps">
          <li>
            <strong>FBA stock and inbound:</strong> in Seller Central go to <em>Reports &gt; Fulfillment</em>, open{" "}
            <em>Manage FBA Inventory</em> (under Inventory), and press <em>Request .txt Download</em>. Upload it the same
            day, because it shows stock at the moment you download it.
          </li>
          <li>
            <strong>Daily sales:</strong> in <em>Reports &gt; Fulfillment</em>, open <em>Inventory Ledger</em>, choose{" "}
            <em>Detailed view</em>, pick the last 30 days (or a whole month), and download it as .tsv or .csv.
          </li>
          <li>Upload the files exactly as downloaded. Don&apos;t open and save them in Excel first.</li>
        </ol>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Upload reports only here, never into chat. Uploading the same days again replaces the earlier numbers, so
          nothing is counted twice.
        </p>
      </div>

      <div className="card">
        <UploadForm />
      </div>

      <h2>Recent uploads</h2>
      {imports.length === 0 ? (
        <div className="card muted">No Amazon reports yet.</div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Loaded</th>
                <th>Report</th>
                <th>Covers</th>
                <th>How</th>
                <th className="num">Your SKUs found</th>
                <th className="num">Rows skipped</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id} data-testid="import-row">
                  <td>{when(i.createdAt)}</td>
                  <td>{KIND_LABEL[i.kind]}</td>
                  <td>
                    {i.kind === "ledger_detail"
                      ? i.periodStart
                        ? `${i.periodStart} to ${i.periodEnd}`
                        : "-"
                      : i.asOf
                        ? `Stock at ${when(i.asOf)}`
                        : "-"}
                  </td>
                  <td>{i.source === "upload" ? "Uploaded" : "Automatic"}</td>
                  <td className="num">{i.skusMatched}</td>
                  <td className="num">{i.rowsSkipped.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
