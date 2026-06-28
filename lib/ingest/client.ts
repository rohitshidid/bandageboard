// PCC API client. The whole point: survive the 30% HTTP 429 rate without
// losing data. Honors `Retry-After`, falls back to exponential backoff, and
// retries transient 5xx. 422 is a caller bug -> fail loud, no retry.
//
// The pure helpers (parseRetryAfter, backoffMs, classify) are exported so they
// can be unit-tested without hitting the network.

import type {
  Assessment,
  Coverage,
  Diagnosis,
  Note,
  Patient,
} from "../types";

const BASE_URL = process.env.PCC_BASE_URL ?? "https://hackathon.prod.pulsefoundry.ai";
// High retry count = "keep retrying until the API responds" (429/5xx) with
// backoff, without spinning forever.
const MAX_RETRIES = 12;

export type RetryClass = "ok" | "retry" | "fatal";

export function classify(status: number): RetryClass {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429) return "retry";
  if (status >= 500) return "retry";
  return "fatal"; // 4xx (422 etc.) — bad request, retrying won't help
}

/** Parse the Retry-After header (seconds). Returns ms, clamped to [0, 30s]. */
export function parseRetryAfter(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const secs = Number(headerVal);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.min(secs, 30) * 1000;
}

/** Exponential backoff with jitter for attempt n (0-indexed). */
export function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  return base + Math.floor(Math.random() * 250);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PccError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PccError";
  }
}

/** GET a PCC endpoint with retry. Returns parsed JSON of type T. */
export async function pccGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: "application/json" } });
    } catch (err) {
      // network hiccup — treat as retryable
      lastErr = err;
      await sleep(backoffMs(attempt));
      continue;
    }

    const kind = classify(res.status);
    if (kind === "ok") {
      return (await res.json()) as T;
    }
    if (kind === "fatal") {
      const body = await res.text().catch(() => "");
      throw new PccError(res.status, `PCC ${res.status} on ${url.pathname}: ${body.slice(0, 200)}`);
    }
    // retryable (429 / 5xx)
    lastErr = new PccError(res.status, `transient ${res.status} on ${url.pathname}`);
    const wait = parseRetryAfter(res.headers.get("retry-after")) ?? backoffMs(attempt);
    await sleep(wait);
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`PCC request failed after ${MAX_RETRIES} retries: ${url.pathname}`);
}

// ---- Typed endpoint wrappers ----

export const getPatients = (facilityId: number, since?: string) =>
  pccGet<Patient[]>("/pcc/patients", { facility_id: facilityId, since });

export const getDiagnoses = (patientId: string) =>
  pccGet<Diagnosis[]>("/pcc/diagnoses", { patient_id: patientId });

export const getCoverage = (patientId: string) =>
  pccGet<Coverage[]>("/pcc/coverage", { patient_id: patientId });

export const getNotes = (internalId: number, since?: string) =>
  pccGet<Note[]>("/pcc/notes", { patient_id: internalId, since });

export const getAssessments = (internalId: number, since?: string) =>
  pccGet<Assessment[]>("/pcc/assessments", { patient_id: internalId, since });
