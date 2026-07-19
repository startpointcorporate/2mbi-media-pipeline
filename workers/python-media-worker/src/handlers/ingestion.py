import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)


def handle_ingestion(data: dict[str, Any]) -> dict[str, Any]:
    media_id = data.get("mediaId", "unknown")
    tenant_id = data.get("tenantId", "unknown")

    logger.info("=== Ingestion handler (mock) ===")
    logger.info("Media ID: %s", media_id)
    logger.info("Tenant ID: %s", tenant_id)
    logger.info("Would run: ffprobe on source file to extract metadata")
    logger.info(
        "Would run: ffmpeg -c:v h264 -c:a aac -ar 48000 "
        "-vf scale=1920:1080 for normalization"
    )
    logger.info(
        "Would run: ffmpeg -vn -c:a pcm_s16le -ar 16000 -ac 1 "
        "for audio extraction"
    )
    logger.info(
        "Would upload: normalized file to MinIO bucket "
        "media-source/%s/%s/",
        tenant_id,
        media_id,
    )
    logger.info(
        "Would upload: audio file to MinIO bucket "
        "media-source/%s/%s/",
        tenant_id,
        media_id,
    )
    logger.info("=== Ingestion complete ===")

    return {
        "normalizedKey": f"media-source/{tenant_id}/{media_id}/normalized.mp4",
        "audioKey": f"media-source/{tenant_id}/{media_id}/audio.wav",
        "duration": 123.456,
        "codec": "h264",
        "audioCodec": "aac",
        "width": 1920,
        "height": 1080,
        "sha256": uuid.uuid4().hex,
    }
