# ADR-001: Monorepo Structure with pnpm Workspaces

**Status**: Accepted  
**Date**: 2024-01-15

## Context

The media pipeline requires multiple services (API, orchestrator, workers) that share type definitions and contracts. Each service is implemented in a different language (TypeScript and Python) and has its own deployment lifecycle.

## Decision

Use a pnpm workspace monorepo with the following structure:

```
apps/           # Deployable applications (TypeScript)
services/       # Internal services (TypeScript)
workers/        # Worker processes (Python, TypeScript)
packages/       # Shared libraries (TypeScript)
tests/          # Test suites
```

- **`apps/`**: Long-running processes that expose ports (e.g., `media-pipeline-api`)
- **`services/`**: Internal services that consume streams but don't expose ports (e.g., `editorial-orchestrator`, `editorial-worker`)
- **`workers/`**: Worker processes, notably the Python media worker
- **`packages/`**: Shared TypeScript libraries (`contracts`, `configuration`, `observability`, `test-support`)
- **`tests/`**: Integration and end-to-end tests

Python code lives in its own directory (`workers/python-media-worker/`) with its own `pyproject.toml` and toolchain (ruff, mypy, pytest).

## Consequences

### Positive

- Shared TypeScript types in `packages/contracts` prevent contract drift between API, orchestrator, and workers
- Single `pnpm install` sets up all TypeScript dependencies
- Unified linting and formatting via Biome
- Each service can be versioned and deployed independently
- Python worker is fully isolated — no risk of TypeScript/Python dependency mixing

### Negative

- pnpm workspace adds complexity to Docker builds (need to copy workspace config + contracts package)
- Developers need both pnpm and Python toolchains installed
- Version bumps to `packages/contracts` require rebuilding all dependents

## Alternatives Considered

- **Separate repos**: Rejected due to contract sync overhead
- **Nx workspace**: Rejected due to simpler needs — pnpm workspaces suffice
- **Single repo without workspace**: Rejected — all TypeScript packages would need relative imports
