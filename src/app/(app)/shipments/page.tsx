import Link from "next/link";
import { getDb } from "@/db";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday } from "@/lib/dates";
import { loadForecastBoard } from "@/lib/forecast/repo";
import { RULES } from "@/lib/forecast/rules";
import { listShipments, skusInOpenShipments } from "@/lib/shipments/repo";
import { ShipmentList } from "../warehouse/shipments/shipment-list";
import { PlanForm, type PlanRow } from "./plan-form";

export const metadata = { title: "Ship to Amazon · RB Collections FBA Dashboard" };

export default async function ShipToAmazonPage() {
  await requireAdmin();
  const db = getDb();
  const [board, open, requested, recent] = await Promise.all([
    loadForecastBoard(db, businessToday()),
    skusInOpenShipments(db),
    listShipments(db, "requested"),
    listShipments(db, undefined, 15),
  ]);

  const rows: PlanRow[] = board.rows.map((r) => {
    const f = r.forecast;
    const due = f.shipStatus === "red" || f.shipStatus === "yellow";
    const inOpen = open.get(r.id) ?? null;
    let defaultCases: number | null = f.shipCases;
    if (f.warehouseShort && f.shipCasesAvailable !== null) defaultCases = f.shipCasesAvailable;
    return {
      id: r.id,
      inhouseSku: r.inhouseSku,
      amazonSku: r.amazonSku,
      listingName: r.listingName,
      shipStatus: f.shipStatus,
      shipBy: f.shipBy,
      suggestedCases: f.shipCases,
      warehouseOnHand: r.warehouseOnHand,
      unitsPerCase: r.unitsPerCase,
      tie: r.tie,
      high: r.high,
      maxCasesPerPallet: r.maxCasesPerPallet,
      openShipmentId: inOpen,
      defaultCases: defaultCases && defaultCases > 0 ? defaultCases : null,
      defaultIncluded: due && inOpen === null && !!defaultCases && defaultCases > 0,
    };
  });
  const dueCount = rows.filter((r) => r.shipStatus === "red" || r.shipStatus === "yellow").length;
  const sent = recent.filter((s) => s.status !== "requested");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ship to Amazon</h1>
          <p className="muted">
            Pick what goes in the next shipment. The app suggests {RULES.shipmentCoverDays} days of sales, in full
            cases, for every SKU due to ship. Creating the shipment sends pallet build sheets to the warehouse. Nothing
            is created in Seller Central; do that there as usual.
          </p>
        </div>
        <Link className="button" href="/overview">
          Back to overview
        </Link>
      </div>

      {requested.length > 0 && (
        <>
          <h2>Waiting at the warehouse</h2>
          <ShipmentList shipments={requested} />
        </>
      )}

      <h2>Plan a new shipment</h2>
      <p className="small muted" data-testid="plan-summary">
        {dueCount === 0
          ? "No SKU is due to ship in the next 7 days. You can still tick any SKU to send it now."
          : `${dueCount} ${dueCount === 1 ? "SKU is" : "SKUs are"} due to ship within ${RULES.shipSoonDays} days and ticked below.`}{" "}
        {board.stockAsOf ? null : "No FBA stock loaded yet, so there are no suggestions. "}
        Cases are capped at the full cases the last warehouse count shows. SKUs with no count use the full suggestion;
        check the shelf before you send.
      </p>
      {rows.length === 0 ? (
        <div className="card">
          No SKUs yet. Add them on the <Link href="/skus">SKUs</Link> screen.
        </div>
      ) : (
        <PlanForm rows={rows} />
      )}

      <h2>Recent shipments</h2>
      {sent.length === 0 ? (
        <div className="card muted">No shipments sent or cancelled yet.</div>
      ) : (
        <ShipmentList shipments={sent} />
      )}
      <p className="small muted">
        When the warehouse marks a shipment sent, its units count as on the way to Amazon until Amazon&apos;s next
        stock report includes them, so the same stock is never counted twice.
      </p>
    </>
  );
}
