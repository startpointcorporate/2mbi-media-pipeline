import hashlib
import json
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any

from src.config import settings
from src.ffmpeg_utils import (
    apply_branding,
    burn_subtitles,
    cleanup_temp_files,
    generate_clip,
    get_file_size,
    render_format,
)
from src.minio_client import download_file, upload_file
from src.models import WorkerResultRequest

logger = logging.getLogger(__name__)


async def handle_render_video(data: dict[str, Any], idempotency_key: str) -> WorkerResultRequest:
    media_id = data.get("mediaId")
    job_id = data.get("jobId")
    tenant_id = data.get("tenantId", "unknown")
    product_id = data.get("productId", "unknown")
    clip_id = data.get("clipId", str(uuid.uuid4()))
    render_profile = data.get("renderProfile", {})
    source_key = data.get("sourceKey")
    srt_key = data.get("srtKey")
    caption_profile = data.get("captionProfile", {})
    brand_profile_id = data.get("brandProfileId")
    output_prefix = data.get("outputPrefix", f"renders/{tenant_id}/{media_id}/{clip_id}")

    if not all([media_id, job_id, source_key]):
        raise ValueError("Missing required fields for render")

    format_name = render_profile.get("name", render_profile.get("format", "16:9"))
    strategy = render_profile.get("strategy", "contain")
    width = render_profile.get("width", 1920)
    height = render_profile.get("height", 1080)
    faststart = render_profile.get("faststart", True)

    tmp_source = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    tmp_rendered = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    tmp_captioned = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    tmp_srt: str | None = None
    tmp_branded = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name

    try:
        download_file(source_key, tmp_source)

        render_format(tmp_source, tmp_rendered, width, height, strategy, faststart)

        current = tmp_rendered
        has_captions = False
        has_branding = False

        if srt_key and caption_profile.get("enabled"):
            tmp_srt = tempfile.NamedTemporaryFile(delete=False, suffix=".srt").name
            download_file(srt_key, tmp_srt)
            style = caption_profile.get("style", {})
            burn_subtitles(
                current,
                tmp_srt,
                tmp_captioned,
                font_name=style.get("fontName", "Arial"),
                font_size=style.get("fontSize", 24),
                primary_color=style.get("primaryColor", "white"),
                outline_color=style.get("outlineColor", "black"),
                outline_width=style.get("outlineWidth", 2),
            )
            current = tmp_captioned
            has_captions = True

        if brand_profile_id:
            try:
                brand_config = _load_brand_config(brand_profile_id)
                apply_branding(current, tmp_branded, brand_config)
                current = tmp_branded
                has_branding = True
            except Exception as e:
                logger.warning("Branding failed (continuing without): %s", e)

        rendered_key = f"{output_prefix}/{format_name}.mp4"
        upload_file(current, rendered_key, "video/mp4")

        file_size = get_file_size(current)
        checksum = _sha256_file(current)
        asset_id = str(uuid.uuid4())

        logger.info(
            "Render complete: clip=%s format=%s %dx%d captions=%s branding=%s",
            clip_id, format_name, width, height, has_captions, has_branding,
        )

        return WorkerResultRequest(
            jobId=job_id,
            stepId=data.get("stepId", ""),
            resultType="RenderCompleted",
            idempotencyKey=idempotency_key,
            workerId=f"python-media-worker-{os.uname().nodename}",
            durationMs=0,
            result={
                "mediaId": media_id,
                "jobId": job_id,
                "clipId": clip_id,
                "assets": [
                    {
                        "assetId": asset_id,
                        "format": format_name,
                        "key": rendered_key,
                        "width": width,
                        "height": height,
                        "fileSize": file_size,
                        "mimeType": "video/mp4",
                        "hasCaptions": has_captions,
                        "hasBranding": has_branding,
                        "checksum": checksum,
                    }
                ],
            },
        )
    finally:
        cleanup_temp_files(tmp_source, tmp_rendered, tmp_captioned, tmp_branded)
        if tmp_srt:
            cleanup_temp_files(tmp_srt)


def _load_brand_config(brand_profile_id: str) -> dict[str, Any]:
    try:
        brand_key = f"branding/{brand_profile_id}/config.json"
        from src.minio_client import download_file

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json").name
        try:
            download_file(brand_key, tmp)
            with open(tmp, "r") as f:
                return json.load(f)
        finally:
            cleanup_temp_files(tmp)
    except Exception:
        return {}


def _sha256_file(path: str) -> str:
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()
