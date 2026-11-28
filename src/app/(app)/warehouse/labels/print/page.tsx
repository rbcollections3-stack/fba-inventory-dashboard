import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { barcodeSymbol, labelTitle, readLabelCount } from "@/lib/labels/fnsku";
import { getSku } from "@/lib/skus/repo";
import { PrintButton } from "../../shipments/[id]/print-button";

export const metadata = { title: "Print barcode labels · RB Collections FBA Dashboard" };

export default async function PrintLabelsPage({ searchParams }: PageProps<"/warehouse/labels/print">) {
  await requireUser();
  const q = await searchParams;
  const skuId = Number(q.sku);
  if (!Number.isInteger(skuId) || skuId <= 0) notFound();
  const qty = readLabelCount(q.qty);
  if (qty === null) redirect("/warehouse/labels?error=count");
  const sku = await getSku(getDb(), skuId);
  if (!sku) notFound();
  if (!sku.fnsku) redirect("/warehouse/labels");

  const bars = barcodeSymbol(sku.fnsku);
  const title = labelTitle(sku.description ?? sku.listingName);
  const back = typeof q.back === "string" && q.back.startsWith("/warehouse/") ? q.back : "/warehouse/labels";

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1>
            {qty.toLocaleString("en-US")} barcode {qty === 1 ? "label" : "labels"} for {sku.inhouseSku}
          </h1>
          <p className="muted">
            {sku.description ?? sku.listingName} · FNSKU {sku.fnsku}
          </p>
        </div>
        <div className="actions">
          <Link className="button" href={back}>
            Back
          </Link>
          <PrintButton label="Print labels" />
        </div>
      </div>

      <section className="card no-print">
        <h2 style={{ marginTop: 0 }}>In the print window</h2>
        <ol className="steps">
          <li>
            Printer: choose the <strong>Rollo</strong>.
          </li>
          <li>
            Paper size: <strong>2.25 x 1.25 in</strong> (it may be called 57 x 32 mm). Margins: <strong>None</strong>.
            Scale: <strong>100%</strong>. Turn off headers and footers.
          </li>
          <li>Print one label first and scan it or check it is straight and not cut off, then print the rest.</li>
        </ol>
        <p className="muted small">One label is shown below. All {qty.toLocaleString("en-US")} print.</p>
      </section>

      <div className="fnsku-preview no-print" aria-hidden="true">
        <FnskuLabel fnsku={sku.fnsku} title={title} />
      </div>

      <div className="fnsku-labels" data-testid="fnsku-labels" data-count={qty}>
        <svg className="fnsku-defs" aria-hidden="true" focusable="false">
          <symbol id="fnsku-bars" viewBox={bars.viewBox} preserveAspectRatio="none" dangerouslySetInnerHTML={{ __html: bars.inner }} />
        </svg>
        {Array.from({ length: qty }, (_, i) => (
          <FnskuLabel key={i} fnsku={sku.fnsku!} title={title} />
        ))}
      </div>
    </>
  );
}

function FnskuLabel({ fnsku, title }: { fnsku: string; title: string }) {
  return (
    <div className="fnsku-label">
      <svg className="fnsku-bars" aria-hidden="true" preserveAspectRatio="none">
        <use href="#fnsku-bars" />
      </svg>
      <div className="fnsku-code">{fnsku}</div>
      <div className="fnsku-title">{title}</div>
      <div className="fnsku-cond">New</div>
    </div>
  );
}
