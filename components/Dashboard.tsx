"use client";

import { useEffect, useMemo, useState } from "react";
import type { Decision, EligibilityResult } from "@/lib/types";
import { mockEligibility } from "@/lib/mocks";
import SummaryCards from "./SummaryCards";
import EligibilityTable, { type SortKey } from "./EligibilityTable";
import DetailDrawer from "./DetailDrawer";

type Source = "live" | "mock";

const DECISION_ORDER: Record<Decision, number> = {
  auto_accept: 0,
  flag_for_review: 1,
  reject: 2,
};

export default function Dashboard() {
  const [rows, setRows] = useState<EligibilityResult[]>([]);
  const [source, setSource] = useState<Source>("live");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [facility, setFacility] = useState<string>("all");
  const [decision, setDecision] = useState<string>("all");
  const [mcbOnly, setMcbOnly] = useState(false);
  const [query, setQuery] = useState("");

  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "decision", dir: 1 });
  const [selected, setSelected] = useState<EligibilityResult | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/eligibility", { cache: "no-store" });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const data = await res.json();
        if (!active) return;
        const results: EligibilityResult[] = data.results ?? [];
        if (results.length === 0) throw new Error("no data yet");
        setRows(results);
        setSource("live");
      } catch (e) {
        if (!active) return;
        // Fall back to mocks so the dashboard is always demoable.
        setRows(mockEligibility);
        setSource("mock");
        setError(e instanceof Error ? e.message : "fetch failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (facility !== "all") r = r.filter((x) => String(x.facility_id) === facility);
    if (decision !== "all") r = r.filter((x) => x.decision === decision);
    if (mcbOnly) r = r.filter((x) => x.has_active_mcb);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(
        (x) =>
          x.display_name_masked.toLowerCase().includes(q) ||
          (x.wound?.wound_type ?? "").toLowerCase().includes(q)
      );
    }
    const sorted = [...r].sort((a, b) => {
      let cmp = 0;
      if (sort.key === "patient") cmp = a.display_name_masked.localeCompare(b.display_name_masked);
      else if (sort.key === "facility") cmp = a.facility_id - b.facility_id;
      else cmp = DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision];
      return cmp * sort.dir;
    });
    return sorted;
  }, [rows, facility, decision, mcbOnly, query, sort]);

  const onSort = (k: SortKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: 1 }));

  const facilities = useMemo(() => [...new Set(rows.map((r) => r.facility_id))].sort(), [rows]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">BandageBoard</h1>
          <p className="text-sm text-slate-500">Medicare Part B wound-care billing triage</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            source === "live" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {source === "live" ? "Live data" : "Mock data"}
        </span>
      </header>

      {loading ? (
        <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          Loading patient routing…
        </div>
      ) : (
        <>
          {source === "mock" && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              Showing sample data ({error}). Run <code className="font-mono">npm run ingest</code> and refresh for live results.
            </div>
          )}

          <SummaryCards rows={rows} />

          <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
            <select value={facility} onChange={(e) => setFacility(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
              <option value="all">All facilities</option>
              {facilities.map((f) => (
                <option key={f} value={String(f)}>
                  Facility {f}
                </option>
              ))}
            </select>
            <select value={decision} onChange={(e) => setDecision(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
              <option value="all">All decisions</option>
              <option value="auto_accept">Ready to bill</option>
              <option value="flag_for_review">Needs review</option>
              <option value="reject">Reject</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={mcbOnly} onChange={(e) => setMcbOnly(e.target.checked)} className="rounded" />
              Active MCB only
            </label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient / wound…"
              className="ml-auto w-56 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
            <span className="text-sm text-slate-400">{filtered.length} shown</span>
          </div>

          <EligibilityTable rows={filtered} sort={sort} onSort={onSort} onSelect={setSelected} />
        </>
      )}

      <DetailDrawer row={selected} onClose={() => setSelected(null)} />
    </main>
  );
}
