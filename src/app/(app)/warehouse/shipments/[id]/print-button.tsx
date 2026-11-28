"use client";

export function PrintButton({ label = "Print pallet sheets" }: { label?: string }) {
  return (
    <button type="button" className="primary" onClick={() => window.print()}>
      {label}
    </button>
  );
}
