# 2mbi-media-pipeline — AI Agent Guide

## Architecture

4 services, event-driven, PostgreSQL outbox pattern:

| Service | Language | Role |
|---|---|---|
| `apps/media-pipeline-api` | TypeScript | REST API, upload, CRUD, worker results, heartbeat, outbox |
| `services/editorial-orchestrator` | TypeScript | Event workflow, retry schedule, lease management |
| `workers/python-media-worker` | Python | Ingestion, transcription, render video/image |
| `services/editorial-worker` | TypeScript | LLM editorial analysis, Postiz publishing |

**No cross-imports** between implementations. All inter-service communication goes through Redis Streams or REST.

## Rules

### Outbox
- All PostgreSQL → Redis transitions go through the outbox table (`media_pipeline.outbox_events`)
- No direct Redis publishing from business logic
- The outbox dispatcher reads unprocessed events and publishes to `stream:pipeline-events`

### Idempotency
- Every command carries an `idempotencyKey` (UUIDv4)
- One key = one execution, guaranteed even after crash/restart
- Workers check `media_job_steps.idempotency_key` before processing

### Message Envelope
- Every message (stream or API) includes `schemaVersion`, `correlationId`
- `correlationId` is set once per job and propagated through all steps
- `causationId` references the message that caused this one

### Worker Results
- Workers call `POST /internal/worker-results` to report results
- No direct event publishing from workers
- The Media Pipeline API handles the transaction (business data + outbox)

### Retries
- No sleeping workers
- Failed commands go to `media:retry:schedule` (Redis Sorted Set)
- Orchestrator reads due retries and republishes to the appropriate stream
- After max attempts → `stream:dead-letter`

### Redis Streams

| Stream | Consumer Group | Consumer |
|---|---|---|
| `stream:media-tasks` | `group:media-workers` | Python Media Worker |
| `stream:editorial-tasks` | `group:editorial-workers` | TypeScript Editorial Worker |
| `stream:pipeline-events` | `group:orchestrator` | Editorial Orchestrator |
| `stream:dead-letter` | — | Alerting (manual) |

## Commands

```bash
# Install
pnpm install

# Build all packages
pnpm build

# Development (all services)
pnpm dev

# Run tests
pnpm test              # Unit tests
pnpm test:integration  # Integration tests
pnpm test:e2e          # End-to-end tests (requires full stack)

# Lint
pnpm lint
pnpm format

# Database
pnpm db:migrate

# Docker Compose (full stack)
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

## Linting

- TypeScript: Biome (`pnpm lint` / `pnpm format`)
- Python: ruff + mypy (in `workers/python-media-worker/`)
- Strict null checks, no unused locals/parameters
