import Link from "next/link";
import type { ShipmentView } from "@/lib/shipments/repo";

export function fmtWhen(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: process.env.BUSINESS_TIME_ZONE || "America/Los_Angeles",
  });
}

const STATUS: Record<ShipmentView["status"], { label: string; cls: string }> = {
  requested: { label: "To build", cls: "warn" },
  sent: { label: "Sent", cls: "ok" },
  cancelled: { label: "Cancelled", cls: "off" },
};

const n = (v: number) => v.toLocaleString("en-US");

/** A table of shipments with what is in each one. Used by the admin and the warehouse. */
export function ShipmentList({ shipments }: { shipments: ShipmentView[] }) {
  return (
    <div className="card table-wrap" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Shipment</th>
            <th>Status</th>
            <th>What is in it</th>
            <th className="num">Pallets</th>
            <th className="num">Cases</th>
            <th>Requested</th>
            <th>Sent</th>
          </tr>
        </thead>
        <tbody>
          {shipments.map((s) => (
            <tr key={s.id} data-testid="shipment-row">
              <td>
                <Link href={`/warehouse/shipments/${s.id}`} className="inhouse-sm">
                  #{s.id}
                </Link>
                {s.amazonShipmentId && <span className="subtle">Amazon {s.amazonShipmentId}</span>}
              </td>
              <td>
                <span className={`badge ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
              </td>
              <td className="wrap">
                {s.lines.map((l) => `${l.inhouseSku} x ${n(l.cases)}`).join(", ")}
                {s.note && <span className="subtle">Note: {s.note}</span>}
              </td>
              <td className="num">{n(s.totalPallets)}</td>
              <td className="num">{n(s.totalCases)}</td>
              <td>
                {fmtWhen(s.createdAt)}
                {s.createdBy && <span className="subtle">by {s.createdBy}</span>}
              </td>
              <td>
                {s.status === "sent" ? fmtWhen(s.sentAt) : "-"}
                {s.status === "sent" && s.sentBy && <span className="subtle">by {s.sentBy}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
