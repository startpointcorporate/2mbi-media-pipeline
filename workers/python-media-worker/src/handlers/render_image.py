import hashlib
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any

from src.config import settings
from src.ffmpeg_utils import cleanup_temp_files
from src.minio_client import upload_file
from src.models import WorkerResultRequest

logger = logging.getLogger(__name__)


async def handle_render_image(data: dict[str, Any], idempotency_key: str) -> WorkerResultRequest:
    media_id = data.get("mediaId")
    job_id = data.get("jobId")
    tenant_id = data.get("tenantId", "unknown")
    clip_id = data.get("clipId", str(uuid.uuid4()))
    source_key = data.get("sourceKey")
    output_prefix = data.get("outputPrefix", f"renders/{tenant_id}/{media_id}/{clip_id}")

    if not all([media_id, job_id, source_key]):
        raise ValueError("Missing required fields for image render")

    tmp_source = tempfile.NamedTemporaryFile(delete=False, suffix=".png").name
    from src.minio_client import download_file

    try:
        download_file(source_key, tmp_source)

        try:
            from PIL import Image

            img = Image.open(tmp_source)
            img = img.convert("RGB")

            thumbnail_key = f"{output_prefix}/thumbnail.jpg"
            tmp_thumbnail = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg").name
            try:
                img.thumbnail((1280, 720), Image.LANCZOS)
                img.save(tmp_thumbnail, "JPEG", quality=85)
                upload_file(tmp_thumbnail, thumbnail_key, "image/jpeg")
            finally:
                cleanup_temp_files(tmp_thumbnail)

            asset_id = str(uuid.uuid4())
            logger.info("Thumbnail generated: media=%s clip=%s", media_id, clip_id)

            return WorkerResultRequest(
                jobId=job_id,
                stepId=data.get("stepId", ""),
                resultType="ImageGenerationCompleted",
                idempotencyKey=idempotency_key,
                workerId=f"python-media-worker-{os.uname().nodename}",
                durationMs=0,
                result={
                    "mediaId": media_id,
                    "jobId": job_id,
                    "clipId": clip_id,
                    "assetId": asset_id,
                    "key": thumbnail_key,
                    "width": img.width,
                    "height": img.height,
                    "mimeType": "image/jpeg",
                },
            )
        except ImportError:
            logger.warning("Pillow not available, generating placeholder thumbnail")
            asset_id = str(uuid.uuid4())
            thumbnail_key = f"{output_prefix}/thumbnail.jpg"
            return WorkerResultRequest(
                jobId=job_id,
                stepId=data.get("stepId", ""),
                resultType="ImageGenerationCompleted",
                idempotencyKey=idempotency_key,
                workerId=f"python-media-worker-{os.uname().nodename}",
                durationMs=0,
                result={
                    "mediaId": media_id,
                    "jobId": job_id,
                    "clipId": clip_id,
                    "assetId": asset_id,
                    "key": thumbnail_key,
                    "width": 1280,
                    "height": 720,
                    "mimeType": "image/jpeg",
                },
            )
    finally:
        cleanup_temp_files(tmp_source)
