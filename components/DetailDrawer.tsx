"use client";

import { useState } from "react";
import type { Decision, EligibilityResult, WoundClaim } from "@/lib/types";
import { DECISION_META, dims, woundLabel } from "./decision";

const OVERRIDE_OPTIONS: { decision: Decision; label: string }[] = [
  { decision: "auto_accept", label: "Mark ready to bill" },
  { decision: "flag_for_review", label: "Flag for review" },
  { decision: "reject", label: "Reject" },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

/** Per-wound manual override controls (manual_override_requirements.md §2). */
function WoundOverrideControl({
  patientId,
  woundIndex,
  claim,
  onOverride,
}: {
  patientId: string;
  woundIndex: number;
  claim: WoundClaim;
  onOverride: (patientId: string, woundIndex: number, decision: Decision | null, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | "clear" | null>(null);

  const apply = async (decision: Decision) => {
    setBusy(decision);
    try {
      await onOverride(patientId, woundIndex, decision, note);
      setNote("");
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy("clear");
    try {
      await onOverride(patientId, woundIndex, null, "");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <div className="flex flex-wrap gap-1.5">
        {OVERRIDE_OPTIONS.map((o) => {
          const isCurrent = claim.decision === o.decision;
          return (
            <button
              key={o.decision}
              disabled={isCurrent || busy !== null}
              onClick={() => apply(o.decision)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                isCurrent
                  ? "cursor-default border border-slate-300 bg-slate-100 text-slate-400"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              }`}
            >
              {busy === o.decision ? "Saving…" : o.label}
            </button>
          );
        })}
        {claim.override && (
          <button
            disabled={busy !== null}
            onClick={clear}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "clear" ? "Clearing…" : "Revert"}
          </button>
        )}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note (why are you changing this?)"
        className="mt-1.5 w-full rounded-md border border-slate-300 px-2 py-1 text-[11px]"
      />
    </div>
  );
}

// Build a self-contained printable HTML doc and hand it to the browser's
// print dialog (Save as PDF). Avoids a PDF dependency.
function downloadPdf(row: EligibilityResult) {
  const esc = (s: unknown) =>
    String(s ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

  const wounds = row.wounds
    .map((c, i) => {
      const w = c.wound;
      const label = DECISION_META[c.decision].label;
      const fields: [string, unknown][] = [
        ["Type", woundLabel(w)],
        ["Stage", w.stage],
        ["Location", w.location],
        ["Measurements (L×W×D)", dims(w)],
        ["Drainage", w.drainage_amount],
        ["Source", w.source.replace(/_/g, " ")],
        ["Confidence", `${Math.round(w.confidence * 100)}%`],
        ["Decision", label],
      ];
      const fieldRows = fields
        .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join("");
      return `<div class="card"><h3>Wound ${i + 1}${w.is_primary ? " (primary)" : ""}</h3>
      <table>${fieldRows}</table>
      <p class="reason">${esc(c.reason)}</p>
      ${w.evidence ? `<p class="evidence">${esc(w.evidence)}</p>` : ""}</div>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <title>${esc(row.display_name)} — Patient Details</title>
  <style>
    body{font-family:system-ui,Arial,sans-serif;color:#1e293b;margin:32px;}
    h1{font-size:20px;margin:0 0 2px;} h3{font-size:14px;margin:0 0 8px;}
    .sub{color:#94a3b8;font-size:12px;margin-bottom:16px;}
    .summary{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;}
    .card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px;page-break-inside:avoid;}
    table{width:100%;border-collapse:collapse;font-size:13px;}
    td{padding:3px 0;border-bottom:1px solid #f1f5f9;}
    td.k{color:#64748b;width:45%;}
    .reason{background:#f8fafc;border-radius:6px;padding:8px;font-size:12px;color:#475569;margin-top:8px;}
    .evidence{font-style:italic;color:#94a3b8;font-size:12px;}
  </style></head><body>
  <h1>${esc(row.display_name)}</h1>
  <div class="sub">Facility ${esc(row.facility_id)} · Medicare Part B: ${row.has_active_mcb ? "active" : "none"} · ${esc(DECISION_META[row.decision].label)}</div>
  <div class="summary">${esc(row.reason)}</div>
  <h3>${row.wounds.length > 1 ? `Wound claims (${row.wounds.length})` : "Wound claim"}</h3>
  ${wounds || '<p class="sub">No wound extracted.</p>'}
</body></html>`;

  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.onload = () => {
    w.print();
  };
  // Fallback if onload already fired
  setTimeout(() => w.print(), 400);
}

function WoundClaimCard({
  patientId,
  woundIndex,
  claim,
  total,
  onOverride,
}: {
  patientId: string;
  woundIndex: number;
  claim: WoundClaim;
  total: number;
  onOverride: (patientId: string, woundIndex: number, decision: Decision | null, note: string) => Promise<void>;
}) {
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
          {claim.override && <span className="ml-1 text-[10px] opacity-70">(overridden)</span>}
        </span>
      </div>
      <Row label="Stage" value={w.stage ?? "—"} />
      <Row label="Location" value={w.location ?? "—"} />
      <Row label="Measurements (L×W×D)" value={dims(w)} />
      <Row label="Drainage" value={w.drainage_amount ?? "—"} />
      <Row label="Source" value={w.source.replace(/_/g, " ")} />
      <Row label="Confidence" value={`${Math.round(w.confidence * 100)}%`} />
      <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">{claim.reason}</div>
      {claim.override && claim.system_reason && (
        <div className="mt-1 text-xs text-slate-400">System: {claim.system_reason}</div>
      )}
      {w.evidence && <div className="mt-1 text-xs italic text-slate-400">{w.evidence}</div>}
      <WoundOverrideControl patientId={patientId} woundIndex={woundIndex} claim={claim} onOverride={onOverride} />
    </div>
  );
}

export default function DetailDrawer({
  row,
  onClose,
  onOverride,
}: {
  row: EligibilityResult | null;
  onClose: () => void;
  onOverride: (patientId: string, woundIndex: number, decision: Decision | null, note: string) => Promise<void>;
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadPdf(row)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M10 2a1 1 0 0 1 1 1v7.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L9 10.586V3a1 1 0 0 1 1-1Zm-6 13a1 1 0 0 1 1 1h10a1 1 0 1 1 0 2H5a2 2 0 0 1-2-2 1 1 0 0 1 1-1Z" />
              </svg>
              Download PDF
            </button>
            <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
              ✕
            </button>
          </div>
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
          {row.multiple_wounds && (
            <div className="mt-1 text-xs text-slate-400">
              Reflects the primary wound below. Each wound has its own override.
            </div>
          )}

          <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {row.wounds.length > 1 ? `Wound claims (${row.wounds.length})` : "Wound claim"}
          </h3>
          {row.wounds.length > 0 ? (
            <div className="space-y-3">
              {row.wounds.map((c, i) => (
                <WoundClaimCard
                  key={i}
                  patientId={row.patient_id}
                  woundIndex={i}
                  claim={c}
                  total={row.wounds.length}
                  onOverride={onOverride}
                />
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
