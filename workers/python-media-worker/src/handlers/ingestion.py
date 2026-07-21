import hashlib
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.config import settings
from src.ffmpeg_utils import cleanup_temp_files, extract_audio, get_file_size, run_ffprobe
from src.minio_client import download_file, upload_bytes, upload_file
from src.models import WorkerResultRequest

logger = logging.getLogger(__name__)


async def handle_ingestion(data: dict[str, Any], idempotency_key: str) -> WorkerResultRequest:
    media_id = data.get("mediaId")
    job_id = data.get("jobId")
    tenant_id = data.get("tenantId")
    product_id = data.get("productId")
    source_key = data.get("sourceKey")

    if not all([media_id, job_id, tenant_id, source_key]):
        raise ValueError("Missing required fields for ingestion")

    tmp_master = tempfile.NamedTemporaryFile(delete=False, suffix=Path(source_key).suffix).name
    tmp_audio = tempfile.NamedTemporaryFile(delete=False, suffix=".wav").name

    try:
        download_file(source_key, tmp_master)

        probe = run_ffprobe(tmp_master)
        duration = probe.get("duration", 0)
        video_codec = probe.get("videoCodec", "unknown")
        width = probe.get("videoWidth") or 0
        height = probe.get("videoHeight") or 0

        audio_key = f"audio/{tenant_id}/{media_id}/audio.wav"
        extract_audio(tmp_master, tmp_audio)
        upload_file(tmp_audio, audio_key, "audio/wav")

        checksum = _sha256_file(tmp_master)
        file_size = get_file_size(tmp_master)

        normalized_key = f"masters/{tenant_id}/{media_id}/normalized.mp4"
        upload_file(tmp_master, normalized_key, "video/mp4")

        logger.info(
            "Ingestion complete: media=%s duration=%ss codec=%s %dx%d",
            media_id, duration, video_codec, width, height,
        )

        return WorkerResultRequest(
            jobId=job_id,
            stepId=data.get("stepId", ""),
            resultType="MediaIngestionCompleted",
            idempotencyKey=idempotency_key,
            workerId=f"python-media-worker-{os.uname().nodename}",
            durationMs=0,
            result={
                "mediaId": media_id,
                "jobId": job_id,
                "normalizedKey": normalized_key,
                "audioKey": audio_key,
                "durationSeconds": duration,
                "codec": video_codec,
                "width": width,
                "height": height,
                "fileSize": file_size,
                "checksum": checksum,
            },
        )
    finally:
        cleanup_temp_files(tmp_master, tmp_audio)


def _sha256_file(path: str) -> str:
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()
