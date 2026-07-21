# 2mbi-media-pipeline

Pipeline média mutualisé pour l'écosystème 2MBI (Konektag, ClapCelebrity, 2MBI Web).

## Architecture

```
Vidéo master → Upload → MinIO → FFprobe → Extraction audio → faster-whisper
    → Transcription (JSON/SRT/VTT) → Ollama (analyse + YouTube metadata + posts)
    → Propositions clips → Revue éditoriale → FFmpeg clips
    → Formats (16:9, 9:16, 1:1) → Sous-titres → Branding
    → Package ZIP → Validation backoffice → Publication Postiz
```

4 services applicatifs, event-driven, PostgreSQL outbox, Redis Streams préfixés.

### Services

| Service | Rôle |
|---------|------|
| `media-pipeline-api` | API REST (upload, jobs, transcripts, clips, assets, packages, publications) |
| `editorial-orchestrator` | Workflow événementiel, enchaînement des étapes, retries |
| `editorial-worker` | Analyse LLM (Ollama) — YouTube metadata, posts sociaux, clips |
| `python-media-worker` | FFprobe, extraction audio, faster-whisper, FFmpeg clips/rendus/sous-titres/branding |

### Infrastructure mutualisée 2MBI

PostgreSQL (`media_pipeline_db`), Redis (`2mbi:media:*`), MinIO (`2mbi-media`), Ollama, Postiz.

---

## Authentification

Chaque application cliente s'authentifie avec 3 valeurs :

| Header | Description |
|--------|-------------|
| `x-tenant-id` | Identifiant du tenant (optionnel si déduit de la clé) |
| `x-api-key` | Clé API unique au client |
| `x-api-secret` | Secret API (validé en temps constant) |

Le pipeline vérifie que la paire `apiKey` + `apiSecret` correspond à un client enregistré.
Le `tenantId` est déduit de cette vérification — le client ne peut pas usurper un autre tenant.

### Ajouter un nouveau client

Dans la variable d'environnement `CLIENTS_CONFIG` (format JSON) :

```env
CLIENTS_CONFIG='[
  {"tenantId":"konektag","apiKey":"konektag_key","apiSecret":"konektag_secret"},
  {"tenantId":"clapscelebrity","apiKey":"claps_key","apiSecret":"claps_secret"},
  {"tenantId":"2mbiweb","apiKey":"2mbiweb_key","apiSecret":"2mbiweb_secret"}
]'
```

Ajouter une entrée dans ce tableau suffit. Redémarrer l'API pour prise en compte.

### Appeler l'API

```bash
# Depuis le backoffice Konektag
curl -H "x-api-key: konektag_key" \
     -H "x-api-secret: konektag_secret" \
     http://localhost:3001/api/v1/jobs

# Depuis le backoffice ClapsCelebrity
curl -H "x-api-key: claps_key" \
     -H "x-api-secret: claps_secret" \
     http://localhost:3001/api/v1/jobs
```

### Routes internes (workers)

Les routes `/internal/*` utilisent la variable `INTERNAL_API_KEY` :

```env
INTERNAL_API_KEY=internal_secret_key
```

```bash
curl -H "x-api-key: internal_secret_key" \
     http://localhost:3001/internal/worker-results
```

---

## Démarrage

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Ou Docker :

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

---

## Configuration

```env
# Auth
CLIENTS_CONFIG=[{"tenantId":"...","apiKey":"...","apiSecret":"..."}]
INTERNAL_API_KEY=internal_secret_key

# Base de données
DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_pipeline_db

# Redis (préfixés)
REDIS_URL=redis://:redispass@localhost:6379
REDIS_MEDIA_EVENTS_STREAM=2mbi:media:events
REDIS_MEDIA_TASKS_STREAM=2mbi:media:tasks
REDIS_EDITORIAL_TASKS_STREAM=2mbi:media:editorial:tasks

# MinIO
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=2mbi-media

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b

# Postiz
POSTIZ_BASE_URL=https://postiz.2mbiweb.com
POSTIZ_API_KEY=

# faster-whisper
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

# Media Delivery
MEDIA_PUBLIC_BASE_URL=https://media.2mbiweb.com
MEDIA_PRIVATE_URL_TTL_SECONDS=900

# Clips
CLIP_MIN_DURATION_SECONDS=15
CLIP_MAX_DURATION_SECONDS=60
```

---

## Endpoints API

Tous les endpoints publics nécessitent les headers `x-api-key` et `x-api-secret`.

### Upload & Jobs

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `POST` | `/api/v1/media/upload` | Upload d'une vidéo master (multipart : `file`, `productId`) |
| `GET` | `/api/v1/jobs` | Liste des jobs (filtres : `productId`, `status`, `limit`, `offset`) |
| `GET` | `/api/v1/jobs/:id` | Détail d'un job + étapes |

```bash
curl -X POST http://localhost:3001/api/v1/media/upload \
  -H "x-api-key: claps_key" \
  -H "x-api-secret: claps_secret" \
  -F "file=@video.mp4" \
  -F "productId=claps"
# → {"mediaId":"...", "jobId":"..."}

curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  http://localhost:3001/api/v1/jobs?status=running

curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  http://localhost:3001/api/v1/jobs/{jobId}
```

### Transcription

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/v1/transcripts/:mediaId` | Transcription complète + segments |
| `GET` | `/api/v1/transcripts/:mediaId/download?format=json\|srt\|vtt` | URL présignée de téléchargement |

```bash
curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  http://localhost:3001/api/v1/transcripts/{mediaId}

curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  "http://localhost:3001/api/v1/transcripts/{mediaId}/download?format=srt"
```

### Clips (revue éditoriale)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/v1/media/:mediaId/clips` | Propositions LLM + clips générés |
| `PATCH` | `/api/v1/media/:mediaId/clips/:clipId` | Accepter / Rejeter / Modifier une proposition |

```bash
curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  http://localhost:3001/api/v1/media/{mediaId}/clips

# Accepter
curl -X PATCH http://localhost:3001/api/v1/media/{mediaId}/clips/{clipId} \
  -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  -H "Content-Type: application/json" \
  -d '{"action":"accept"}'

# Rejeter
curl -X PATCH ... -d '{"action":"reject"}'

# Modifier
curl -X PATCH ... -d '{"action":"modify","title":"Nouveau titre","hook":"Nouvelle accroche"}'
```

### Assets

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/v1/media/:mediaId/assets` | Tous les assets d'un média |
| `GET` | `/api/v1/assets/:assetId/private-url` | URL présignée (900s) |
| `POST` | `/api/v1/assets/:assetId/publish` | Rendre public (URL stable) |
| `POST` | `/api/v1/assets/:assetId/unpublish` | Retirer l'accès public |

```bash
curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  http://localhost:3001/api/v1/media/{mediaId}/assets

curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  http://localhost:3001/api/v1/assets/{assetId}/private-url

curl -X POST http://localhost:3001/api/v1/assets/{assetId}/publish \
  -H "x-api-key: claps_key" -H "x-api-secret: claps_secret"
# → {"assetId":"...", "publicUrl":"https://media.2mbiweb.com/...", "status":"published"}
```

### Package

Le package est un ZIP contenant : clips (16:9, 9:16, 1:1), sous-titres (SRT/VTT), manifest.json (metadata YouTube + propositions posts).

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `POST` | `/api/v1/media/:mediaId/package/generate` | Générer le ZIP (asynchrone) |
| `GET` | `/api/v1/media/:mediaId/package` | Statut + URL de téléchargement |
| `POST` | `/api/v1/media/:mediaId/package/modify` | Upload d'un ZIP modifié (`file`) |
| `POST` | `/api/v1/media/:mediaId/package/validate` | Valider le package (`notes`) |
| `POST` | `/api/v1/media/:mediaId/package/publish` | Publier (archive + déclenche Postiz) |

```bash
# Génération
curl -X POST http://localhost:3001/api/v1/media/{mediaId}/package/generate \
  -H "x-api-key: claps_key" -H "x-api-secret: claps_secret"

# Statut + téléchargement
curl -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  http://localhost:3001/api/v1/media/{mediaId}/package
# → {"packageId":"...", "status":"ready", "downloadUrl":"http://..."}

# Upload ZIP modifié
curl -X POST http://localhost:3001/api/v1/media/{mediaId}/package/modify \
  -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  -F "file=@modified_package.zip"

# Valider
curl -X POST http://localhost:3001/api/v1/media/{mediaId}/package/validate \
  -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  -H "Content-Type: application/json" \
  -d '{"notes":"OK pour publication"}'

# Publier (archive + Postiz)
curl -X POST http://localhost:3001/api/v1/media/{mediaId}/package/publish \
  -H "x-api-key: claps_key" -H "x-api-secret: claps_secret"
```

### Publications

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `POST` | `/api/v1/publications` | Créer une publication |
| `GET` | `/api/v1/publications?mediaId=` | Lister les publications |
| `POST` | `/api/v1/publications/:id/publish` | Envoyer vers Postiz |
| `POST` | `/api/v1/publications/:id/cancel` | Annuler |
| `GET` | `/api/v1/publications/:id/status` | Statut par canal Postiz |

```bash
curl -X POST http://localhost:3001/api/v1/publications \
  -H "x-api-key: claps_key" -H "x-api-secret: claps_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId":"...",
    "channels":["instagram","tiktok"],
    "title":"Mon titre",
    "description":"Ma description",
    "hashtags":["#test"],
    "scheduledAt":"2026-07-22T10:00:00Z"
  }'

curl -X POST http://localhost:3001/api/v1/publications/{id}/publish \
  -H "x-api-key: claps_key" -H "x-api-secret: claps_secret"
```

---

## Cycle de vie complet

```
1. Upload master                POST /api/v1/media/upload
2. Suivi du job                 GET /api/v1/jobs/{jobId}
3. Transcription                GET /api/v1/transcripts/{mediaId}
4. Revue des clips              GET /api/v1/media/{mediaId}/clips
                                PATCH .../clips/{clipId} (accept/reject/modify)
5. Assets                       GET /api/v1/media/{mediaId}/assets
                                POST .../assets/{assetId}/publish
6. Package                      POST .../package/generate
                                GET .../package → download URL
                                POST .../package/modify (zip modifié)
                                POST .../package/validate
                                POST .../package/publish → archive + Postiz
7. Publication                  POST /api/v1/publications
                                POST .../publications/{id}/publish
                                GET .../publications/{id}/status
```

---

## Media Delivery

- **Médias privés** : URLs présignées MinIO, durée 900s par défaut
- **Médias publics** : derrière reverse proxy + cache/CDN, URL stable `https://media.2mbiweb.com/{tenantId}/{key}`
- **MinIO est le stockage source, pas le CDN**
- **Range requests** supportées (seek vidéo)
- **MP4 `faststart`** sur toutes les sorties

---

## Tests

```bash
pnpm test              # TypeScript : 46 tests
pnpm test:integration  # Intégration (Redis requis)
pnpm test:e2e          # End-to-end (stack complet)

cd workers/python-media-worker && pytest  # Python : 16 tests
```

---

## Idempotence & Fiabilité

- `idempotencyKey` (UUIDv4) sur chaque commande
- Outbox transactionnelle PostgreSQL → Redis
- Retries avec backoff exponentiel (30s, 120s, 600s)
- Max 3 tentatives, puis dead-letter (`2mbi:media:dead-letter`)
- Pas de `XACK` avant commit métier réussi
