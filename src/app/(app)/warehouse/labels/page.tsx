import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { MAX_LABELS } from "@/lib/labels/fnsku";
import { groupByListing, listSkus } from "@/lib/skus/repo";

export const metadata = { title: "Barcode labels · RB Collections FBA Dashboard" };

export default async function LabelsPage({ searchParams }: PageProps<"/warehouse/labels">) {
  await requireUser();
  const q = await searchParams;
  const groups = groupByListing(await listSkus(getDb()));
  const err = typeof q.error === "string" ? q.error : null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Barcode labels (FNSKU)</h1>
          <p className="muted">Print Amazon barcode stickers for units that arrived from China without one.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/warehouse">
            Back
          </Link>
        </div>
      </div>

      {err === "count" && (
        <div className="alert error" role="alert">
          Type how many labels you need: a whole number from 1 to {MAX_LABELS.toLocaleString("en-US")}.
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Before you start</h2>
        <ol className="steps">
          <li>
            Look at one unit. If it <strong>already has a white sticker with a barcode starting X00</strong>, it does
            not need another one. Stop here.
          </li>
          <li>
            Load the <strong>Rollo</strong> with the small <strong>2.25 x 1.25 inch</strong> labels.
          </li>
          <li>Find the product below by its in-house SKU. Type how many units need a sticker, then press Print.</li>
          <li>
            Put one sticker on each unit, flat, on the outside of the bag or box. <strong>Cover any other barcode</strong>{" "}
            on the unit (for example the factory barcode) so Amazon only scans this one.
          </li>
        </ol>
      </section>

      {groups.map((g) => (
        <section key={g.listing}>
          <h3>{g.listing}</h3>
          <div className="table-wrap card">
            <table>
              <thead>
                <tr>
                  <th>In-house SKU</th>
                  <th>Product</th>
                  <th>Barcode (FNSKU)</th>
                  <th>Print</th>
                </tr>
              </thead>
              <tbody>
                {g.skus.map((s) => (
                  <tr key={s.id} data-testid="label-row">
                    <td>
                      <div className="inhouse-sm">{s.inhouseSku}</div>
                      <span className="subtle">Amazon SKU: {s.amazonSku}</span>
                    </td>
                    <td className="wrap">{s.description ?? s.listingName}</td>
                    <td>{s.fnsku ? <code>{s.fnsku}</code> : <span className="badge warn">Not known yet</span>}</td>
                    <td>
                      {s.fnsku ? (
                        <form action="/warehouse/labels/print" method="get" className="inline-form">
                          <input type="hidden" name="sku" value={s.id} />
                          <label className="sr-only" htmlFor={`qty-${s.id}`}>
                            Labels for {s.inhouseSku}
                          </label>
                          <input
                            id={`qty-${s.id}`}
                            name="qty"
                            type="number"
                            min={1}
                            max={MAX_LABELS}
                            step={1}
                            inputMode="numeric"
                            defaultValue={s.unitsPerCase}
                            style={{ width: 90 }}
                          />
                          <button type="submit" className="primary">
                            Print
                          </button>
                        </form>
                      ) : (
                        <span className="muted small">
                          Comes from Amazon after the next daily update, or ask the admin to type it on the SKU&apos;s
                          edit screen.
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
