"use client";

export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-outline" onClick={() => window.print()}>
      <i className="fas fa-print" aria-hidden="true" /> {label}
    </button>
  );
}
