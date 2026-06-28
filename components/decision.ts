// Shared decision presentation — keeps colors/labels consistent across the
// table, cards, and drawer. Biller mental model: Ready / Needs Review / Reject.

import type { Decision, ExtractedWound } from "@/lib/types";

export const DECISION_META: Record<
  Decision,
  { label: string; badge: string; dot: string; row: string }
> = {
  auto_accept: {
    label: "Ready to bill",
    badge: "bg-green-100 text-green-800 border border-green-300",
    dot: "bg-green-500",
    row: "border-l-4 border-l-green-400",
  },
  flag_for_review: {
    label: "Needs review",
    badge: "bg-amber-100 text-amber-800 border border-amber-300",
    dot: "bg-amber-500",
    row: "border-l-4 border-l-amber-400",
  },
  reject: {
    label: "Reject",
    badge: "bg-rose-100 text-rose-700 border border-rose-300",
    dot: "bg-rose-500",
    row: "border-l-4 border-l-rose-300",
  },
};

export function dims(w: ExtractedWound | null): string {
  if (!w) return "—";
  const v = (n: number | null) => (n == null ? "·" : n);
  return `${v(w.length_cm)} × ${v(w.width_cm)} × ${v(w.depth_cm)} cm`;
}

export function woundLabel(w: ExtractedWound | null): string {
  if (!w) return "—";
  return (w.wound_type ?? "unknown").replace(/_/g, " ");
}
