# Future Scope

Planned enhancements beyond the current build.

## 1. Auto-update via Kafka queue
Stream patient/wound record changes through a Kafka queue so eligibility
results update automatically instead of on manual sync. Producers push source
changes; consumers re-run extraction + decision and upsert results live.

## 2. Docker pods (backup servers with auto-restart)
Containerize the app and run multiple replicas (backup servers) with automatic
restart on failure (e.g. Docker Compose `restart: always` or Kubernetes pods
with liveness probes) for high availability.

## 3. Patient history
Track full history per patient — past wound claims, prior decisions, and
status changes over time — instead of only the latest snapshot.

## Optimization

### Caching
Add caching to reduce recomputation and DB load — cache eligibility results
and frequently read queries; invalidate on relevant updates from the Kafka
queue (see #1).

## Features

### Group patients by rejection reason
Group/cluster patients by their rejection reason so billers can triage similar
rejects together (e.g. "no active MCB", "low confidence", "missing measurements").
