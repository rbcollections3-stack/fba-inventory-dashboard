/** Reads the expected-daily-sales box. Blank clears it. */
export function parseManualRate(text: string): { value: number | null } | { error: string } {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return { value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Enter units per day as a number, for example 4 or 2.5, or leave it blank." };
  const v = Number(t);
  if (v <= 0) return { error: "Enter a number above 0, or leave it blank to plan from real sales." };
  if (v > 100000) return { error: "That is more than 100,000 units a day. Please check the number." };
  return { value: v };
}
