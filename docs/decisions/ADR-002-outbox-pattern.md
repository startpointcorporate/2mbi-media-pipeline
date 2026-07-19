# ADR-002: PostgreSQL Outbox for All PG → Redis Transitions

**Status**: Accepted  
**Date**: 2024-01-15

## Context

The pipeline needs to publish events to Redis Streams whenever business state changes in PostgreSQL. Direct dual-writes (INSERT into PG + XADD to Redis) risk inconsistency: the PG write succeeds but Redis is unavailable, or vice versa.

The existing 2mbi platform already uses an outbox pattern (table `konektag.outbox_events`) for async operations.

## Decision

Use the same PostgreSQL outbox pattern for all PG → Redis transitions:

1. Business logic runs inside a PostgreSQL transaction
2. The transaction writes both business data AND an `OutboxEvent` row
3. On commit, a separate Outbox Dispatcher process reads unprocessed events and publishes them to `stream:pipeline-events`
4. The dispatcher uses `SELECT ... FOR UPDATE SKIP LOCKED` to avoid duplicate processing

### Outbox table

```sql
CREATE TABLE media_pipeline.outbox_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL,
  correlation_id    UUID NOT NULL,
  causation_id      UUID,
  idempotency_key   TEXT NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  attempts          INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 10,
  error_message     TEXT
);
```

### Flow

```
Transaction (business + OutboxEvent) → Commit → Outbox Dispatcher → XADD stream:pipeline-events
```

## Consequences

### Positive

- Atomicity: business data and event are committed together
- Reliability: events survive Redis restarts and are delivered at least once
- Reuse: same pattern as existing platform — familiar to the team
- Observability: `processed_at` and `attempts` make it easy to detect stuck events

### Negative

- Additional latency (dispatcher polls, doesn't publish inline)
- Requires the Outbox Dispatcher to be running
- Events are not visible in Redis until the dispatcher processes them (typically within 100ms)

## Alternatives Considered

- **Dual-write (PG + Redis in code)**: Rejected — risk of inconsistency
- **Debezium / CDC**: Rejected — overkill for this scale; outbox is simpler
- **Transactional outbox with Redis as sole queue**: Rejected — PostgreSQL is the source of truth; Redis is ephemeral transport
