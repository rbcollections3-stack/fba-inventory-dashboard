import { requireAdmin } from "@/lib/auth/session";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import SKUs · RB Collections FBA Dashboard" };

export default async function ImportPage() {
  await requireAdmin();
  return (
    <>
      <h1>Import the SKU spreadsheet</h1>
      <div className="card">
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            Download the <a href="/SKU-setup-template.xlsx">SKU template</a> and fill in one row per SKU on the
            &quot;SKUs&quot; sheet. Keep the column headers as they are.
          </li>
          <li>Upload it below and press Check file. The app checks every row and shows what it found.</li>
          <li>If everything looks right, press Import. Nothing is saved before that.</li>
        </ol>
        <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
          SKUs are matched by Amazon SKU, so uploading the sheet again updates existing SKUs instead of adding
          copies. Each import also records the &quot;Warehouse on hand&quot; number as a new warehouse count.
        </p>
      </div>
      <div className="card">
        <ImportForm />
      </div>
    </>
  );
}
