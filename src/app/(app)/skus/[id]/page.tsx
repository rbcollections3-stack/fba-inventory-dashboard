import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { getSku, listListingNames } from "@/lib/skus/repo";
import { SkuForm } from "../sku-form";

export const metadata = { title: "Edit SKU · RB Collections FBA Dashboard" };

export default async function EditSkuPage({ params }: PageProps<"/skus/[id]">) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const db = getDb();
  const [sku, listings] = await Promise.all([getSku(db, id), listListingNames(db)]);
  if (!sku) notFound();
  return (
    <>
      <h1>Edit {sku.amazonSku}</h1>
      <p className="muted">
        Warehouse on hand:{" "}
        {sku.warehouseOnHand === null ? "not counted yet" : `${sku.warehouseOnHand.toLocaleString("en-US")} units (counted ${sku.countedOn})`}
      </p>
      <div className="card">
        <SkuForm
          id={sku.id}
          listings={listings}
          defaults={{
            listing: sku.listingName,
            amazonSku: sku.amazonSku,
            inhouseSku: sku.inhouseSku,
            unitsPerCase: sku.unitsPerCase,
            tie: sku.tie,
            high: sku.high,
            maxCasesPerPallet: sku.maxCasesPerPallet,
            description: sku.description ?? "",
            warehouseLocation: sku.warehouseLocation ?? "",
            asin: sku.asin ?? "",
            fnsku: sku.fnsku ?? "",
            notes: sku.notes ?? "",
          }}
        />
      </div>
    </>
  );
}
