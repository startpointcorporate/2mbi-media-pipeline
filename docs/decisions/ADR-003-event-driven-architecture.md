# ADR-003: Event-Driven Architecture with Redis Streams

**Status**: Accepted  
**Date**: 2024-01-15

## Context

The pipeline requires asynchronous communication between four services. Workers must process commands reliably, retry on failure, and avoid duplicate execution. The existing platform already runs Redis.

## Decision

Use Redis Streams (not RabbitMQ or Kafka) for all inter-service communication, with three distinct streams:

| Stream | Producer | Consumer Group | Consumer |
|---|---|---|---|
| `stream:media-tasks` | Editorial Orchestrator | `group:media-workers` | Python Media Worker |
| `stream:editorial-tasks` | Editorial Orchestrator | `group:editorial-workers` | TypeScript Editorial Worker |
| `stream:pipeline-events` | Outbox Dispatcher | `group:orchestrator` | Editorial Orchestrator |
| `stream:dead-letter` | Editorial Orchestrator | — | Manual alerting |

### Key mechanisms

- **Consumer Groups** with XACK for at-least-once delivery
- **Idempotency keys** (UUIDv4) on every message to guarantee exactly-once processing
- **Redis Sorted Set** (`media:retry:schedule`) for delayed retries — no sleeping workers
- **XAUTOCLAIM** for recovery of abandoned messages (based on heartbeat + lease tracking)
- **Heartbeats** via `POST /internal/job-steps/{stepId}/heartbeat` to detect crashed workers
- **Dead-letter stream** for commands that exhausted retries

### Message envelope

Every Redis Stream message follows this schema:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "uuid-v4",
  "correlationId": "uuid-v4",
  "step": "IngestionRequested",
  "data": { "jobId": "uuid", "mediaId": "uuid", "tenantId": "...", "productId": "..." }
}
```

### Why not RabbitMQ

- Redis is already in the stack — zero new infrastructure
- Streams provide persistence (AOF) that Pub/Sub lacks
- Consumer Groups with PEL (Pending Entry List) provide at-least-once delivery
- RabbitMQ would add operational complexity (new service to manage, configure, monitor)

### Why not Kafka

- Kafka is overkill for this scale (single team, moderate throughput)
- Kafka requires ZooKeeper/Kraft — additional operational burden
- Redis Streams provide the same consumer group pattern with simpler operations

### Why not Redis Pub/Sub

- Pub/Sub is fire-and-forget — messages are lost if no subscriber is connected
- Pub/Sub has no persistence, no consumer groups, no ACK mechanism
- Pub/Sub is reserved for ephemeral real-time notifications (progress, status)

## Consequences

### Positive

- Zero new infrastructure beyond what the platform already runs
- Redis Streams provide persistence, consumer groups, and blocking reads
- Familiar operational model for the team
- Pub/Sub remains available for real-time UI notifications

### Negative

- Redis Streams don't support partitioning (single node limit)
- No built-in dead-letter management (custom implementation via dedicated stream)
- No built-in delayed delivery (requires Sorted Set workaround)
- At-least-once delivery requires idempotency handling in all consumers
- Stream memory usage grows with backlog — needs monitoring and MAXLEN policy

## Alternatives Considered

- **RabbitMQ**: Rejected — new infrastructure, not already in the stack
- **Apache Kafka**: Rejected — overkill, operational complexity
- **Redis Pub/Sub**: Rejected — no persistence, no ACK, fire-and-forget
- **PgMQ (PostgreSQL queue)**: Rejected — would bypass Redis which is already proven in the platform
