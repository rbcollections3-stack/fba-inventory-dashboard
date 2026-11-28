import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { listShipments } from "@/lib/shipments/repo";
import { ShipmentList } from "./shipment-list";

export const metadata = { title: "Shipments to build · RB Collections FBA Dashboard" };

export default async function WarehouseShipmentsPage() {
  const user = await requireUser();
  const db = getDb();
  const [requested, recent] = await Promise.all([listShipments(db, "requested"), listShipments(db, "sent", 10)]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Shipments to build</h1>
          <p className="muted">Open a shipment to see its pallet build sheets. Build every pallet, then mark it sent.</p>
        </div>
        {user.role === "admin" && (
          <Link className="button primary" href="/shipments">
            Plan a shipment
          </Link>
        )}
      </div>
      {requested.length === 0 ? (
        <div className="card" data-testid="no-shipments">
          Nothing to build right now. When a shipment is requested it shows up here.
        </div>
      ) : (
        <ShipmentList shipments={requested} />
      )}
      <h2>Recently sent</h2>
      {recent.length === 0 ? <div className="card muted">None yet.</div> : <ShipmentList shipments={recent} />}
    </>
  );
}
