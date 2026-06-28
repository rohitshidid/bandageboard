// Chunked, idempotent ingestion. A "slice" processes `limit` patients of one
// facility starting at `offset`, then advances a DB cursor. Re-running is safe:
// every write is an upsert keyed on the source id. This keeps each serverless
// invocation under the Vercel timeout while a backfill completes across runs.

import { db, schema } from "../db/client";
import { sql } from "drizzle-orm";
import {
  getAssessments,
  getCoverage,
  getDiagnoses,
  getNotes,
  getPatients,
} from "./client";
import type { Patient } from "../types";

const FACILITIES = [101, 102, 103] as const;

function toDate(v: string | null | undefined) {
  return v ? new Date(v) : null;
}

async function upsertPatient(p: Patient) {
  await db
    .insert(schema.patients)
    .values({
      id: p.id,
      patientId: p.patient_id,
      facilityId: p.facility_id,
      firstName: p.first_name,
      lastName: p.last_name,
      birthDate: p.birth_date,
      gender: p.gender,
      primaryPayerCode: p.primary_payer_code,
      lastModifiedAt: toDate(p.last_modified_at),
      isNewAdmission: p.is_new_admission ?? false,
      raw: p,
    })
    .onConflictDoUpdate({
      target: schema.patients.id,
      set: {
        patientId: p.patient_id,
        facilityId: p.facility_id,
        firstName: p.first_name,
        lastName: p.last_name,
        birthDate: p.birth_date,
        gender: p.gender,
        primaryPayerCode: p.primary_payer_code,
        lastModifiedAt: toDate(p.last_modified_at),
        isNewAdmission: p.is_new_admission ?? false,
        raw: p,
      },
    });
}

async function syncOnePatient(p: Patient, since?: string) {
  // diagnoses + coverage keyed on STRING patient_id; notes + assessments on INT id.
  const [diags, covs, notes, assess] = await Promise.all([
    getDiagnoses(p.patient_id),
    getCoverage(p.patient_id),
    getNotes(p.id, since),
    getAssessments(p.id, since),
  ]);

  for (const d of diags) {
    await db
      .insert(schema.diagnoses)
      .values({
        id: d.id,
        patientId: d.patient_id,
        icd10Code: d.icd10_code,
        icd10Description: d.icd10_description,
        clinicalStatus: d.clinical_status,
        onsetDate: d.onset_date,
        raw: d,
      })
      .onConflictDoUpdate({
        target: schema.diagnoses.id,
        set: { clinicalStatus: d.clinical_status, raw: d },
      });
  }

  for (const c of covs) {
    await db
      .insert(schema.coverage)
      .values({
        id: c.id,
        patientId: c.patient_id,
        payerName: c.payer_name,
        payerCode: c.payer_code,
        payerType: c.payer_type,
        effectiveFrom: toDate(c.effective_from),
        effectiveTo: toDate(c.effective_to),
        raw: c,
      })
      .onConflictDoUpdate({
        target: schema.coverage.id,
        set: { effectiveTo: toDate(c.effective_to), payerType: c.payer_type, raw: c },
      });
  }

  for (const n of notes) {
    await db
      .insert(schema.notes)
      .values({
        id: n.id,
        patientId: n.patient_id,
        noteType: n.note_type,
        effectiveDate: toDate(n.effective_date),
        noteText: n.note_text,
        raw: n,
      })
      .onConflictDoUpdate({
        target: schema.notes.id,
        set: { noteText: n.note_text, noteType: n.note_type, raw: n },
      });
  }

  for (const a of assess) {
    await db
      .insert(schema.assessments)
      .values({
        id: a.id,
        patientId: a.patient_id,
        assessmentType: a.assessment_type,
        assessmentDate: a.assessment_date,
        rawJson: a.raw_json,
        raw: a,
      })
      .onConflictDoUpdate({
        target: schema.assessments.id,
        set: { rawJson: a.raw_json, raw: a },
      });
  }
}

export interface SliceResult {
  facilityId: number;
  processed: number;
  offset: number;
  total: number;
  done: boolean;
}

/** Process one resumable slice of a facility. Cron-friendly. */
export async function syncSlice(opts: {
  facilityId: number;
  limit?: number;
  offset?: number;
  since?: string;
}): Promise<SliceResult> {
  const { facilityId, limit = 25, since } = opts;
  const all = await getPatients(facilityId, since);

  // Resolve starting offset: explicit > stored cursor > 0.
  let offset = opts.offset;
  if (offset === undefined) {
    const cur = await db
      .select()
      .from(schema.syncCursor)
      .where(sql`${schema.syncCursor.facilityId} = ${facilityId}`);
    offset = cur[0]?.offset ?? 0;
  }

  const batch = all.slice(offset, offset + limit);
  // Process the batch with limited concurrency (the client retries 429s, so a
  // few in flight is fine) to keep each invocation fast.
  const CONCURRENCY = 5;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(async (p) => {
        await upsertPatient(p);
        await syncOnePatient(p, since);
      })
    );
  }

  const nextOffset = offset + batch.length;
  const done = nextOffset >= all.length;

  await db
    .insert(schema.syncCursor)
    .values({ facilityId, offset: done ? 0 : nextOffset, total: all.length })
    .onConflictDoUpdate({
      target: schema.syncCursor.facilityId,
      set: { offset: done ? 0 : nextOffset, total: all.length, updatedAt: new Date() },
    });

  return { facilityId, processed: batch.length, offset: nextOffset, total: all.length, done };
}

/** Full backfill for one facility (loops slices). Used by the CLI. */
export async function syncFacility(facilityId: number, opts: { limit?: number; since?: string } = {}) {
  let offset = 0;
  let total = Infinity;
  let processed = 0;
  while (offset < total) {
    const r = await syncSlice({ facilityId, limit: opts.limit ?? 25, offset, since: opts.since });
    total = r.total;
    offset = r.offset;
    processed += r.processed;
    if (r.done) break;
  }
  return { facilityId, processed, total };
}

/** Full backfill across all facilities. */
export async function syncAll(opts: { limit?: number; since?: string } = {}) {
  const results = [];
  for (const f of FACILITIES) {
    results.push(await syncFacility(f, opts));
  }
  return results;
}

// ---- SYNC button pipeline: incremental, insert-or-update, status refresh ----

export interface IncrementalResult {
  inserted: number;
  updated: number;
  changedPatients: number;
  lastSyncAt: string;
  durationMs: number;
}

export async function getLastSync(): Promise<string | null> {
  const m = await db.select().from(schema.syncMeta).where(sql`${schema.syncMeta.id} = 1`);
  return m[0]?.lastSyncAt ? m[0].lastSyncAt.toISOString() : null;
}

async function patientCount(): Promise<number> {
  const r = await db.select({ id: schema.patients.id }).from(schema.patients);
  return r.length;
}

/** Start a fresh full sync from facility 0, offset 0 (idempotent upserts). */
export async function resetSyncCursors(): Promise<void> {
  await db.update(schema.syncCursor).set({ offset: 0 });
  await db
    .insert(schema.syncMeta)
    .values({ id: 1, cursorFacility: 0 })
    .onConflictDoUpdate({ target: schema.syncMeta.id, set: { cursorFacility: 0 } });
}

export interface BatchResult {
  facilityId: number | null;
  processedThisBatch: number;
  facilityOffset: number;
  facilityTotal: number;
  cursorFacility: number;
  allDone: boolean;
  patientsInDb: number;
  lastSyncAt: string | null;
}

/**
 * Process ONE batch of the full sync, advancing a facility cursor across
 * 101 -> 102 -> 103. The UI calls this repeatedly until `allDone`. Resumable:
 * progress lives in sync_cursor (per-facility offset) + sync_meta.cursorFacility.
 */
export async function syncNextBatch(batchSize = 20): Promise<BatchResult> {
  const meta = await db.select().from(schema.syncMeta).where(sql`${schema.syncMeta.id} = 1`);
  const fi = meta[0]?.cursorFacility ?? 0;

  if (fi >= FACILITIES.length) {
    return {
      facilityId: null, processedThisBatch: 0, facilityOffset: 0, facilityTotal: 0,
      cursorFacility: fi, allDone: true, patientsInDb: await patientCount(),
      lastSyncAt: meta[0]?.lastSyncAt ? meta[0].lastSyncAt.toISOString() : null,
    };
  }

  const facilityId = FACILITIES[fi];
  const slice = await syncSlice({ facilityId, limit: batchSize });

  let cursorFacility = fi;
  let lastSyncAt = meta[0]?.lastSyncAt ?? null;
  if (slice.done) cursorFacility = fi + 1;
  const allDone = cursorFacility >= FACILITIES.length;
  if (allDone) lastSyncAt = new Date();

  await db
    .insert(schema.syncMeta)
    .values({ id: 1, cursorFacility, lastSyncAt: lastSyncAt ?? undefined })
    .onConflictDoUpdate({
      target: schema.syncMeta.id,
      set: { cursorFacility, lastSyncAt: lastSyncAt ?? undefined },
    });

  return {
    facilityId,
    processedThisBatch: slice.processed,
    facilityOffset: slice.offset,
    facilityTotal: slice.total,
    cursorFacility,
    allDone,
    patientsInDb: await patientCount(),
    lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
  };
}

/**
 * Incremental sync for the SYNC button. Pulls only patients changed since the
 * last sync (`last_modified_at >= since`), inserts new ones, updates changed
 * columns on existing ones (per-table upserts), and records the sync time.
 * Eligibility status is recomputed on read (/api/eligibility), so the UI just
 * refetches afterward.
 */
export async function syncIncremental(): Promise<IncrementalResult> {
  const t0 = Date.now();
  const since = (await getLastSync()) ?? undefined;

  // Snapshot existing patient ids to classify insert vs update.
  const existing = new Set(
    (await db.select({ id: schema.patients.id }).from(schema.patients)).map((r) => r.id)
  );

  let inserted = 0;
  let updated = 0;
  for (const f of FACILITIES) {
    const patients = await getPatients(f, since);
    for (const p of patients) {
      if (existing.has(p.id)) updated++;
      else {
        inserted++;
        existing.add(p.id);
      }
      await upsertPatient(p);
      await syncOnePatient(p, since);
    }
  }

  const now = new Date();
  await db
    .insert(schema.syncMeta)
    .values({ id: 1, lastSyncAt: now, lastInserted: inserted, lastUpdated: updated })
    .onConflictDoUpdate({
      target: schema.syncMeta.id,
      set: { lastSyncAt: now, lastInserted: inserted, lastUpdated: updated },
    });

  return {
    inserted,
    updated,
    changedPatients: inserted + updated,
    lastSyncAt: now.toISOString(),
    durationMs: Date.now() - t0,
  };
}
