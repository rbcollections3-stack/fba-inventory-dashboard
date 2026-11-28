import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { listListingNames } from "@/lib/skus/repo";
import { SkuForm } from "../sku-form";

export const metadata = { title: "Add a SKU · RB Collections FBA Dashboard" };

export default async function NewSkuPage() {
  await requireAdmin();
  const listings = await listListingNames(getDb());
  return (
    <>
      <h1>Add a SKU</h1>
      <p className="muted">The warehouse on-hand count is entered on the Warehouse counts screen (coming in the next phase) or by importing the spreadsheet.</p>
      <div className="card">
        <SkuForm
          id={null}
          listings={listings}
          defaults={{
            listing: "",
            amazonSku: "",
            inhouseSku: "",
            unitsPerCase: "",
            tie: "",
            high: "",
            maxCasesPerPallet: "",
            description: "",
            warehouseLocation: "",
            asin: "",
            notes: "",
          }}
        />
      </div>
    </>
  );
}
