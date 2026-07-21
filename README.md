# 2mbi-media-pipeline

Pipeline média mutualisé pour l'écosystème 2MBI (Konektag, ClapCelebrity, etc.).

## Architecture

4 services applicatifs, event-driven, PostgreSQL outbox pattern, Redis Streams.

```
Vidéo master → Upload → MinIO → FFprobe → Extraction audio → faster-whisper
    → Transcription (JSON/SRT/VTT) → Ollama analyse éditoriale
    → Propositions d'extraits → Validation → FFmpeg clips
    → Formats (16:9, 9:16, 1:1) → Sous-titres → Branding
    → Media Delivery → Publication Postiz
```

### Services applicatifs (déployés par le pipeline)

| Service | Langage | Rôle |
|---------|---------|------|
| `media-pipeline-api` | TypeScript/Hono | API REST, upload, CRUD, worker results, heartbeat, outbox, URLs privées, publication |
| `editorial-orchestrator` | TypeScript | Workflow événementiel, retries, enchaînement des étapes |
| `editorial-worker` | TypeScript | Analyse LLM via Ollama, préparation et envoi Postiz |
| `python-media-worker` | Python | FFprobe, extraction audio, faster-whisper, clips FFmpeg, rendus, sous-titres, branding |

### Infrastructure mutualisée 2MBI (non déployée par le pipeline)

| Service | Usage |
|---------|-------|
| **PostgreSQL** | Base `media_pipeline_db` dans l'instance partagée |
| **Redis** | Streams préfixés `2mbi:media:*`, consumer groups, retry schedule |
| **MinIO** | Bucket `2mbi-media`, stockage objets avec préfixes par tenant |
| **Ollama** | Analyse éditoriale locale, modèle configurable |
| **Postiz** | Publication réseaux sociaux, appel API |
| **Traefik** | Reverse proxy, accès public |

### Redis Streams (préfixés pour isolation)

| Stream | Consumer Group | Consumer |
|--------|---------------|----------|
| `2mbi:media:events` | `2mbi:group:orchestrator` | Editorial Orchestrator |
| `2mbi:media:tasks` | `2mbi:group:media-workers` | Python Media Worker |
| `2mbi:media:editorial:tasks` | `2mbi:group:editorial-workers` | Editorial Worker |
| `2mbi:media:dead-letter` | — | Alerting (manuel) |

## Prérequis

- Node.js >= 22
- pnpm >= 10
- Python >= 3.12
- Docker & Docker Compose
- Infrastructure 2MBI existante (PostgreSQL, Redis, MinIO, Ollama, Postiz)

## Démarrage rapide

```bash
# Infrastructure partagée (si pas déjà lancée)
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis minio

# Installation
pnpm install

# Migrations PostgreSQL
pnpm db:migrate

# Développement (tous les services)
pnpm dev
```

Ou tout lancer via Docker :

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

## Configuration

Copier `.env.example` vers `.env` et ajuster :

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_pipeline_db
REDIS_URL=redis://:redispass@localhost:6379

# Redis prefixés
REDIS_MEDIA_EVENTS_STREAM=2mbi:media:events
REDIS_MEDIA_TASKS_STREAM=2mbi:media:tasks
REDIS_EDITORIAL_TASKS_STREAM=2mbi:media:editorial:tasks
REDIS_DEAD_LETTER_STREAM=2mbi:media:dead-letter

# MinIO
MINIO_ENDPOINT=localhost:9000
MINIO_BUCKET=2mbi-media

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b

# Postiz
POSTIZ_BASE_URL=https://postiz.2mbiweb.com
POSTIZ_API_KEY=

# Whisper
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

## API REST

### Upload
```bash
curl -X POST http://localhost:3001/api/v1/media/upload \
  -F "file=@video.mp4" \
  -F "tenantId=clapscelebrity" \
  -F "productId=claps"
```

### Transcription
```bash
curl http://localhost:3001/api/v1/transcripts/{mediaId}
curl "http://localhost:3001/api/v1/transcripts/{mediaId}/download?format=json"
```

### Clips
```bash
curl http://localhost:3001/api/v1/media/{mediaId}/clips
curl -X PATCH http://localhost:3001/api/v1/media/{mediaId}/clips/{clipId} \
  -H "Content-Type: application/json" \
  -d '{"action":"accept"}'
```

### Assets
```bash
curl http://localhost:3001/api/v1/media/{mediaId}/assets
curl http://localhost:3001/api/v1/assets/{assetId}/private-url
curl -X POST http://localhost:3001/api/v1/assets/{assetId}/publish
```

### Publications Postiz
```bash
curl -X POST http://localhost:3001/api/v1/publications \
  -H "Content-Type: application/json" \
  -d '{"mediaId":"...","channels":["instagram"],"title":"...","description":"...","hashtags":["#test"]}'

curl -X POST http://localhost:3001/api/v1/publications/{id}/publish
```

## Media Delivery

- **Médias privés** : URLs présignées MinIO, durée 900s (configurable)
- **Médias publics** : derrière reverse proxy + cache/CDN
- **MinIO n'est pas le CDN** — c'est le stockage source
- **Range requests** supportées pour la lecture vidéo
- **MP4 `faststart`** activé sur toutes les sorties vidéo

## Tests

```bash
pnpm test              # Tests unitaires
pnpm test:integration  # Tests d'intégration
pnpm test:e2e          # Tests end-to-end (stack complet requis)

cd workers/python-media-worker && pytest  # Tests Python
```

## Project Structure

```
apps/media-pipeline-api/     API REST (TypeScript/Hono)
services/
  editorial-orchestrator/    Orchestration workflow (TypeScript)
  editorial-worker/          LLM + Postiz (TypeScript)
workers/python-media-worker/ Média processing (Python)
packages/contracts/          Schémas Zod partagés
database/migrations/         Migrations SQL
infrastructure/docker/       Dockerfiles + compose
docs/decisions/              ADR
```

## Idempotence & Fiabilité

- Chaque commande porte une `idempotencyKey` (UUIDv4)
- Workers vérifient l'idempotency key avant traitement
- Outbox transactionnelle PostgreSQL → Redis
- Retries avec backoff exponentiel (30s, 120s, 600s par défaut)
- Max 3 tentatives, puis dead-letter (`2mbi:media:dead-letter`)
- Pas de `XACK` avant commit métier réussi
