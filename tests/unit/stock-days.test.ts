import { describe, expect, it } from "vitest";
import { countBetween, eachDay, outOfStockDays, type DayFlow } from "@/lib/forecast/stock-days";

const flows = (entries: [string, number, number][]) =>
  new Map<string, DayFlow>(entries.map(([d, sold, net]) => [d, { sold, sellableNet: net }]));

describe("out-of-stock days", () => {
  it("lists every day between two dates", () => {
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("works the stock level back from the latest stock report", () => {
    // Sold 2 a day Oct 1-3 and ran out; restocked with 50 on Oct 8; sold 1 a day after.
    const f = flows([
      ["2026-10-01", 2, -2],
      ["2026-10-02", 2, -2],
      ["2026-10-03", 2, -2],
      ["2026-10-08", 0, 50],
      ["2026-10-09", 1, -1],
      ["2026-10-10", 1, -1],
    ]);
    // On Oct 11 Amazon held 48.
    const oos = outOfStockDays({ flows: f, firstDay: "2026-10-01", lastDay: "2026-10-10", anchor: { day: "2026-10-11", sellable: 48 } });
    // The delivery day itself had nothing to sell at the start and no sales, so it counts too.
    expect([...oos].sort()).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(countBetween(oos, "2026-10-05", "2026-10-10")).toBe(4);
  });

  it("never marks a day with a sale as out of stock, and lifts a worked-out level that sales prove too low", () => {
    // The ledger is 5 units off: worked back, the level would go negative on Oct 2,
    // but Oct 1 and Oct 3 had sales, so the zero-sales day in between is in stock.
    const f = flows([
      ["2026-10-01", 1, -1],
      ["2026-10-02", 0, 0],
      ["2026-10-03", 1, -6],
    ]);
    const oos = outOfStockDays({ flows: f, firstDay: "2026-10-01", lastDay: "2026-10-03", anchor: { day: "2026-10-04", sellable: 0 } });
    expect(oos.has("2026-10-01")).toBe(false);
    expect(oos.has("2026-10-03")).toBe(false);
    expect(oos.has("2026-10-02")).toBe(false);
  });

  it("marks every day out of stock for a SKU with nothing in Amazon and no activity", () => {
    const oos = outOfStockDays({ flows: new Map(), firstDay: "2026-10-01", lastDay: "2026-10-30", anchor: { day: "2026-11-01", sellable: 0 } });
    expect(oos.size).toBe(30);
  });

  it("without any stock report only uses days a report showed zero", () => {
    const oos = outOfStockDays({
      flows: new Map(),
      firstDay: "2026-10-01",
      lastDay: "2026-10-05",
      anchor: null,
      zeroStockDays: new Set(["2026-10-03"]),
    });
    expect([...oos]).toEqual(["2026-10-03"]);
  });

  it("works forward for ledger days after the stock report", () => {
    const f = flows([
      ["2026-10-02", 3, -3],
      ["2026-10-03", 0, 0],
    ]);
    const oos = outOfStockDays({ flows: f, firstDay: "2026-10-01", lastDay: "2026-10-03", anchor: { day: "2026-10-01", sellable: 3 } });
    expect([...oos]).toEqual(["2026-10-03"]);
  });

  it("does not let a sale on a delivery day hide the stock-out before it", () => {
    // Out of stock Oct 2-3; 50 arrive on Oct 4 and 2 sell that day. Amazon holds 48 on Oct 5.
    const f = flows([
      ["2026-10-01", 1, -1],
      ["2026-10-04", 2, 48],
    ]);
    const oos = outOfStockDays({ flows: f, firstDay: "2026-10-01", lastDay: "2026-10-04", anchor: { day: "2026-10-05", sellable: 48 } });
    expect([...oos].sort()).toEqual(["2026-10-02", "2026-10-03"]);
  });
});
