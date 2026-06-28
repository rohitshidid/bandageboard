"use client";

import type { EligibilityResult, WoundClaim } from "@/lib/types";
import { DECISION_META, dims, woundLabel } from "./decision";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

function WoundClaimCard({ claim, index, total }: { claim: WoundClaim; index: number; total: number }) {
  const meta = DECISION_META[claim.decision];
  const w = claim.wound;
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-3 ${meta.row}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold capitalize text-slate-800">
          {woundLabel(w)}
          {w.is_primary && total > 1 && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">primary</span>
          )}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>
      <Row label="Stage" value={w.stage ?? "—"} />
      <Row label="Location" value={w.location ?? "—"} />
      <Row label="Measurements (L×W×D)" value={dims(w)} />
      <Row label="Drainage" value={w.drainage_amount ?? "—"} />
      <Row label="Source" value={w.source.replace(/_/g, " ")} />
      <Row label="Confidence" value={`${Math.round(w.confidence * 100)}%`} />
      <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">{claim.reason}</div>
      {w.evidence && <div className="mt-1 text-xs italic text-slate-400">{w.evidence}</div>}
    </div>
  );
}

export default function DetailDrawer({
  row,
  onClose,
}: {
  row: EligibilityResult | null;
  onClose: () => void;
}) {
  if (!row) return null;
  const meta = DECISION_META[row.decision];

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 p-5">
          <div>
            <div className="text-lg font-semibold text-slate-900">{row.display_name}</div>
            <div className="text-xs text-slate-400">
              Facility {row.facility_id}
              {row.multiple_wounds && ` · ${row.wounds.length} wounds`}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${meta.badge}`}>
              <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            <span className="text-xs text-slate-500">
              Medicare Part B: <span className={row.has_active_mcb ? "text-green-600" : "text-slate-400"}>{row.has_active_mcb ? "active" : "none"}</span>
            </span>
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{row.reason}</div>

          <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {row.wounds.length > 1 ? `Wound claims (${row.wounds.length})` : "Wound claim"}
          </h3>
          {row.wounds.length > 0 ? (
            <div className="space-y-3">
              {row.wounds.map((c, i) => (
                <WoundClaimCard key={i} claim={c} index={i} total={row.wounds.length} />
              ))}
            </div>
          ) : (
            <div className="py-3 text-sm text-slate-400">No wound extracted.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
