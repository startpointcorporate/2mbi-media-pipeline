# ADR-006: Transcription locale faster-whisper, pas Replicate

## Statut
Accepté

## Contexte
Le chemin nominal du pipeline utilise faster-whisper en local pour la transcription, sans appel à une API externe type Replicate.

## Décision
- Transcription via `faster-whisper` (modèle `small` par défaut, configurable)
- Exécution locale, device `cpu`, compute `int8`
- Pas de dépendance à Replicate dans le chemin nominal
- Tous les paramètres sont configurables via variables d'environnement

## Configuration
```env
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_VAD_FILTER=true
WHISPER_MAX_CONCURRENCY=1
WHISPER_MODEL_CACHE_PATH=/models/whisper
```

## Conséquences
- Le worker Python dépend de `faster-whisper`
- Sorties JSON, SRT, VTT produites localement
- Les segments sont numérotés et servent de référence au LLM
