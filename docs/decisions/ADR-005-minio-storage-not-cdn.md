# ADR-005: MinIO comme stockage objet, pas CDN

## Statut
Accepté

## Contexte
Le README et les implémentations antérieures assimilaient MinIO à un CDN ou à de la diffusion publique. MinIO est un stockage objet S3-compatible, pas un CDN.

## Décision
- MinIO = stockage privé source
- Les médias privés sont servis via URLs présignées (durée limitée)
- Les médias publics passent par une Media Delivery Gateway
- La couche publique est derrière Traefik/reverse proxy + cache HTTP/CDN

## Architecture cible
```
MinIO (privé) → Media Delivery Gateway → Traefik → Cache/CDN → Client
```

## Conséquences
- `presignedGetUrl` corrigé (utilisait `PutObjectCommand` au lieu de `GetObjectCommand`)
- URLs présignées valides 15 minutes par défaut
- Abstraction `MediaDeliveryProvider` sépare stockage et diffusion
- Support des requêtes HTTP Range pour la lecture vidéo
- Tous les MP4 générés avec `-movflags +faststart`
