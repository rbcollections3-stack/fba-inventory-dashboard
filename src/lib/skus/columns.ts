/**
 * The columns of the SKU setup spreadsheet (public/SKU-setup-template.xlsx).
 * Headers must match these names. Matching ignores upper/lower case and
 * extra spaces, but not spelling.
 */
export const SKU_COLUMNS = [
  { key: "listing", header: "Listing", required: true },
  { key: "amazonSku", header: "Amazon SKU", required: true },
  { key: "inhouseSku", header: "In-house SKU", required: true },
  { key: "unitsPerCase", header: "Units per case", required: true },
  { key: "tie", header: "Tie (cases per layer)", required: true },
  { key: "high", header: "High (layers)", required: true },
  { key: "maxCasesPerPallet", header: "Max cases per pallet", required: true },
  { key: "warehouseOnHand", header: "Warehouse on hand (units)", required: true },
  { key: "description", header: "Product description", required: false },
  { key: "warehouseLocation", header: "Warehouse location", required: false },
  { key: "asin", header: "ASIN", required: false },
  { key: "countDate", header: "Count date", required: false },
  { key: "notes", header: "Notes", required: false },
] as const;

export type SkuColumnKey = (typeof SKU_COLUMNS)[number]["key"];

export function normalizeHeader(h: string): string {
  return h.replace(/\s+/g, " ").trim().toLowerCase();
}
