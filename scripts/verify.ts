// Verify the end-to-end decision output against stored data (no server needed).
//   npm run verify
import "dotenv/config";
import { computeEligibility } from "../lib/eligibility/compute";

async function main() {
  const rows = await computeEligibility();
  const summary = {
    total: rows.length,
    auto_accept: rows.filter((r) => r.decision === "auto_accept").length,
    flag_for_review: rows.filter((r) => r.decision === "flag_for_review").length,
    reject: rows.filter((r) => r.decision === "reject").length,
  };
  console.log("SUMMARY:", JSON.stringify(summary));
  const multi = rows.filter((r) => r.multiple_wounds).length;
  console.log(`multi-wound patients: ${multi}`);
  console.log("\nSample rows:");
  for (const r of rows.slice(0, 10)) {
    const w = r.wound;
    const dims = w ? `${w.wound_type ?? "?"} ${w.length_cm}x${w.width_cm}x${w.depth_cm} drain=${w.drainage_amount}` : "no wound";
    const tag = r.multiple_wounds ? ` [${r.wounds.length} wounds]` : "";
    console.log(
      `  ${r.display_name.padEnd(24)} mcb=${r.has_active_mcb ? "Y" : "N"}  ${r.decision.padEnd(16)} | ${dims}${tag}`
    );
  }

  // Shape guard: only EligibilityResult fields present.
  const allowed = new Set([
    "patient_id", "display_name", "facility_id", "has_active_mcb",
    "wound", "wounds", "multiple_wounds", "decision", "reason",
  ]);
  const extra = rows.flatMap((r) => Object.keys(r).filter((k) => !allowed.has(k)));
  console.log(`\nshape check: ${extra.length === 0 ? "PASS" : "FAIL: " + extra.join(",")}`);
  process.exit(0);
}
main().catch((e) => { console.error("verify FAILED:", e); process.exit(1); });
