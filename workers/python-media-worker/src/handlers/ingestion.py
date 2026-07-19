import logging
import time

from src.config import Settings
from src.models import TaskMessage, WorkerResultRequest

logger = logging.getLogger(__name__)


def handle_ingestion(task: TaskMessage, settings: Settings) -> WorkerResultRequest:
    media_id = task.data.get("mediaId", "unknown")
    tenant_id = task.data.get("tenantId", "unknown")

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

    time.sleep(1)

    return WorkerResultRequest(
        jobId=task.data.get("jobId", ""),
        stepId=task.data.get("stepId", ""),
        idempotencyKey=task.idempotency_key,
        resultType="MediaIngestionCompleted",
        result={
            "normalizedKey": f"media-source/{tenant_id}/{media_id}/normalized.mp4",
            "audioKey": f"media-source/{tenant_id}/{media_id}/audio.wav",
            "duration": 120.5,
            "codec": "h264",
            "width": 1920,
            "height": 1080,
        },
    )
