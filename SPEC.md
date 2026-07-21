# Spécification du pipeline média 2MBI

**Version** : 1.0  
**Date** : 2026-07-21  
**Dépôt** : `github.com/startpointcorporate/2mbi-media-pipeline`  
**Branche** : `dev`

---

## 1. Vue d'ensemble

Pipeline média mutualisé pour l'écosystème 2MBI. Reçoit une vidéo master, la normalise, la transcrit, l'analyse via LLM, génère des extraits multiformats pour les réseaux sociaux, les sous-titre, les brandit, et les publie via Postiz.

```
Vidéo master → Upload → FFprobe → Extraction audio → faster-whisper
→ Transcription (JSON/SRT/VTT) → Ollama (analyse + YouTube metadata + posts)
→ Revue éditoriale → FFmpeg clips (16:9, 9:16, 1:1)
→ Sous-titres incrustés → Branding → Miniatures
→ Package ZIP → Validation backoffice → Publication Postiz → Archive
```

---

## 2. Composants applicatifs

| Service | Langage | Port | Rôle |
|---------|---------|------|------|
| `media-pipeline-api` | TypeScript/Hono | 3001 | API REST |
| `editorial-orchestrator` | TypeScript | 3002 (health) | Workflow + retries |
| `editorial-worker` | TypeScript | 3003 (health) | LLM Ollama + Postiz |
| `python-media-worker` | Python 3.12 | — | FFprobe, FFmpeg, faster-whisper |

---

## 3. Infrastructure mutualisée 2MBI

| Service | Configuration |
|---------|--------------|
| PostgreSQL | Base `media_pipeline_db`, schéma `media_pipeline` |
| Redis | Streams préfixés `2mbi:media:*` |
| MinIO | Bucket unique `2mbi-media` |
| Ollama | Modèle configurable, défaut `qwen3:8b` |
| Postiz | API externe, `POSTIZ_BASE_URL` |
| Traefik | Reverse proxy pour URLs publiques |

---

## 4. Authentification

### 4.1 Clients

Chaque application (Konektag, ClapsCelebrity, 2MBI Web) possède :

| Header | Description |
|--------|-------------|
| `x-api-key` | Clé unique par client |
| `x-api-secret` | Secret validé en temps constant |
| `x-tenant-id` | Identifiant tenant (optionnel, déduit de la clé) |
| `x-timestamp` | Timestamp Unix ms (±5 minutes) |
| `x-nonce` | UUID unique par requête, TTL Redis 10min |

### 4.2 Ajouter un client

Ajouter une entrée JSON dans `CLIENTS_CONFIG` :

```json
{"tenantId": "nouveau_client", "apiKey": "nouvelle_cle", "apiSecret": "nouveau_secret"}
```

### 4.3 Routes internes

Protégées par `INTERNAL_API_KEY` dans le header `x-api-key`.

---

## 5. Redis Streams

| Stream | Consumer Group | Consumer |
|--------|---------------|----------|
| `2mbi:media:events` | `2mbi:group:orchestrator` | Editorial Orchestrator |
| `2mbi:media:tasks` | `2mbi:group:media-workers` | Python Media Worker |
| `2mbi:media:editorial:tasks` | `2mbi:group:editorial-workers` | Editorial Worker |
| `2mbi:media:dead-letter` | — | Alerting manuel |

Clé supplémentaire : `2mbi:media:retry:schedule` (Sorted Set).

---

## 6. API REST

### 6.1 Upload & Jobs

| Méthode | Endpoint | Body/Query |
|---------|----------|------------|
| `POST` | `/api/v1/media/upload` | `file` (multipart), `productId`, `pipelineProfile?` |
| `GET` | `/api/v1/jobs` | `productId?`, `status?`, `limit?`, `offset?` |
| `GET` | `/api/v1/jobs/:id` | — |

### 6.2 Transcription

| Méthode | Endpoint | Query |
|---------|----------|-------|
| `GET` | `/api/v1/transcripts/:mediaId` | — |
| `GET` | `/api/v1/transcripts/:mediaId/download` | `format=json\|srt\|vtt` |

### 6.3 Clips (revue éditoriale)

| Méthode | Endpoint | Body |
|---------|----------|------|
| `GET` | `/api/v1/media/:mediaId/clips` | — |
| `PATCH` | `/api/v1/media/:mediaId/clips/:clipId` | `{action, title?, hook?, description?, hashtags?, startTime?, endTime?}` |

### 6.4 Assets

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/v1/media/:mediaId/assets` | Liste |
| `GET` | `/api/v1/assets/:assetId/private-url` | URL présignée 900s |
| `POST` | `/api/v1/assets/:assetId/publish` | Rendre public |
| `POST` | `/api/v1/assets/:assetId/unpublish` | Retirer |

### 6.5 Package

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `POST` | `/api/v1/media/:mediaId/package/generate` | Générer ZIP (202 async) |
| `GET` | `/api/v1/media/:mediaId/package` | Statut + download URL |
| `POST` | `/api/v1/media/:mediaId/package/modify` | Upload ZIP modifié |
| `POST` | `/api/v1/media/:mediaId/package/validate` | Valider |
| `POST` | `/api/v1/media/:mediaId/package/publish` | Publier + archiver |

### 6.6 Publications

| Méthode | Endpoint | Body |
|---------|----------|------|
| `POST` | `/api/v1/publications` | `{mediaId, channels[], title, description, hashtags[], scheduledAt?}` |
| `GET` | `/api/v1/publications?mediaId=` | — |
| `POST` | `/api/v1/publications/:id/publish` | — |
| `POST` | `/api/v1/publications/:id/cancel` | — |
| `GET` | `/api/v1/publications/:id/status` | — |

### 6.7 Internes (workers)

| Méthode | Endpoint |
|---------|----------|
| `POST` | `/internal/worker-results` |
| `POST` | `/internal/job-steps/:stepId/heartbeat` |
| `PUT` | `/internal/objects` |
| `GET` | `/internal/transcripts/raw?key=` |

---

## 7. Workflow événementiel

### 7.1 Chaîne complète

```
MediaUploaded
  → IngestionRequested (2mbi:media:tasks)
    → MediaIngestionCompleted
      → TranscriptionRequested (2mbi:media:tasks)
        → TranscriptionCompleted
          → EditorialAnalysisRequested (2mbi:media:editorial:tasks)
            → MediaContentPlanGenerated
              → [revue humaine via API PATCH /clips]
            → MediaContentPlanApproved
              → RenderVideoRequested × N clips (2mbi:media:tasks)
                → RenderCompleted
                  → [génération package via API]
                  → [publication via API]
                      → PublishingCompleted → job COMPLETED
```

### 7.2 Handlers orchestrateur

| Événement reçu | Commande dispatchée | Stream cible |
|----------------|---------------------|--------------|
| `MediaUploaded` | `IngestionRequested` | `2mbi:media:tasks` |
| `MediaIngestionCompleted` | `TranscriptionRequested` | `2mbi:media:tasks` |
| `TranscriptionCompleted` | `EditorialAnalysisRequested` | `2mbi:media:editorial:tasks` |
| `MediaContentPlanGenerated` | (attente revue humaine) | — |
| `MediaContentPlanApproved` | `RenderVideoRequested` × N | `2mbi:media:tasks` |
| `RenderCompleted` | (vérification batch complet) | — |
| `PublishingCompleted` | (marque job COMPLETED) | — |

### 7.3 Statuts de job

```
pending → processing → awaiting_review → rendering → rendered → completed
                                                                 → failed
```

---

## 8. Modèle de données

### 8.1 Tables

| Table | Rôle |
|-------|------|
| `media_assets` | Métadonnées des fichiers uploadés |
| `media_jobs` | Jobs pipeline avec statut |
| `media_job_steps` | Étapes individuelles avec idempotence |
| `outbox_events` | Pattern outbox PostgreSQL → Redis |
| `transcriptions` | Résultats de transcription |
| `transcription_segments` | Segments horodatés |
| `editorial_plans` | Résultats analyse LLM |
| `clip_proposals` | Propositions d'extraits avec scores |
| `clips` | Clips générés |
| `clip_assets` | Variantes rendues (16:9, 9:16, 1:1) |
| `render_profiles` | Profils de rendu configurables |
| `brand_profiles` | Profils de marque (JSONB) |
| `media_publications` | Publications Postiz |
| `postiz_publications` | Références externes Postiz |
| `media_packages` | Packages ZIP |
| `pipeline_history` | Audit log |

### 8.2 Isolation multitenant

`tenant_id` présent sur **toutes** les tables. Indexé partout.

---

## 9. Contrats (Zod)

| Fichier | Schémas |
|---------|---------|
| `event-envelope.ts` | `EventEnvelope`, `MessageType` (35 types) |
| `events.ts` | `MediaUploadedData`, `IngestionRequestedData`, etc. |
| `transcription.ts` | `TranscriptionSegment`, `TranscriptionCompletedData` |
| `editorial.ts` | `EditorialAnalysisRequest`, `EditorialClipProposal`, `YouTubeMetadata` |
| `render.ts` | `RenderProfile` (4 stratégies), `RenderCompletedData` |
| `branding.ts` | `BrandProfile` (logo, watermark, overlay, couleurs) |
| `delivery.ts` | `PrivateMediaAccess`, `PublishedMediaAsset` |
| `publication.ts` | `PublicationResult`, `PublishRequestedData` |
| `retry.ts` | `RetryEntry`, `DeadLetterMessage`, `BusinessError` |

---

## 10. MinIO — Organisation des objets

```
masters/{tenantId}/{mediaId}/          → Fichier master
audio/{tenantId}/{mediaId}/            → Audio extrait
transcripts/{tenantId}/{mediaId}/      → JSON/SRT/VTT
clips/{tenantId}/{mediaId}/{clipId}/   → Clips source
renders/{tenantId}/{mediaId}/{clipId}/ → Variantes rendues + miniatures
branding/{brandProfileId}/             → Assets de marque
editorial/{tenantId}/{mediaId}/        → Plans LLM
packages/{mediaId}/                    → Packages ZIP
archives/{tenantId}/{mediaId}/         → ZIP publiés
```

---

## 11. Media Delivery

- **Privé** : URLs présignées MinIO, TTL configurable (défaut 900s)
- **Public** : URLs stables via Traefik `https://media.2mbiweb.com/{tenantId}/{key}`
- MinIO = stockage source, **pas le CDN**
- Support HTTP Range pour seek vidéo
- `-movflags +faststart` sur tous les MP4

---

## 12. Fiabilité

| Mécanisme | Implémentation |
|-----------|---------------|
| Idempotence | `idempotencyKey` UUIDv4, UNIQUE sur 3 tables |
| Outbox | `outbox_events`, polling 2s, `FOR UPDATE SKIP LOCKED` |
| Retries | Backoff exponentiel (30s/120s/600s), max 3 tentatives |
| Dead letter | `2mbi:media:dead-letter` après épuisement |
| Heartbeat | Workers heartbeat 15s, lease 60s |
| Transactions | Tous les changements métier en transaction PG |

---

## 13. Configuration

```env
# Auth
CLIENTS_CONFIG=[{"tenantId":"konektag","apiKey":"...","apiSecret":"..."}]
INTERNAL_API_KEY=...

# Base de données
DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_pipeline_db

# Redis
REDIS_URL=redis://:redispass@localhost:6379
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
OLLAMA_TIMEOUT_MS=180000
EDITORIAL_AI_MAX_CONCURRENCY=1

# Postiz
POSTIZ_BASE_URL=https://postiz.2mbiweb.com
POSTIZ_API_KEY=

# Whisper
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

# Media Delivery
MEDIA_PUBLIC_BASE_URL=https://media.2mbiweb.com
MEDIA_PRIVATE_URL_TTL_SECONDS=900

# Clips
CLIP_MIN_DURATION_SECONDS=15
CLIP_MAX_DURATION_SECONDS=60
CLIP_LEAD_IN_SECONDS=0.5
CLIP_LEAD_OUT_SECONDS=0.8
```

---

## 14. Déploiement

```bash
pnpm install
pnpm db:migrate

# Développement
pnpm dev

# Production
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

---

## 15. Tests

| Niveau | Commande | Résultat |
|--------|----------|----------|
| Unitaires TS | `pnpm test` | 46 passed |
| Unitaires Python | `pytest` | 16 passed |
| End-to-end | `E2E=true pnpm test:e2e` | 10 tests (upload, auth, nonce, tenant lock) |
| Intégration | `pnpm test:integration` | Redis conditionnel |

---

## 16. Exemple d'appel complet

```bash
# 1. Upload
curl -X POST https://api.2mbiweb.com/api/v1/media/upload \
  -H "x-api-key: claps_key" \
  -H "x-api-secret: claps_secret" \
  -H "x-timestamp: $(date +%s%3N)" \
  -H "x-nonce: $(uuidgen)" \
  -F "file=@video.mp4" \
  -F "productId=claps"

# → {"mediaId":"550e8400-...", "jobId":"660e8400-..."}

# 2. Suivi
curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  -H "x-timestamp: $(date +%s%3N)" -H "x-nonce: $(uuidgen)" \
  https://api.2mbiweb.com/api/v1/jobs/660e8400-...

# 3. Transcription
curl ... https://api.2mbiweb.com/api/v1/transcripts/550e8400-...

# 4. Clips
curl ... https://api.2mbiweb.com/api/v1/media/550e8400-.../clips

# 5. Accepter un clip
curl -X PATCH .../clips/{clipId} -d '{"action":"accept"}'

# 6. Package
curl -X POST .../package/generate
curl .../package  # → downloadUrl

# 7. Publication
curl -X POST .../package/publish
```
