# 2mbi-media-pipeline

Mutualised media and AI pipeline for the 2mbi ecosystem (Konektag, ClapCelebrity, etc.).

## Architecture

Four custom services, event-driven, with PostgreSQL outbox pattern:

```
                    ┌──────────────────────┐
                    │   Media Pipeline API  │  REST API — upload, CRUD, worker results
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │ Editorial Orchestrator│  Event workflow, retry schedule
                    └──────┬──────────┬────┘
                           │          │
              ┌────────────▼──┐  ┌───▼────────────────┐
              │ stream:media- │  │ stream:editorial-   │
              │ tasks         │  │ tasks               │
              └──────┬────────┘  └──────┬──────────────┘
                     │                  │
        ┌────────────▼────────┐  ┌─────▼──────────────────┐
        │  Python Media       │  │  TypeScript Editorial  │
        │  Worker             │  │  Worker                │
        │  (ingestion,       │  │  (LLM analysis,       │
        │   transcription,    │  │   Postiz publishing)  │
        │   render)           │  │                        │
        └─────────────────────┘  └────────────────────────┘
```

- **PostgreSQL**: business metadata + outbox (source of truth)
- **Redis Streams**: command/event transport (transient)
- **MinIO**: file storage (source media, generated assets)
- **Keycloak**: authentication (optional in dev)
- **Directus**: brand templates only

## Prerequisites

- Node.js >= 22
- pnpm >= 10
- Python >= 3.12 (for workers/python-media-worker)
- Docker & Docker Compose (for infrastructure services)

## Quick Start

```bash
# Start infrastructure (PostgreSQL, Redis, MinIO)
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis minio

# Install dependencies
pnpm install

# Run database migrations
pnpm db:migrate

# Start API for development
pnpm --filter @2mbi/media-pipeline-api dev
```

Or start the full stack:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

## Local Development

Run each service individually with hot reload:

```bash
# Media Pipeline API (port 3001)
pnpm --filter @2mbi/media-pipeline-api dev

# Editorial Orchestrator
pnpm --filter @2mbi/editorial-orchestrator dev

# TypeScript Editorial Worker
pnpm --filter @2mbi/editorial-worker dev

# Python Media Worker
cd workers/python-media-worker && python -m src
```

## Testing

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# End-to-end tests (full stack required)
pnpm test:e2e

# Python worker tests
cd workers/python-media-worker && pytest
```

## Project Structure

```
├── apps/
│   └── media-pipeline-api/     # REST API (Node.js/TypeScript)
├── services/
│   ├── editorial-orchestrator/ # Event workflow (Node.js/TypeScript)
│   └── editorial-worker/       # LLM + publishing (Node.js/TypeScript)
├── workers/
│   └── python-media-worker/    # Media processing (Python)
├── packages/
│   ├── contracts/              # Shared Zod schemas & types
│   ├── configuration/          # Shared config utilities
│   ├── observability/          # Logging, metrics
│   └── test-support/           # Test helpers and shared tests
├── tests/
│   ├── end-to-end/             # E2E tests (full stack)
│   └── integration/            # Integration tests
├── database/
│   └── migrations/             # SQL migrations
├── infrastructure/
│   └── docker/                 # Dockerfiles & docker-compose
└── docs/
    └── decisions/              # Architecture Decision Records
```

## Current Status

**Walking skeleton** — core infrastructure (Docker Compose, PostgreSQL schema, Redis streams, CI) operational. Services under active development.
