import { describe, expect, it } from "vitest";
import {
  arrivalRisk,
  casesStillToCome,
  defaultExpectedOn,
  readArrivedForm,
  readOrderDetails,
  readOrderLines,
  unitsStillToCome,
} from "@/lib/china/rules";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
};

describe("defaultExpectedOn", () => {
  it("is 60 days after the order date", () => {
    expect(defaultExpectedOn("2026-11-28")).toBe("2027-01-27");
    expect(defaultExpectedOn("2026-01-01")).toBe("2026-03-02");
  });
});

describe("still to come", () => {
  it("counts what has not arrived and never goes below zero", () => {
    expect(casesStillToCome({ cases: 50, casesReceived: 0 })).toBe(50);
    expect(casesStillToCome({ cases: 50, casesReceived: 48 })).toBe(2);
    expect(casesStillToCome({ cases: 50, casesReceived: 53 })).toBe(0);
    expect(unitsStillToCome({ cases: 50, casesReceived: 20, unitsPerCase: 8 })).toBe(240);
  });
});

describe("arrivalRisk", () => {
  it("is fine when the order can sell at Amazon before stock runs out", () => {
    // 900 units at 10 a day lasts 90 days: Mar 1. Order lands Jan 27, selling from Feb 3.
    const r = arrivalRisk({ stockDay: "2026-12-01", unitsOnHand: 900, dailyRate: 10, expectedOn: "2027-01-27" });
    expect(r.runsOutOn).toBe("2027-03-01");
    expect(r.sellingFrom).toBe("2027-02-03");
    expect(r.gapDays).toBe(0);
  });

  it("counts the days without stock when the order is late", () => {
    // 300 units at 10 a day lasts 30 days: Dec 31. Selling from Feb 3: 34 days short.
    const r = arrivalRisk({ stockDay: "2026-12-01", unitsOnHand: 300, dailyRate: 10, expectedOn: "2027-01-27" });
    expect(r.runsOutOn).toBe("2026-12-31");
    expect(r.gapDays).toBe(34);
  });
});

describe("readOrderLines", () => {
  it("reads only ticked SKUs and flags bad case numbers", () => {
    const { lines, issues } = readOrderLines(
      form({ "include-1": "on", "cases-1": "1,200", "cases-2": "9", "include-3": "on", "cases-3": "0", "include-4": "on", "cases-4": "99999" }),
      [1, 2, 3, 4],
    );
    expect(lines).toEqual([{ skuId: 1, cases: 1200 }]);
    expect(issues.map((i) => i.skuId)).toEqual([3, 4]);
  });
});

describe("readOrderDetails", () => {
  const today = "2026-11-28";

  it("defaults the order date to today and arrival to 60 days later", () => {
    const { details, issues } = readOrderDetails(form({ supplier: "  Ningbo Textiles ", poNumber: "", note: "" }), today);
    expect(issues).toEqual([]);
    expect(details).toEqual({ supplier: "Ningbo Textiles", poNumber: null, orderedOn: today, expectedOn: "2027-01-27", note: null });
  });

  it("accepts an order placed earlier, for orders already on the way", () => {
    const { details } = readOrderDetails(form({ orderedOn: "2026-10-15", expectedOn: "" }), today);
    expect(details).toMatchObject({ orderedOn: "2026-10-15", expectedOn: "2026-12-14" });
  });

  it("keeps an arrival date the supplier gave", () => {
    const { details } = readOrderDetails(form({ orderedOn: "2026-11-20", expectedOn: "2027-02-10" }), today);
    expect(details?.expectedOn).toBe("2027-02-10");
  });

  it("refuses future order dates, arrivals before the order, and made-up days", () => {
    expect(readOrderDetails(form({ orderedOn: "2026-12-01" }), today).issues[0].field).toBe("orderedOn");
    expect(readOrderDetails(form({ orderedOn: "2026-11-20", expectedOn: "2026-11-01" }), today).issues[0].field).toBe("expectedOn");
    expect(readOrderDetails(form({ orderedOn: "2026-02-30" }), today).issues[0].field).toBe("orderedOn");
    expect(readOrderDetails(form({ orderedOn: "2026-11-20", expectedOn: "2028-01-01" }), today).issues[0].field).toBe("expectedOn");
    expect(readOrderDetails(form({ orderedOn: "2025-01-01" }), today).details).toBeNull();
  });
});

describe("readArrivedForm", () => {
  it("needs a number for every SKU, 0 allowed", () => {
    const { entries, issues } = readArrivedForm(form({ "arrived-1": "40", "arrived-2": "0", "arrived-3": "", "arrived-4": "abc" }), [1, 2, 3, 4]);
    expect(entries).toEqual([
      { skuId: 1, cases: 40 },
      { skuId: 2, cases: 0 },
    ]);
    expect(issues.map((i) => i.skuId)).toEqual([3, 4]);
  });
});
