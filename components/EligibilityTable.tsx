"use client";

import type { EligibilityResult } from "@/lib/types";
import { DECISION_META, dims, woundLabel } from "./decision";

export type SortKey = "patient" | "facility" | "decision";

function Header({
  label,
  k,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  k?: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = k && sort.key === k;
  return (
    <th
      className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${k ? "cursor-pointer select-none hover:text-slate-800" : ""} ${className}`}
      onClick={k ? () => onSort(k) : undefined}
    >
      {label}
      {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
}

export default function EligibilityTable({
  rows,
  sort,
  onSort,
  onSelect,
}: {
  rows: EligibilityResult[];
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  onSelect: (r: EligibilityResult) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
        No patients match these filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <Header label="Patient" k="patient" sort={sort} onSort={onSort} />
            <Header label="Facility" k="facility" sort={sort} onSort={onSort} />
            <Header label="MCB" sort={sort} onSort={onSort} />
            <Header label="Wound" sort={sort} onSort={onSort} />
            <Header label="L×W×D" sort={sort} onSort={onSort} />
            <Header label="Decision" k="decision" sort={sort} onSort={onSort} />
            <Header label="Reason" sort={sort} onSort={onSort} className="hidden lg:table-cell" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const meta = DECISION_META[r.decision];
            return (
              <tr
                key={r.patient_id}
                onClick={() => onSelect(r)}
                className={`cursor-pointer bg-white hover:bg-slate-50 ${meta.row}`}
              >
                <td className="px-3 py-2.5 text-sm font-medium text-slate-800">
                  {r.display_name}
                  {r.multiple_wounds && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                      {r.wounds.length} wounds
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-sm text-slate-600">{r.facility_id}</td>
                <td className="px-3 py-2.5 text-sm">
                  <span className={r.has_active_mcb ? "text-green-600" : "text-slate-400"}>
                    {r.has_active_mcb ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-sm capitalize text-slate-700">{woundLabel(r.wound)}</td>
                <td className="px-3 py-2.5 text-sm tabular-nums text-slate-600">{dims(r.wound)}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                  {r.override && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      overridden
                    </span>
                  )}
                </td>
                <td className="hidden max-w-md truncate px-3 py-2.5 text-sm text-slate-500 lg:table-cell" title={r.reason}>
                  {r.reason}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
