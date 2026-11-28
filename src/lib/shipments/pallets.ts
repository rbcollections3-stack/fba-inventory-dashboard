/**
 * Pallet building rules from the approved build plan ("Pallet build sheets").
 * Plain arithmetic with no database, covered by tests/unit/pallets.test.ts.
 *
 * - One SKU per pallet, never mixed.
 * - A shipment larger than one pallet is split into full pallets first, with
 *   the leftover cases on a final pallet.
 * - A pallet is built in layers of `tie` cases, up to `high` layers, and never
 *   more than the SKU's maximum cases per pallet.
 */

export type PackConfig = {
  /** Cases per layer. */
  tie: number;
  /** Layers on a full pallet. */
  high: number;
  maxCasesPerPallet: number;
};

/** Most cases one pallet takes: tie x high, or the maximum if that is lower. */
export function palletCapacity(c: PackConfig): number {
  return Math.max(1, Math.min(c.maxCasesPerPallet, c.tie * c.high));
}

/** Cases on each pallet, full pallets first and the leftover last. */
export function splitIntoPallets(cases: number, c: PackConfig): number[] {
  if (!Number.isInteger(cases) || cases <= 0) return [];
  const cap = palletCapacity(c);
  const out: number[] = [];
  for (let left = cases; left > 0; left -= cap) out.push(Math.min(cap, left));
  return out;
}

export type PalletLayout = {
  cases: number;
  /** Cases per full layer (the tie). */
  tie: number;
  /** Number of complete layers. */
  fullLayers: number;
  /** Cases on the partial top layer, 0 when there is none. */
  topCases: number;
  /** Cases in each layer from the bottom up, for the side-view drawing. */
  layers: number[];
  /** A full pallet (as many cases as the SKU's pallet takes). */
  isFull: boolean;
};

export function palletLayout(cases: number, c: PackConfig): PalletLayout {
  const fullLayers = Math.floor(cases / c.tie);
  const topCases = cases % c.tie;
  const layers = Array.from({ length: fullLayers }, () => c.tie);
  if (topCases > 0) layers.push(topCases);
  return { cases, tie: c.tie, fullLayers, topCases, layers, isFull: cases >= palletCapacity(c) };
}

/** A piece of step text; `b` pieces are printed in bold. */
export type Piece = string | { b: string };
export type Step = Piece[];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The numbered steps for building one pallet, written for someone on their
 * first day. Bold pieces are the numbers and labels they must get right.
 */
export function palletSteps(inhouseSku: string, layout: PalletLayout): Step[] {
  const { cases, tie, fullLayers, topCases } = layout;
  const steps: Step[] = [];
  steps.push(["Take one empty pallet to the pallet area. This pallet is for ", { b: inhouseSku }, " only. Do not put any other product on it."]);
  steps.push([
    "Go to the shelf labelled ",
    { b: inhouseSku },
    ". Bring ",
    { b: plural(cases, "case", "cases") },
    " to the pallet. Check that every case label says ",
    { b: inhouseSku },
    ".",
  ]);
  steps.push([
    "Stick one Amazon ",
    { b: "box label" },
    " on the side of each case, not on the top or on a seam. Use only the box labels printed for this pallet.",
  ]);

  if (fullLayers === 0) {
    // Fewer cases than one layer.
    steps.push([
      "Put all ",
      { b: plural(cases, "case", "cases") },
      " flat on the pallet, side by side, in the middle of the pallet. This pallet has only one layer.",
    ]);
  } else {
    steps.push([
      "Put ",
      { b: plural(tie, "case", "cases") },
      " flat on the pallet to make the first layer. Line the cases up with the edges of the pallet. Nothing should hang over the edge.",
    ]);
    if (fullLayers > 1) {
      const more = fullLayers - 1;
      steps.push([
        "Stack ",
        { b: `${more} more ${more === 1 ? "layer" : "layers"} of ${plural(tie, "case", "cases")}` },
        ` on top, one layer at a time, each layer the same as the first. You now have ${plural(fullLayers, "layer", "layers")} and ${plural(fullLayers * tie, "case", "cases")}.`,
      ]);
    }
    if (topCases > 0) {
      steps.push([
        "Put the last ",
        { b: plural(topCases, "case", "cases") },
        " on top, in the middle of the pallet.",
      ]);
    }
  }

  steps.push([
    "Count the cases on the pallet. You should have ",
    { b: String(cases) },
    ". If you do not, stop and tell your supervisor.",
  ]);
  steps.push(["Wrap the whole pallet in stretch wrap."]);
  steps.push([
    "Stick the ",
    { b: "4 Amazon pallet labels" },
    " on the outside of the wrap, one in the middle of each of the 4 sides, about halfway up.",
  ]);
  return steps;
}

/** The plain text of a step, for tests and screen readers. */
export function stepText(step: Step): string {
  return step.map((p) => (typeof p === "string" ? p : p.b)).join("");
}

export type PalletSheet = {
  /** 1-based position across the whole shipment. */
  number: number;
  /** 1-based position within this SKU's pallets. */
  skuPalletNumber: number;
  skuPalletCount: number;
  layout: PalletLayout;
};

/**
 * Numbers every pallet in a shipment: each SKU's pallets in turn, in the
 * order the lines are given.
 */
export function numberPallets<T extends PackConfig & { cases: number }>(
  lines: T[],
): { line: T; pallets: PalletSheet[] }[] {
  let n = 0;
  return lines.map((line) => {
    const split = splitIntoPallets(line.cases, line);
    return {
      line,
      pallets: split.map((cases, i) => ({
        number: ++n,
        skuPalletNumber: i + 1,
        skuPalletCount: split.length,
        layout: palletLayout(cases, line),
      })),
    };
  });
}
