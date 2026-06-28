import type { EligibilityResult } from "@/lib/types";

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}

export default function SummaryCards({ rows }: { rows: EligibilityResult[] }) {
  const total = rows.length;
  const auto = rows.filter((r) => r.decision === "auto_accept").length;
  const flag = rows.filter((r) => r.decision === "flag_for_review").length;
  const reject = rows.filter((r) => r.decision === "reject").length;

  const payers = new Map<string, number>();
  for (const r of rows) {
    const k = r.has_active_mcb ? "Active MCB" : "Not MCB";
    payers.set(k, (payers.get(k) ?? 0) + 1);
  }

  const cards = [
    { label: "Total patients", value: total, sub: `${pct(auto, total)} ready to bill`, tone: "text-slate-900" },
    { label: "Ready to bill", value: auto, sub: "all fields documented", tone: "text-green-700" },
    { label: "Needs review", value: flag, sub: "ambiguous / incomplete", tone: "text-amber-700" },
    { label: "Reject", value: reject, sub: "ineligible / no wound", tone: "text-rose-700" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</div>
          <div className={`mt-1 text-3xl font-semibold ${c.tone}`}>{c.value}</div>
          <div className="mt-1 text-xs text-slate-400">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
