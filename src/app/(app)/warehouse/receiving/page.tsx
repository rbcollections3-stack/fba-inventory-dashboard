import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { listClosedChinaOrders, listOpenChinaOrders } from "@/lib/china/repo";
import { businessToday } from "@/lib/dates";
import { ChinaOrderList } from "../../china/order-list";

export const metadata = { title: "Receiving · RB Collections FBA Dashboard" };

export default async function ReceivingPage() {
  await requireUser();
  const db = getDb();
  const today = businessToday();
  const [open, closed] = await Promise.all([listOpenChinaOrders(db), listClosedChinaOrders(db, 10)]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Receiving</h1>
          <p className="muted">
            Orders coming from China. When a delivery arrives, open its order, count what came, put it away, and save.
          </p>
        </div>
        <Link className="button" href="/warehouse">
          Back to warehouse
        </Link>
      </div>
      <h2>Expected deliveries</h2>
      {open.length === 0 ? (
        <div className="card muted" data-testid="nothing-expected">
          No deliveries expected right now. If a delivery from China arrives that is not listed, tell the office before
          putting it away.
        </div>
      ) : (
        <ChinaOrderList orders={open} today={today} linkBase="/warehouse/receiving" showSupplier={false} />
      )}
      {closed.length > 0 && (
        <>
          <h2>Recently received</h2>
          <ChinaOrderList orders={closed.filter((o) => o.status === "received")} today={today} linkBase="/warehouse/receiving" showSupplier={false} />
        </>
      )}
    </>
  );
}
