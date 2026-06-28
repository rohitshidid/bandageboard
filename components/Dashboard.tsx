"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Decision, EligibilityResult } from "@/lib/types";
import { mockEligibility } from "@/lib/mocks";
import SummaryCards from "./SummaryCards";
import Charts from "./Charts";
import EligibilityTable, { type SortKey } from "./EligibilityTable";
import DetailDrawer from "./DetailDrawer";

type DataSource = "live" | "mock";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DECISION_ORDER: Record<Decision, number> = {
  auto_accept: 0,
  flag_for_review: 1,
  reject: 2,
};

export default function Dashboard() {
  const [rows, setRows] = useState<EligibilityResult[]>([]);
  const [source, setSource] = useState<DataSource>("live");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // filters
  const [facility, setFacility] = useState("all");
  const [decision, setDecision] = useState("all");
  const [mcbOnly, setMcbOnly] = useState(false);
  const [query, setQuery] = useState("");

  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "decision", dir: 1 });
  // Track by id, not the row object — keeps the drawer showing fresh data
  // (e.g. right after an override) once `rows` is reloaded.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => rows.find((r) => r.patient_id === selectedId) ?? null,
    [rows, selectedId]
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/eligibility", { cache: "no-store" });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const results: EligibilityResult[] = data.results ?? [];
      if (results.length === 0) throw new Error("no data yet");
      setRows(results);
      setSource("live");
      setError(null);
    } catch (e) {
      setRows(mockEligibility);
      setSource("mock");
      setError(e instanceof Error ? e.message : "fetch failed");
    }
  }, []);

  // Biller manual override (manual_override_requirements.md): POST/DELETE the
  // override, then refresh from the API so decision/system_decision/reason are
  // recomputed server-side consistently (avoids drifting local state). The
  // drawer is keyed by patient_id (see `selected` above), so it picks up the
  // refreshed row automatically once `rows` updates.
  const handleOverride = useCallback(
    async (patientId: string, newDecision: Decision | null, note: string) => {
      if (newDecision) {
        await fetch("/api/eligibility/override", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patient_id: patientId, decision: newDecision, note }),
        });
      } else {
        await fetch(`/api/eligibility/override?patient_id=${encodeURIComponent(patientId)}`, {
          method: "DELETE",
        });
      }
      await loadData();
    },
    [loadData]
  );

  const loadLastSync = useCallback(async () => {
    try {
      const res = await fetch("/api/sync", { cache: "no-store" });
      if (res.ok) setLastSync((await res.json()).lastSyncAt ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadData(), loadLastSync()]);
      setLoading(false);
    })();
  }, [loadData, loadLastSync]);

  // SYNC button: POST async, retry until the API responds, then refresh the UI.
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg("Syncing with PointClickCare…");
    const maxAttempts = 30;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch("/api/sync", { method: "POST" });
        if (!res.ok) throw new Error(`sync ${res.status}`);
        const r = await res.json();
        setLastSync(r.lastSyncAt);
        setSyncMsg(`Synced: ${r.inserted} new, ${r.updated} updated (${(r.durationMs / 1000).toFixed(1)}s)`);
        await loadData(); // recompute status -> refresh table/charts
        break;
      } catch (e) {
        if (attempt === maxAttempts) {
          setSyncMsg("Sync failed after retries — try again.");
          break;
        }
        setSyncMsg(`API unavailable, retrying (${attempt})…`);
        await sleep(Math.min(2000 * attempt, 10000));
      }
    }
    setSyncing(false);
  }, [loadData]);

  const filtered = useMemo(() => {
    let r = rows;
    if (facility !== "all") r = r.filter((x) => String(x.facility_id) === facility);
    if (decision !== "all") r = r.filter((x) => x.decision === decision);
    if (mcbOnly) r = r.filter((x) => x.has_active_mcb);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(
        (x) =>
          x.display_name.toLowerCase().includes(q) ||
          (x.wound?.wound_type ?? "").toLowerCase().includes(q)
      );
    }
    return [...r].sort((a, b) => {
      let cmp = 0;
      if (sort.key === "patient") cmp = a.display_name.localeCompare(b.display_name);
      else if (sort.key === "facility") cmp = a.facility_id - b.facility_id;
      else cmp = DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision];
      return cmp * sort.dir;
    });
  }, [rows, facility, decision, mcbOnly, query, sort]);

  const onSort = (k: SortKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: 1 }));

  const facilities = useMemo(() => [...new Set(rows.map((r) => r.facility_id))].sort(), [rows]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">BandageBoard</h1>
          <p className="text-sm text-slate-500">Medicare Part B wound-care billing triage</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-slate-400">
            <span className={`mr-2 rounded-full px-2 py-0.5 ${source === "live" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
              {source === "live" ? "Live" : "Mock"}
            </span>
            {lastSync ? `Last sync: ${new Date(lastSync).toLocaleString()}` : "Never synced"}
            {syncMsg && <div className="mt-0.5 text-slate-500">{syncMsg}</div>}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {syncing ? "Syncing…" : "SYNC"}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          Loading patient routing…
        </div>
      ) : (
        <>
          {source === "mock" && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              Showing sample data ({error}). Click <strong>SYNC</strong> (or run <code className="font-mono">npm run ingest</code>) for live results.
            </div>
          )}

          <SummaryCards rows={rows} />

          <div className="mt-4">
            <Charts rows={rows} onDecisionClick={(d) => setDecision(d)} />
          </div>

          <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
            <select value={facility} onChange={(e) => setFacility(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
              <option value="all">All facilities</option>
              {facilities.map((f) => (
                <option key={f} value={String(f)}>Facility {f}</option>
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

          <EligibilityTable rows={filtered} sort={sort} onSort={onSort} onSelect={(r) => setSelectedId(r.patient_id)} />
        </>
      )}

      <DetailDrawer row={selected} onClose={() => setSelectedId(null)} onOverride={handleOverride} />
    </main>
  );
}
