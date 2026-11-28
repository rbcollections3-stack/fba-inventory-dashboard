import { describe, expect, it } from "vitest";
import {
  autoSeason,
  averageFactor,
  effectiveSeason,
  factorOn,
  monthRate,
  parseSeasonPct,
  type MonthStat,
} from "@/lib/forecast/seasonal";

const month = (m: string, units: number, over: Partial<MonthStat> = {}): MonthStat => ({
  month: m,
  units,
  dataDays: 30,
  inStockSkuDays: 60,
  skuCount: 2,
  ...over,
});

describe("seasonal pattern", () => {
  it("works out a month's daily sales with every SKU in stock", () => {
    // 2 SKUs, 30 days, but only 45 of 60 SKU-days in stock: 90 units / 45 x 2 = 4 a day.
    expect(monthRate(month("2026-01", 90, { inStockSkuDays: 45 }))).toBe(4);
    expect(monthRate(month("2026-01", 90, { dataDays: 10 }))).toBeNull();
    expect(monthRate(month("2026-01", 90, { inStockSkuDays: 20 }))).toBeNull();
  });

  it("is not ready until all 12 calendar months have usable history", () => {
    const a = autoSeason([month("2026-09", 60), month("2026-10", 60), month("2026-11", 120, { dataDays: 12 })]);
    expect(a).toEqual({ ready: false, coveredMonths: [9, 10] });
  });

  it("gives each month its share of the average month once a year is loaded", () => {
    // Every month sells 60 except November 120 and December 180.
    const stats = Array.from({ length: 12 }, (_, i) => {
      const m = `2025-${String(i + 1).padStart(2, "0")}`;
      return month(m, i === 10 ? 120 : i === 11 ? 180 : 60);
    });
    const a = autoSeason(stats);
    expect(a.ready).toBe(true);
    if (!a.ready) return;
    // Average = (10 x 60 + 120 + 180) / 12 = 75.
    expect(a.pct[0]).toBe(80);
    expect(a.pct[10]).toBe(160);
    expect(a.pct[11]).toBe(240);
  });

  it("averages a month seen in two years", () => {
    const stats = Array.from({ length: 12 }, (_, i) => month(`2025-${String(i + 1).padStart(2, "0")}`, 60));
    stats.push(month("2026-01", 180));
    const a = autoSeason(stats);
    if (!a.ready) throw new Error("expected ready");
    // January averages 60 and 180 = 120; mean = (120 + 11 x 60) / 12 = 65.
    expect(a.pct[0]).toBe(185);
  });

  it("lets typed months win, fills the rest with automatic or 100, and can be switched off", () => {
    const typed = new Map([[12, 200]]);
    expect(effectiveSeason({ enabled: true, typed }, { ready: false, coveredMonths: [] })).toEqual([
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 200,
    ]);
    const auto = { ready: true as const, pct: Array(12).fill(90), usableMonths: 12 };
    expect(effectiveSeason({ enabled: true, typed }, auto)![0]).toBe(90);
    expect(effectiveSeason({ enabled: true, typed }, auto)![11]).toBe(200);
    expect(effectiveSeason({ enabled: false, typed }, auto)).toBeNull();
    expect(effectiveSeason({ enabled: true, typed: new Map() }, { ready: false, coveredMonths: [] })).toBeNull();
  });

  it("averages the multiplier over a date range", () => {
    const pct = Array(12).fill(100);
    pct[10] = 200; // November
    expect(factorOn(pct, "2026-11-15")).toBe(2);
    // Oct 31 (1) + Nov 1 (2) = 1.5 average.
    expect(averageFactor(pct, "2026-10-31", "2026-11-01")).toBe(1.5);
  });

  it("reads typed percentages", () => {
    expect(parseSeasonPct("")).toEqual({ value: null });
    expect(parseSeasonPct("150")).toEqual({ value: 150 });
    expect(parseSeasonPct(" 80% ")).toEqual({ value: 80 });
    expect(parseSeasonPct("1.5")).toHaveProperty("error");
    expect(parseSeasonPct("5")).toHaveProperty("error");
    expect(parseSeasonPct("900")).toHaveProperty("error");
  });
});
