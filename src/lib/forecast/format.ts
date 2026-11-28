import type { Status } from "./rules";

export function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function fmtRate(v: number | null): string {
  if (v === null) return "-";
  return v.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: v < 10 ? 1 : 0 });
}

export function fmtDays(v: number | null): string {
  if (v === null) return "-";
  return Math.floor(v + 1e-9).toLocaleString("en-US");
}

export function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined ? "-" : v.toLocaleString("en-US");
}

export const STATUS_LABEL: Record<Status, string> = {
  red: "Act now",
  yellow: "Soon",
  green: "OK",
  none: "No dates",
};
