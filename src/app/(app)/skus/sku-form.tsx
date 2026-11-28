"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveSkuAction, type SkuFormState } from "./actions";

export type SkuFormDefaults = {
  listing: string;
  amazonSku: string;
  inhouseSku: string;
  unitsPerCase: number | "";
  tie: number | "";
  high: number | "";
  maxCasesPerPallet: number | "";
  description: string;
  warehouseLocation: string;
  asin: string;
  fnsku: string;
  notes: string;
};

export function SkuForm({
  id,
  defaults,
  listings,
}: {
  id: number | null;
  defaults: SkuFormDefaults;
  listings: string[];
}) {
  const [state, action, pending] = useActionState<SkuFormState, FormData>(saveSkuAction.bind(null, id), {});
  const err = (k: string) => state.fieldErrors?.[k];

  const field = (
    name: keyof SkuFormDefaults,
    label: string,
    opts: { type?: "text" | "number"; hint?: string; required?: boolean; list?: string } = {},
  ) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={opts.type ?? "text"}
        min={opts.type === "number" ? 1 : undefined}
        step={opts.type === "number" ? 1 : undefined}
        defaultValue={defaults[name]}
        required={opts.required}
        list={opts.list}
        aria-invalid={err(name) ? true : undefined}
      />
      {err(name) ? <span className="hint" style={{ color: "var(--danger)" }}>{err(name)}</span> : opts.hint && <span className="hint">{opts.hint}</span>}
    </div>
  );

  return (
    <form action={action} className="stack">
      {state.error && <div className="alert error" role="alert">{state.error}</div>}
      {field("listing", "Listing", { required: true, list: "listing-names", hint: "Use the same name for every SKU in a listing." })}
      <datalist id="listing-names">
        {listings.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <div className="grid-2">
        {field("amazonSku", "Amazon SKU", { required: true, hint: "Exactly as in Seller Central." })}
        {field("inhouseSku", "In-house SKU", { required: true, hint: "The SKU on your warehouse labels." })}
      </div>
      <div className="grid-2">
        {field("unitsPerCase", "Units per case", { type: "number", required: true })}
        {field("maxCasesPerPallet", "Max cases per pallet", { type: "number", required: true, hint: "Usually tie x high." })}
        {field("tie", "Tie (cases per layer)", { type: "number", required: true })}
        {field("high", "High (layers)", { type: "number", required: true })}
      </div>
      {field("description", "Product description", { hint: "Optional. Helps staff confirm the right item." })}
      <div className="grid-2">
        {field("warehouseLocation", "Warehouse location", { hint: "Optional." })}
        {field("asin", "ASIN", { hint: "Optional. 10 letters and numbers." })}
      </div>
      {field("fnsku", "FNSKU (Amazon barcode)", {
        hint: "Filled in automatically from Amazon reports. Starts with X00, or is the ASIN for stickerless items.",
      })}
      <div className="field">
        <label htmlFor="countUnits">New warehouse count (units)</label>
        <input
          id="countUnits"
          name="countUnits"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          aria-invalid={err("countUnits") ? true : undefined}
        />
        {err("countUnits") ? (
          <span className="hint" style={{ color: "var(--danger)" }}>{err("countUnits")}</span>
        ) : (
          <span className="hint">Optional. Type the units you counted today. Leave blank to keep the last count.</span>
        )}
      </div>
      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" rows={3} defaultValue={defaults.notes} />
      </div>
      <div className="actions">
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save SKU"}
        </button>
        <Link className="button" href="/skus">
          Cancel
        </Link>
      </div>
    </form>
  );
}
