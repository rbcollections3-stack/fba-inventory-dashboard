import { describe, expect, it } from "vitest";
import {
  addDays,
  casesFor,
  compareUrgency,
  forecastSku,
  nextActionDate,
  reorderPointDays,
  shipPointDays,
  type ForecastInput,
} from "@/lib/forecast/rules";

/** The worked example from the build plan. */
const example: ForecastInput = {
  unitsPerCase: 24,
  unitsSold: 300,
  salesDays: 30,
  manualDailySales: null,
  fba: { available: 400, inbound: 200 },
  stockDay: "2026-11-27",
  warehouse: 900,
  onOrder: 0,
  today: "2026-11-27",
};

const run = (over: Partial<ForecastInput>) => forecastSku({ ...example, ...over });

describe("rule constants", () => {
  it("ships at 45 + 7 = 52 days and reorders at 52 + 60 + 14 = 126 days", () => {
    expect(shipPointDays()).toBe(52);
    expect(reorderPointDays()).toBe(126);
  });
});

describe("the plan's worked example", () => {
  const f = forecastSku(example);
  it("sells 10 a day", () => {
    expect(f.dailyRate).toBe(10);
    expect(f.rateSource).toBe("sales");
    expect(f.lowConfidence).toBe(false);
  });
  it("has 60 days of FBA cover and ships by Dec 5", () => {
    expect(f.fbaCoverDays).toBe(60);
    expect(f.shipBy).toBe("2026-12-05");
  });
  it("ships 19 cases (456 units)", () => {
    expect(f.shipCases).toBe(19);
    expect(f.shipUnits).toBe(456);
    expect(f.warehouseShort).toBe(false);
  });
  it("has 150 days of total cover and reorders by Dec 21", () => {
    expect(f.totalCoverDays).toBe(150);
    expect(f.reorderBy).toBe("2026-12-21");
  });
  it("reorders 50 cases (1,200 units)", () => {
    expect(f.reorderCases).toBe(50);
    expect(f.reorderUnits).toBe(1200);
  });
  it("is green: ship is 8 days away, reorder 24 days away", () => {
    expect(f.shipStatus).toBe("green");
    expect(f.reorderStatus).toBe("green");
    expect(f.status).toBe("green");
  });
});

describe("colours", () => {
  it("is yellow when the ship-by date is 7 days away", () => {
    const f = run({ today: "2026-11-28" });
    expect(f.shipStatus).toBe("yellow");
    expect(f.status).toBe("yellow");
    expect(f.notes[0]).toBe("Ship to Amazon within 7 days.");
  });
  it("is red when the ship-by date is today", () => {
    expect(run({ today: "2026-12-05" }).shipStatus).toBe("red");
  });
  it("is red and overdue when the ship-by date has passed", () => {
    const f = run({ fba: { available: 300, inbound: 0 } }); // 30 days, 22 days late
    expect(f.shipBy).toBe("2026-11-05");
    expect(f.shipStatus).toBe("red");
    expect(f.notes[0]).toBe("Shipment to Amazon is overdue.");
  });
  it("is yellow for reorder 14 days out, green 15 days out", () => {
    // total 1,400 units = 140 days, reorder-by = 14 days after Nov 27.
    expect(run({ warehouse: 800, fba: { available: 600, inbound: 0 } }).reorderStatus).toBe("yellow");
    expect(run({ warehouse: 810, fba: { available: 600, inbound: 0 } }).reorderStatus).toBe("green");
  });
  it("is red for reorder when total cover is already below 126 days", () => {
    const f = run({ warehouse: 500 }); // 1,100 units = 110 days
    expect(f.reorderBy).toBe("2026-11-11");
    expect(f.reorderStatus).toBe("red");
    expect(f.status).toBe("red");
  });
});

describe("rounding", () => {
  it("rounds days of cover down so a date is never late", () => {
    // 595 / 10 = 59.5 days of cover -> 7 days, not 8.
    expect(run({ fba: { available: 395, inbound: 200 } }).shipBy).toBe("2026-12-04");
  });
  it("rounds shipments up to full cases", () => {
    expect(casesFor(45, 10, 24)).toBe(19);
    expect(casesFor(45, 8, 6)).toBe(60); // exactly 360 units
    expect(casesFor(45, 8.1, 6)).toBe(61);
  });
  it("counts days from the day the FBA stock is from, not today", () => {
    const f = run({ stockDay: "2026-11-25", today: "2026-11-27" });
    expect(f.shipBy).toBe("2026-12-03");
  });
});

describe("units already on the way", () => {
  it("counts inbound units toward FBA cover", () => {
    const without = run({ fba: { available: 400, inbound: 0 } });
    expect(without.fbaCoverDays).toBe(40);
    expect(run({}).fbaCoverDays).toBe(60);
  });
  it("counts China orders toward total cover", () => {
    expect(run({ onOrder: 1200 }).reorderBy).toBe(addDays("2026-12-21", 120));
  });
});

describe("warehouse short", () => {
  it("ships what is there and flags reorder red when a shipment is due", () => {
    const f = run({ today: "2026-12-01", warehouse: 100 }); // 4 full cases of 24
    expect(f.warehouseShort).toBe(true);
    expect(f.shipCasesAvailable).toBe(4);
    expect(f.reorderStatus).toBe("red");
    expect(f.notes).toContain("Warehouse is short: ship the 4 cases there are (needs 19).");
  });
  it("says so when the warehouse has no full case", () => {
    const f = run({ today: "2026-12-05", warehouse: 0 });
    expect(f.shipCasesAvailable).toBe(0);
    expect(f.notes).toContain("Warehouse has no full cases for the next shipment (needs 19).");
  });
});

describe("warehouse not counted", () => {
  const f = run({ warehouse: null });
  it("still gives a ship-by date", () => {
    expect(f.shipBy).toBe("2026-12-05");
    expect(f.shipStatus).toBe("green");
  });
  it("gives a reorder-by date that treats the warehouse as empty, without colouring it", () => {
    expect(f.reorderBy).toBe(addDays("2026-11-27", 60 - 126));
    expect(f.reorderAssumesEmptyWarehouse).toBe(true);
    expect(f.reorderStatus).toBe("none");
    expect(f.status).toBe("green");
    expect(f.notes.some((n) => n.startsWith("Warehouse not counted yet"))).toBe(true);
  });
  it("leaves the uncounted reorder date out of urgency sorting", () => {
    expect(nextActionDate(f)).toBe("2026-12-05");
  });
});

describe("no recent sales and the manual override", () => {
  it("shows no dates and a note when nothing sold", () => {
    const f = run({ unitsSold: 0 });
    expect(f.dailyRate).toBeNull();
    expect(f.shipBy).toBeNull();
    expect(f.reorderBy).toBeNull();
    expect(f.status).toBe("none");
    expect(f.notes[0]).toBe("No sales in the last 30 days, so no dates. Enter expected daily sales to plan this SKU.");
  });
  it("plans from an expected daily sales number typed in by hand", () => {
    const f = run({ unitsSold: 0, manualDailySales: 10 });
    expect(f.rateSource).toBe("manual");
    expect(f.shipBy).toBe("2026-12-05");
    expect(f.reorderBy).toBe("2026-12-21");
    expect(f.notes).toContain("Planned from expected daily sales you entered.");
  });
  it("uses the typed number even once sales return, and shows the real rate next to it", () => {
    const f = run({ unitsSold: 150, manualDailySales: 10 });
    expect(f.dailyRate).toBe(10);
    expect(f.measuredRate).toBe(5);
  });
  it("says no sales are loaded when no ledger has been loaded at all", () => {
    expect(run({ unitsSold: null, salesDays: 0 }).notes[0]).toBe("No Amazon sales loaded yet, so no dates.");
  });
});

describe("short sales history", () => {
  it("uses the days it has and marks the forecast low confidence", () => {
    const f = run({ unitsSold: 100, salesDays: 10 });
    expect(f.dailyRate).toBe(10);
    expect(f.lowConfidence).toBe(true);
    expect(f.shipBy).toBe("2026-12-05");
  });
});

describe("no FBA stock loaded", () => {
  it("shows no dates and a note", () => {
    const f = run({ fba: null, stockDay: null });
    expect(f.dailyRate).toBe(10);
    expect(f.shipBy).toBeNull();
    expect(f.notes[0]).toBe("No FBA stock loaded yet, so no dates.");
  });
});

describe("most urgent first", () => {
  it("sorts red, then yellow, then green, then no dates", () => {
    const red = run({ fba: { available: 300, inbound: 0 } });
    const yellow = run({ today: "2026-11-28" });
    const green = run({});
    const none = run({ unitsSold: 0 });
    const sorted = [none, green, yellow, red].sort(compareUrgency);
    expect(sorted).toEqual([red, yellow, green, none]);
  });
  it("sorts the earlier date first within a colour", () => {
    const a = run({ fba: { available: 500, inbound: 200 } });
    const b = run({});
    expect([a, b].sort(compareUrgency)).toEqual([b, a]);
  });
});
