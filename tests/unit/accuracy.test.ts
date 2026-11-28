import { describe, expect, it } from "vitest";
import { combine, mondayOf, summarise, weeklyResults, workedOutRates, type AccuracyInput } from "@/lib/forecast/accuracy";
import { eachDay } from "@/lib/forecast/stock-days";

/** Sells `perDay` every day in the range. */
function steady(from: string, to: string, perDay: number): Map<string, number> {
  return new Map(eachDay(from, to).map((d) => [d, perDay]));
}

const base = (over: Partial<AccuracyInput> = {}): AccuracyInput => ({
  sold: steady("2026-10-01", "2026-11-29", 2),
  outOfStock: new Set(),
  firstDay: "2026-10-01",
  lastDay: "2026-11-29",
  recorded: new Map(),
  monthPct: null,
  ...over,
});

describe("forecast vs actual", () => {
  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
  });

  it("needs two weeks of history before a week to work out its forecast", () => {
    expect(workedOutRates(base(), "2026-10-12")).toBeNull(); // 11 days before
    expect(workedOutRates(base(), "2026-10-19")![0]).toBe(2);
  });

  it("matches perfectly for a steady seller, using full weeks only", () => {
    const weeks = weeklyResults(base());
    expect(weeks[0].weekStart).toBe("2026-10-19");
    expect(weeks.at(-1)!.weekStart).toBe("2026-11-23");
    expect(weeks.every((w) => w.forecast === 14 && w.actual === 14 && w.source === "worked_out")).toBe(true);
    const s = summarise(weeks);
    expect(s).toMatchObject({ weeks: 4, forecast: 56, actual: 56, errorShare: 0, verdict: "good" });
  });

  it("uses the forecast recorded on the Monday when there is one", () => {
    const recorded = new Map([["2026-11-23", { plannedRate: 3 }]]);
    const weeks = weeklyResults(base({ recorded }));
    const last = weeks.at(-1)!;
    expect(last).toMatchObject({ forecast: 21, actual: 14, source: "recorded" });
  });

  it("leaves out out-of-stock days on both sides", () => {
    const sold = steady("2026-10-01", "2026-11-29", 2);
    const outOfStock = new Set(["2026-11-27", "2026-11-28", "2026-11-29"]);
    for (const d of outOfStock) sold.delete(d);
    const last = weeklyResults(base({ sold, outOfStock })).at(-1)!;
    expect(last).toMatchObject({ forecast: 8, actual: 8, inStockDays: 4 });
  });

  it("measures misses week by week and the overall direction", () => {
    const weeks = [
      { weekStart: "2026-11-02", forecast: 10, actual: 20, inStockDays: 7, source: "recorded" as const },
      { weekStart: "2026-11-09", forecast: 30, actual: 20, inStockDays: 7, source: "recorded" as const },
    ];
    const s = summarise(weeks);
    expect(s.errorShare).toBe(0.5); // 20 missed out of 40
    expect(s.biasShare).toBe(0); // too low then too high: no overall lean
    expect(s.verdict).toBe("poor");
    const both = combine([s, summarise([{ ...weeks[0], forecast: 20 }])]);
    expect(both).toMatchObject({ forecast: 60, actual: 60, miss: 20 });
  });

  it("calls too few sales too few to judge", () => {
    const s = summarise([{ weekStart: "2026-11-02", forecast: 1, actual: 2, inStockDays: 7, source: "recorded" }]);
    expect(s.verdict).toBe("too_few");
  });

  it("applies the seasonal pattern to worked-out forecasts", () => {
    const monthPct = Array(12).fill(100);
    monthPct[10] = 200; // November sells double
    // October sold 2 a day = normal month, so November days are planned at 4.
    const rates = workedOutRates(base({ monthPct }), "2026-11-01")!;
    expect(rates[0]).toBeCloseTo(4);
  });
});
