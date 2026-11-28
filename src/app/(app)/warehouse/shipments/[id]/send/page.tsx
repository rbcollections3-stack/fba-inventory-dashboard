import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { expectedLeft, getShipment } from "@/lib/shipments/repo";
import { SendForm, type SendLine } from "./send-form";

export const metadata = { title: "Mark shipment sent · RB Collections FBA Dashboard" };

export default async function SendShipmentPage({ params }: PageProps<"/warehouse/shipments/[id]/send">) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const s = await getShipment(getDb(), id);
  if (!s) notFound();
  if (s.status !== "requested") redirect(`/warehouse/shipments/${id}`);

  const lines: SendLine[] = s.lines.map((l) => {
    const left = expectedLeft(l);
    return {
      skuId: l.skuId,
      inhouseSku: l.inhouseSku,
      amazonSku: l.amazonSku,
      unitsPerCase: l.unitsPerCase,
      casesSent: l.cases,
      lastCount: l.warehouseOnHand,
      expectedLeft: left,
      expectedCases: left === null ? null : Math.floor(left / l.unitsPerCase),
      expectedLoose: left === null ? null : left % l.unitsPerCase,
    };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mark shipment #{s.id} as sent</h1>
          <p className="muted">Do this after every pallet is built and has left the warehouse.</p>
        </div>
        <Link className="button" href={`/warehouse/shipments/${s.id}`}>
          Back to pallet sheets
        </Link>
      </div>
      <div className="card">
        <ol className="steps" style={{ marginBottom: 0 }}>
          <li>For each SKU below, go to its shelf and count what is left.</li>
          <li>
            Type the <strong>full, sealed cases</strong> and any <strong>loose units</strong>. The boxes start with what
            the app expects is left. If the shelf is different, type what you see.
          </li>
          <li>
            Press <strong>Shipment has left: save counts</strong>. This saves the new stock counts and marks the
            shipment sent.
          </li>
        </ol>
      </div>
      <SendForm shipmentId={s.id} lines={lines} />
    </>
  );
}
