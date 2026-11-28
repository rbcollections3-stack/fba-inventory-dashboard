import { describe, expect, it } from "vitest";
import { barcodeSvg, barcodeSymbol, labelTitle, readLabelCount } from "@/lib/labels/fnsku";
import { cleanFnsku } from "@/lib/amazon/parse";

describe("FNSKU labels", () => {
  it("draws a barcode as SVG", () => {
    const svg = barcodeSvg("X001ABC123");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    const sym = barcodeSymbol("X001ABC123");
    expect(sym.viewBox).toMatch(/^0 0 \d+ \d+$/);
    expect(sym.inner).toContain("<path");
    expect(sym.inner).not.toContain("<svg");
  });

  it("keeps short titles and shortens long ones in the middle", () => {
    expect(labelTitle("Single Bamboo Pillow (Queen Size)")).toBe("Single Bamboo Pillow (Queen Size)");
    const long = labelTitle("DreamField Linen Memory Foam Bamboo Pillow for Sleeping, Cooling, Adjustable Loft (King Size)");
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.startsWith("DreamField Linen")).toBe(true);
    expect(long.endsWith("(King Size)")).toBe(true);
  });

  it("accepts sensible label counts only", () => {
    expect(readLabelCount("24")).toBe(24);
    expect(readLabelCount("1,200")).toBe(1200);
    expect(readLabelCount("0")).toBeNull();
    expect(readLabelCount("2.5")).toBeNull();
    expect(readLabelCount("99999")).toBeNull();
  });

  it("reads FNSKUs from reports, ignoring blanks and junk", () => {
    expect(cleanFnsku(" x001abc123 ")).toBe("X001ABC123");
    expect(cleanFnsku("B0CS7PHGXG")).toBe("B0CS7PHGXG");
    expect(cleanFnsku("")).toBeNull();
    expect(cleanFnsku("X00-1")).toBeNull();
  });
});
