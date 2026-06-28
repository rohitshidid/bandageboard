// POST /api/summarize — streams a plain-English explanation of why a patient
// received their routing decision, based on their wound data and eligibility result.
// Uses Ollama (local LLM) — expects Ollama running at OLLAMA_BASE_URL (default: http://localhost:11434).

import { NextRequest } from "next/server";
import type { EligibilityResult, WoundClaim } from "@/lib/types";

export const dynamic = "force-dynamic";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

function buildPrompt(patient: EligibilityResult, claim: WoundClaim | null): string {
  const name = patient.display_name;
  const facility = patient.facility_id;
  const mcb = patient.has_active_mcb ? "active" : "not active";

  const decisionLabel =
    claim?.decision ?? patient.decision;
  const reason = claim?.reason ?? patient.reason;

  let woundSection = "No wound data was extracted for this patient.";
  if (claim?.wound) {
    const w = claim.wound;
    const dims =
      w.length_cm != null && w.width_cm != null
        ? `${w.length_cm} × ${w.width_cm}${w.depth_cm != null ? ` × ${w.depth_cm}` : ""} cm`
        : "not documented";
    woundSection = `
Wound type: ${w.wound_type ?? "unknown"}
Stage: ${w.stage ?? "not staged"}
Location: ${w.location ?? "not documented"}
Measurements (L×W×D): ${dims}
Drainage: ${w.drainage_amount ?? "not documented"}
Data source: ${w.source.replace(/_/g, " ")}
Extraction confidence: ${Math.round(w.confidence * 100)}%
Evidence text: "${w.evidence ?? "none"}"`.trim();
  }

  return `You are a clinical billing assistant explaining a Medicare Part B wound-care routing decision to a non-technical biller.

Patient: ${name} (Facility ${facility})
Medicare Part B coverage: ${mcb}
Routing decision: ${decisionLabel.replace(/_/g, " ").toUpperCase()}
System reason: ${reason}

${woundSection}

In 3–5 short, clear sentences, explain to the biller:
1. Why this patient received this routing decision.
2. Which specific data points drove the decision (or what was missing/ambiguous).
3. What the biller should do next (if anything).

Write in plain English. Do not use jargon. Do not invent or assume data not listed above.`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const patient: EligibilityResult = body.patient;
  const claim: WoundClaim | null = body.claim ?? null;

  if (!patient) {
    return new Response(JSON.stringify({ error: "patient is required" }), { status: 400 });
  }

  const prompt = buildPrompt(patient, claim);

  const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!ollamaRes.ok || !ollamaRes.body) {
    const text = await ollamaRes.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `Ollama error ${ollamaRes.status}: ${text}` }),
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const upstream = ollamaRes.body.getReader();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await upstream.read();
          if (done) break;
          // Ollama streams newline-delimited JSON objects: {"message":{"content":"..."},"done":false}
          const lines = decoder.decode(value, { stream: true }).split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              const token: string = json?.message?.content ?? "";
              if (token) controller.enqueue(encoder.encode(token));
            } catch {
              // partial line — ignore
            }
          }
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      upstream.cancel();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
