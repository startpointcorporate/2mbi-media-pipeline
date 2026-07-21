# ADR-004: Infrastructure mutualisée 2MBI

## Statut
Accepté

## Contexte
Le pipeline média 2MBI est un nouveau service dans l'écosystème 2MBI existant (Konektag, Clap's Celebrity, ERPNext, etc.). L'infrastructure de base (PostgreSQL, Redis, MinIO, Ollama, Postiz, Traefik) est déjà déployée et partagée entre plusieurs projets.

## Décision
Le pipeline réutilise l'infrastructure existante sans dupliquer les services.

### Services réutilisés (non déployés par le pipeline)
- **PostgreSQL** : base `media_pipeline_db` dans l'instance partagée
- **Redis** : clés préfixées `2mbi:media:*`
- **MinIO** : bucket `2mbi-media`
- **Ollama** : instance partagée, modèle configurable
- **Postiz** : instance partagée, appelée via API
- **Traefik** : reverse proxy partagé

### Services déployés par le pipeline
- `media-pipeline-api`
- `editorial-orchestrator`
- `editorial-worker` (TypeScript)
- `python-media-worker`

## Conséquences
- Le docker-compose du pipeline ne contient que les 4 services applicatifs
- PostgreSQL, Redis, MinIO sont externes dans le déploiement de production
- Les préfixes Redis assurent l'isolation dans l'instance partagée
- Les credentials MinIO sont limités au bucket `2mbi-media`
