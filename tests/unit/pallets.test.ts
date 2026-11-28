import { describe, expect, it } from "vitest";
import { numberPallets, palletCapacity, palletLayout, palletSteps, splitIntoPallets, stepText } from "@/lib/shipments/pallets";

const pillow = { tie: 7, high: 5, maxCasesPerPallet: 35 };
const queen = { tie: 4, high: 6, maxCasesPerPallet: 24 };
const plan = { tie: 6, high: 4, maxCasesPerPallet: 24 }; // the build plan's worked example

describe("pallet capacity", () => {
  it("is tie x high", () => {
    expect(palletCapacity(pillow)).toBe(35);
    expect(palletCapacity(queen)).toBe(24);
  });
  it("never goes over the max cases per pallet", () => {
    expect(palletCapacity({ tie: 7, high: 5, maxCasesPerPallet: 30 })).toBe(30);
  });
  it("never stacks more layers than the high, even if the max is bigger", () => {
    expect(palletCapacity({ tie: 4, high: 6, maxCasesPerPallet: 40 })).toBe(24);
  });
});

describe("splitting a shipment into pallets", () => {
  it("fills full pallets first and puts the leftover on the last pallet", () => {
    expect(splitIntoPallets(80, pillow)).toEqual([35, 35, 10]);
    expect(splitIntoPallets(48, queen)).toEqual([24, 24]);
  });
  it("uses one pallet when the cases fit", () => {
    expect(splitIntoPallets(19, plan)).toEqual([19]);
    expect(splitIntoPallets(1, pillow)).toEqual([1]);
  });
  it("gives no pallets for zero or invalid cases", () => {
    expect(splitIntoPallets(0, pillow)).toEqual([]);
    expect(splitIntoPallets(-3, pillow)).toEqual([]);
    expect(splitIntoPallets(2.5, pillow)).toEqual([]);
  });
});

describe("pallet layout", () => {
  it("matches the build plan example: 19 cases, tie 6 = 3 layers + 1 on top", () => {
    const l = palletLayout(19, plan);
    expect(l.fullLayers).toBe(3);
    expect(l.topCases).toBe(1);
    expect(l.layers).toEqual([6, 6, 6, 1]);
    expect(l.isFull).toBe(false);
  });
  it("a full pallet has high layers and no partial layer", () => {
    const l = palletLayout(35, pillow);
    expect(l).toMatchObject({ fullLayers: 5, topCases: 0, isFull: true });
  });
  it("fewer cases than one layer is one partial layer", () => {
    expect(palletLayout(3, pillow)).toMatchObject({ fullLayers: 0, topCases: 3, layers: [3] });
  });
});

describe("pallet build steps", () => {
  const text = (cases: number, cfg = plan) => palletSteps("7004", palletLayout(cases, cfg)).map(stepText);

  it("reads like the build plan's example sheet", () => {
    const steps = text(19);
    expect(steps).toEqual([
      "Take one empty pallet to the pallet area. This pallet is for 7004 only. Do not put any other product on it.",
      "Go to the shelf labelled 7004. Bring 19 cases to the pallet. Check that every case label says 7004.",
      "Stick one Amazon box label on the side of each case, not on the top or on a seam. Use only the box labels printed for this pallet.",
      "Put 6 cases flat on the pallet to make the first layer. Line the cases up with the edges of the pallet. Nothing should hang over the edge.",
      "Stack 2 more layers of 6 cases on top, one layer at a time, each layer the same as the first. You now have 3 layers and 18 cases.",
      "Put the last 1 case on top, in the middle of the pallet.",
      "Count the cases on the pallet. You should have 19. If you do not, stop and tell your supervisor.",
      "Wrap the whole pallet in stretch wrap.",
      "Stick the 4 Amazon pallet labels on the outside of the wrap, one in the middle of each of the 4 sides, about halfway up.",
    ]);
  });

  it("skips the partial layer step on a full pallet", () => {
    const steps = text(35, pillow);
    expect(steps.some((s) => s.startsWith("Put the last"))).toBe(false);
    expect(steps).toContain(
      "Stack 4 more layers of 7 cases on top, one layer at a time, each layer the same as the first. You now have 5 layers and 35 cases.",
    );
  });

  it("says 1 more layer (singular) for two layers", () => {
    expect(text(12)).toContain(
      "Stack 1 more layer of 6 cases on top, one layer at a time, each layer the same as the first. You now have 2 layers and 12 cases.",
    );
  });

  it("has no stacking step for a single full layer", () => {
    const steps = text(6);
    expect(steps.some((s) => s.startsWith("Stack"))).toBe(false);
    expect(steps.some((s) => s.startsWith("Put the last"))).toBe(false);
  });

  it("handles a pallet smaller than one layer", () => {
    expect(text(1)).toContain("Put all 1 case flat on the pallet, side by side, in the middle of the pallet. This pallet has only one layer.");
  });

  it("puts the numbers and the in-house SKU in bold", () => {
    const step = palletSteps("7004", palletLayout(19, plan))[1];
    expect(step.filter((p) => typeof p !== "string")).toEqual([{ b: "7004" }, { b: "19 cases" }, { b: "7004" }]);
  });
});

describe("numbering pallets across a shipment", () => {
  it("numbers every SKU's pallets in turn", () => {
    const out = numberPallets([
      { ...pillow, cases: 40 },
      { ...queen, cases: 10 },
    ]);
    expect(out.map((o) => o.pallets.map((p) => [p.number, p.skuPalletNumber, p.skuPalletCount, p.layout.cases]))).toEqual([
      [
        [1, 1, 2, 35],
        [2, 2, 2, 5],
      ],
      [[3, 1, 1, 10]],
    ]);
  });
});
