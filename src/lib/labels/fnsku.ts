import bwipjs from "bwip-js/node";

/**
 * FNSKU barcode labels for units, printed on a Rollo thermal printer with
 * 2.25 x 1.25 inch labels (Mo confirmed the size on 2026-11-28).
 *
 * Amazon's rules for a unit label: a Code 128 barcode of the FNSKU, the FNSKU
 * written underneath, the product title (shortening it is allowed) and the
 * condition. Nothing else that looks like a barcode may be on it.
 */

/** Most labels printed in one go, to catch a typo like 6000 for 600. */
export const MAX_LABELS = 5000;

/** Longest title that fits two lines on a 2.25 inch label. */
const TITLE_MAX = 60;

/** Code 128 barcode as an SVG drawing. The FNSKU is drawn as text separately. */
export function barcodeSvg(fnsku: string): string {
  return bwipjs.toSVG({ bcid: "code128", text: fnsku, height: 9, includetext: false, paddingwidth: 0, paddingheight: 0 });
}

/**
 * The barcode as a reusable SVG symbol, so a page with thousands of labels
 * draws the bars once and each label only points at them.
 */
export function barcodeSymbol(fnsku: string): { viewBox: string; inner: string } {
  const svg = barcodeSvg(fnsku);
  const viewBox = /viewBox="([\d.\s]+)"/.exec(svg)?.[1] ?? "0 0 100 40";
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return { viewBox, inner };
}

/** Shortens a long title in the middle, keeping the start and the size or colour at the end. */
export function labelTitle(title: string, max = TITLE_MAX): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const keepEnd = Math.floor((max - 3) / 3);
  const keepStart = max - 3 - keepEnd;
  return `${t.slice(0, keepStart).trimEnd()}...${t.slice(t.length - keepEnd).trimStart()}`;
}

/** Reads the "how many labels" box. Returns null when it is not a sensible whole number. */
export function readLabelCount(v: unknown): number | null {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_LABELS ? n : null;
}
