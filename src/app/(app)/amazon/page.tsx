import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { listAmazonImports } from "@/lib/amazon/repo";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Amazon reports · RB Collections FBA Dashboard" };

const KIND_LABEL = { ledger_detail: "Inventory Ledger", fba_inventory: "Manage FBA Inventory" } as const;

function when(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" });
}

export default async function AmazonReportsPage() {
  await requireAdmin();
  const imports = await listAmazonImports(getDb());
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Amazon reports</h1>
          <p className="muted">
            Upload Seller Central reports here to update FBA stock, units inbound to Amazon and daily sales. Once the
            Amazon connection is set up, these update automatically every day and uploading becomes optional.
          </p>
        </div>
      </div>

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
