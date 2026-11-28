import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { SpApiClient, SpApiError, spApiConfigFromEnv } from "@/lib/amazon/sp-api";
import { requireUser } from "@/lib/auth/session";
import { findShipments, planLabels, readShipmentIds, type LabelPlan } from "@/lib/labels/amazon";
import { getShipment, saveAmazonLookup } from "@/lib/shipments/repo";

export const metadata = { title: "Amazon labels · RB Collections FBA Dashboard" };
// Looking a shipment up in Amazon can take a little while.
export const maxDuration = 60;

const n = (v: number) => v.toLocaleString("en-US");

export default async function AmazonLabelsPage({ params }: PageProps<"/warehouse/shipments/[id]/labels">) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const db = getDb();
  const s = await getShipment(db, id);
  if (!s) notFound();
  const { ids } = readShipmentIds(s.amazonShipmentId ?? "");
  const config = spApiConfigFromEnv();

  let plan: LabelPlan | null = null;
  let missing: string[] = [];
  let error: string | null = null;
  if (ids.length > 0 && config && s.status !== "cancelled") {
    try {
      const result = await findShipments(new SpApiClient(config), ids, s.amazonLookup ?? {});
      missing = result.missing;
      plan = planLabels(s.lines, result.found);
      const lookup = Object.fromEntries(
        result.found.map((f) => [f.fbaId, { inboundPlanId: f.inboundPlanId, shipmentId: f.shipmentId }]),
      );
      if (JSON.stringify(lookup) !== JSON.stringify(s.amazonLookup ?? {})) await saveAmazonLookup(db, s.id, lookup);
    } catch (err) {
      error = err instanceof SpApiError ? err.message : "Amazon could not be reached. Try again in a minute.";
    }
  }

  const pdf = (fbaId: string, q: Record<string, string>) =>
    `/warehouse/shipments/${s.id}/labels/pdf?${new URLSearchParams({ ship: fbaId, ...q }).toString()}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Amazon labels for shipment #{s.id}</h1>
          <p className="muted">
            Box labels (one on every case) and pallet labels (4 on every pallet), straight from Amazon, for the Rollo
            with 4x6 labels.
          </p>
        </div>
        <div className="actions">
          <Link className="button" href={`/warehouse/shipments/${s.id}`}>
            Back to pallet sheets
          </Link>
        </div>
      </div>

      {s.status === "cancelled" && <div className="alert error">This shipment was cancelled. Do not print labels.</div>}

      {ids.length === 0 && s.status !== "cancelled" && (
        <div className="alert warn" data-testid="labels-no-id">
          {isAdmin ? (
            <>
              First create this shipment in Seller Central (Send to Amazon). Then type Amazon&apos;s shipment ID (starts
              with FBA) on the <Link href={`/warehouse/shipments/${s.id}`}>pallet sheets page</Link> and come back here.
            </>
          ) : (
            <>Amazon labels are not ready yet. Ask the admin to add the Amazon shipment ID, then reload this page.</>
          )}
        </div>
      )}

      {ids.length > 0 && !config && (
        <div className="alert warn">
          The app is not connected to Amazon, so it cannot fetch labels. Print them from Seller Central for now.
        </div>
      )}

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {missing.length > 0 && (
        <div className="alert error" role="alert">
          Amazon has no open shipment with the ID {missing.join(", ")}. Check the ID in Seller Central (it starts with
          FBA). Shipments that are already marked as shipped or closed in Seller Central cannot be printed from here.
        </div>
      )}

      {plan && plan.warnings.length > 0 && (
        <div className="alert warn" role="alert" data-testid="labels-warnings">
          <strong>Check before you print:</strong>
          <ul>
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {plan && plan.groups.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>How to print and stick the labels</h2>
          <ol className="steps">
            <li>
              Load the <strong>Rollo</strong> with <strong>4x6 inch</strong> labels.
            </li>
            <li>
              For each pallet, press <strong>Box labels</strong>. A file opens. Print it: printer Rollo, paper size 4 x
              6, scale 100%.
            </li>
            <li>
              Take that pallet&apos;s box labels to its pallet. Stick <strong>one on the side of every case</strong>. The
              number of labels is the same as the number of cases on the pallet.
            </li>
            <li>
              When every pallet is wrapped, press <strong>Pallet labels</strong>. Amazon gives 4 labels for each
              pallet. Stick one in the middle of each side of the wrap.
            </li>
          </ol>
        </section>
      )}

      {plan?.groups.map((g) => {
        const boxes = g.pallets.reduce((a, p) => a + p.boxIds.length, 0);
        return (
          <section className="card" key={g.fbaId} data-testid="labels-group">
            <h2 style={{ marginTop: 0 }}>
              Amazon shipment {g.fbaId}
              {g.destination ? ` · going to Amazon ${g.destination}` : ""}
            </h2>
            <p className="muted">
              {n(g.pallets.length)} {g.pallets.length === 1 ? "pallet" : "pallets"}, {n(boxes)}{" "}
              {boxes === 1 ? "case" : "cases"}.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>In-house SKU</th>
                    <th className="num">Cases</th>
                    <th>Print</th>
                  </tr>
                </thead>
                <tbody>
                  {g.pallets.map((p, i) => (
                    <tr key={p.boxIds[0]} data-testid="labels-pallet">
                      <td>
                        <strong>{p.sheetNumber ? `Pallet ${p.sheetNumber}` : `Pallet ${i + 1} for ${g.fbaId}`}</strong>
                      </td>
                      <td>
                        <div className="inhouse-sm">{p.inhouseSku}</div>
                        <span className="subtle">Amazon SKU: {p.amazonSku}</span>
                      </td>
                      <td className="num">{n(p.boxIds.length)}</td>
                      <td>
                        <a
                          className="button primary"
                          href={pdf(g.fbaId, { kind: "box", boxes: p.boxIds.join(",") })}
                          target="_blank"
                          rel="noopener"
                        >
                          Box labels ({n(p.boxIds.length)})
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {g.pallets.length > 0 && (
              <p style={{ marginTop: 12 }}>
                <a
                  className="button"
                  href={pdf(g.fbaId, { kind: "pallet", pallets: String(g.pallets.length) })}
                  target="_blank"
                  rel="noopener"
                >
                  Pallet labels for all {n(g.pallets.length)} {g.pallets.length === 1 ? "pallet" : "pallets"} (
                  {n(g.pallets.length * 4)} labels)
                </a>
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}
