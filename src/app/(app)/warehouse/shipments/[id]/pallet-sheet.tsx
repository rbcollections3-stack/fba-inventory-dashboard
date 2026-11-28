import { palletSteps, stepText, type PalletSheet as Sheet } from "@/lib/shipments/pallets";
import type { ShipmentLineView } from "@/lib/shipments/repo";

const n = (v: number) => v.toLocaleString("en-US");

/** Side view of the pallet, top layer first, so the shape is easy to see. */
function StackDrawing({ layers, tie }: { layers: number[]; tie: number }) {
  return (
    <div className="stack-drawing" aria-hidden="true">
      {[...layers].reverse().map((count, i) => {
        const layerNo = layers.length - i;
        return (
          <div className="stack-layer" key={layerNo}>
            <span className="stack-label">Layer {layerNo}</span>
            <div className="stack-boxes" style={{ gridTemplateColumns: `repeat(${tie}, 1fr)` }}>
              {Array.from({ length: tie }, (_, k) => {
                // Centre a partial top layer, as the steps say.
                const start = Math.floor((tie - count) / 2);
                const filled = k >= start && k < start + count;
                return <span key={k} className={filled ? "box" : "box empty"} />;
              })}
            </div>
            <span className="stack-count">{count === 1 ? "1 case" : `${count} cases`}</span>
          </div>
        );
      })}
      <div className="stack-pallet">PALLET</div>
    </div>
  );
}

export function PalletSheet({
  shipmentId,
  amazonShipmentId,
  totalPallets,
  line,
  sheet,
}: {
  shipmentId: number;
  amazonShipmentId: string | null;
  totalPallets: number;
  line: ShipmentLineView;
  sheet: Sheet;
}) {
  const { layout } = sheet;
  const steps = palletSteps(line.inhouseSku, layout);
  return (
    <section className="pallet-sheet card" data-testid="pallet-sheet" aria-label={`Pallet ${sheet.number} of ${totalPallets}`}>
      <div className="sheet-top">
        <div>
          <div className="sheet-pallet-no">
            Pallet {sheet.number} of {totalPallets}
          </div>
          <div className="muted">
            Shipment #{shipmentId}
            {amazonShipmentId ? ` · Amazon ${amazonShipmentId}` : ""}
            {sheet.skuPalletCount > 1 ? ` · ${line.inhouseSku} pallet ${sheet.skuPalletNumber} of ${sheet.skuPalletCount}` : ""}
          </div>
        </div>
        <div className="sheet-cases">
          <div className="big-number" data-testid="sheet-cases">{n(layout.cases)}</div>
          <div className="muted">{layout.cases === 1 ? "case" : "cases"}</div>
        </div>
      </div>

      <div className="sheet-sku">
        <div className="sheet-inhouse" data-testid="sheet-inhouse">{line.inhouseSku}</div>
        <div className="muted">
          Amazon SKU: {line.amazonSku}
          {line.description ? ` · ${line.description}` : ""}
          {line.warehouseLocation ? ` · Location: ${line.warehouseLocation}` : ""}
        </div>
      </div>

      <div className="sheet-body">
        <div>
          <dl className="sheet-facts">
            <dt>Cases on this pallet</dt>
            <dd>{n(layout.cases)}</dd>
            <dt>Cases per layer</dt>
            <dd>{line.tie}</dd>
            <dt>Layers</dt>
            <dd>
              {layout.fullLayers === 0
                ? "1 (not a full layer)"
                : `${layout.fullLayers} full${layout.topCases > 0 ? ` + ${layout.topCases} on top` : ""}`}
            </dd>
            <dt>Units per case</dt>
            <dd>{line.unitsPerCase}</dd>
            <dt>Units on this pallet</dt>
            <dd>{n(layout.cases * line.unitsPerCase)}</dd>
          </dl>
          <ol className="sheet-steps">
            {steps.map((s) => (
              <li key={stepText(s)}>
                {s.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <strong key={i}>{p.b}</strong>))}
              </li>
            ))}
          </ol>
        </div>
        <StackDrawing layers={layout.layers} tie={line.tie} />
      </div>

      <div className="signoff">
        <div>
          Built by <span className="line" />
        </div>
        <div>
          Date <span className="line short" />
        </div>
        <div>
          Checked by <span className="line" />
        </div>
      </div>
    </section>
  );
}
