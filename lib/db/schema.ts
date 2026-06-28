// Drizzle schema = the DB contract. Person 1 owns this.
// Raw API JSON is kept in a `raw` jsonb column on every table for auditability;
// typed columns are projected out for querying.

import {
  pgTable,
  integer,
  text,
  boolean,
  timestamp,
  date,
  jsonb,
} from "drizzle-orm/pg-core";

// Internal-id patients. PK = internal integer id (-> notes/assessments).
export const patients = pgTable("patients", {
  id: integer("id").primaryKey(),
  patientId: text("patient_id").notNull(), // -> diagnoses/coverage
  facilityId: integer("facility_id").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  birthDate: date("birth_date"),
  gender: text("gender"),
  primaryPayerCode: text("primary_payer_code"),
  lastModifiedAt: timestamp("last_modified_at", { withTimezone: false }),
  isNewAdmission: boolean("is_new_admission").default(false),
  raw: jsonb("raw"),
});

export const diagnoses = pgTable("diagnoses", {
  id: integer("id").primaryKey(),
  patientId: text("patient_id").notNull(),
  icd10Code: text("icd10_code"),
  icd10Description: text("icd10_description"),
  clinicalStatus: text("clinical_status"),
  onsetDate: date("onset_date"),
  raw: jsonb("raw"),
});

export const coverage = pgTable("coverage", {
  id: integer("id").primaryKey(),
  patientId: text("patient_id").notNull(),
  payerName: text("payer_name"),
  payerCode: text("payer_code"),
  payerType: text("payer_type"),
  effectiveFrom: timestamp("effective_from", { withTimezone: false }),
  effectiveTo: timestamp("effective_to", { withTimezone: false }), // null = active
  raw: jsonb("raw"),
});

export const notes = pgTable("notes", {
  id: integer("id").primaryKey(),
  patientId: integer("patient_id").notNull(), // internal id
  noteType: text("note_type"),
  effectiveDate: timestamp("effective_date", { withTimezone: false }),
  noteText: text("note_text"),
  raw: jsonb("raw"),
});

export const assessments = pgTable("assessments", {
  id: integer("id").primaryKey(),
  patientId: integer("patient_id").notNull(), // internal id
  assessmentType: text("assessment_type"),
  assessmentDate: date("assessment_date"),
  rawJson: text("raw_json"),
  raw: jsonb("raw"),
});

// Ingestion progress cursor (resumable chunked sync, per facility).
export const syncCursor = pgTable("sync_cursor", {
  facilityId: integer("facility_id").primaryKey(),
  offset: integer("offset").notNull().default(0),
  total: integer("total"),
  updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow(),
});

// Singleton (id=1) tracking the last full incremental sync for the SYNC button.
export const syncMeta = pgTable("sync_meta", {
  id: integer("id").primaryKey(), // always 1 (singleton)
  lastSyncAt: timestamp("last_sync_at", { withTimezone: false }),
  lastInserted: integer("last_inserted").default(0),
  lastUpdated: integer("last_updated").default(0),
});
