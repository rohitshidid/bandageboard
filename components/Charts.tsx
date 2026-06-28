"use client";

import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import type { Decision, EligibilityResult } from "@/lib/types";

const DECISION_COLOR: Record<Decision, string> = {
  auto_accept: "#16a34a",
  flag_for_review: "#f59e0b",
  reject: "#e11d48",
};
const DECISION_LABEL: Record<Decision, string> = {
  auto_accept: "Ready to bill",
  flag_for_review: "Needs review",
  reject: "Reject",
};
const FACILITY_COLORS = ["#2563eb", "#7c3aed", "#0891b2"];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="h-56">{children}</div>
    </div>
  );
}

export default function Charts({
  rows,
  onDecisionClick,
}: {
  rows: EligibilityResult[];
  onDecisionClick: (d: Decision) => void;
}) {
  const decisions = (["auto_accept", "flag_for_review", "reject"] as Decision[]).map((d) => ({
    key: d,
    name: DECISION_LABEL[d],
    value: rows.filter((r) => r.decision === d).length,
  }));

  const mcb = [
    { name: "Active MCB", value: rows.filter((r) => r.has_active_mcb).length, color: "#16a34a" },
    { name: "Not MCB", value: rows.filter((r) => !r.has_active_mcb).length, color: "#94a3b8" },
  ];

  const facMap = new Map<number, number>();
  for (const r of rows) facMap.set(r.facility_id, (facMap.get(r.facility_id) ?? 0) + 1);
  const facilities = [...facMap.entries()].sort().map(([f, n]) => ({ name: `Facility ${f}`, value: n }));

  const typeMap = new Map<string, number>();
  for (const r of rows) {
    const t = (r.wound?.wound_type ?? "none").replace(/_/g, " ");
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
  }
  const woundTypes = [...typeMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card title="Decisions (click to filter)">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={decisions}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={38}
              outerRadius={70}
              paddingAngle={2}
              onClick={(d: any) => d?.payload?.key && onDecisionClick(d.payload.key)}
              className="cursor-pointer focus:outline-none"
            >
              {decisions.map((d) => (
                <Cell key={d.key} fill={DECISION_COLOR[d.key]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Medicare Part B coverage">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={mcb} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
              {mcb.map((m) => (
                <Cell key={m.name} fill={m.color} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Patients per facility">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={facilities}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {facilities.map((_, i) => (
                <Cell key={i} fill={FACILITY_COLORS[i % FACILITY_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Wound types">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={woundTypes} layout="vertical" margin={{ left: 10 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
