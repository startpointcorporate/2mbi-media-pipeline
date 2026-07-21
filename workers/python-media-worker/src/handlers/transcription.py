import hashlib
import json
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any

from src.config import settings
from src.ffmpeg_utils import cleanup_temp_files
from src.minio_client import download_file, upload_bytes
from src.models import WorkerResultRequest
from src.subtitle_utils import segments_to_srt, segments_to_vtt

logger = logging.getLogger(__name__)


async def handle_transcription(data: dict[str, Any], idempotency_key: str) -> WorkerResultRequest:
    media_id = data.get("mediaId")
    job_id = data.get("jobId")
    tenant_id = data.get("tenantId")
    product_id = data.get("productId")
    audio_key = data.get("audioKey")
    language = data.get("language", "fr")

    if not all([media_id, job_id, tenant_id, audio_key]):
        raise ValueError("Missing required fields for transcription")

    tmp_audio = tempfile.NamedTemporaryFile(delete=False, suffix=".wav").name

    try:
        download_file(audio_key, tmp_audio)

        segments, duration, full_text = _run_faster_whisper(tmp_audio, language)

        transcript_id = str(uuid.uuid4())

        json_data = json.dumps(
            {
                "mediaId": media_id,
                "transcriptId": transcript_id,
                "language": language,
                "durationSeconds": duration,
                "text": full_text,
                "segments": segments,
                "wordCount": sum(len(s["text"].split()) for s in segments),
            },
            ensure_ascii=False,
            indent=2,
        )

        transcript_key = f"transcripts/{tenant_id}/{media_id}/{transcript_id}.json"
        srt_key = f"transcripts/{tenant_id}/{media_id}/{transcript_id}.srt"
        vtt_key = f"transcripts/{tenant_id}/{media_id}/{transcript_id}.vtt"

        srt_content = segments_to_srt(segments)
        vtt_content = segments_to_vtt(segments)

        upload_bytes(json_data.encode("utf-8"), transcript_key, "application/json")
        upload_bytes(srt_content.encode("utf-8"), srt_key, "text/plain")
        upload_bytes(vtt_content.encode("utf-8"), vtt_key, "text/plain")

        logger.info(
            "Transcription complete: media=%s segments=%d duration=%ss lang=%s",
            media_id,
            len(segments),
            duration,
            language,
        )

        return WorkerResultRequest(
            jobId=job_id,
            stepId=data.get("stepId", ""),
            resultType="TranscriptionCompleted",
            idempotencyKey=idempotency_key,
            workerId=f"python-media-worker-{os.uname().nodename}",
            durationMs=0,
            result={
                "mediaId": media_id,
                "jobId": job_id,
                "transcriptId": transcript_id,
                "transcriptKey": transcript_key,
                "srtKey": srt_key,
                "vttKey": vtt_key,
                "language": language,
                "segmentCount": len(segments),
                "durationSeconds": duration,
            },
        )
    finally:
        cleanup_temp_files(tmp_audio)


def _run_faster_whisper(audio_path: str, language: str) -> tuple[list[dict[str, Any]], float, str]:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError(
            "faster-whisper is not installed. Install with: pip install faster-whisper"
        )

    model = WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
        download_root=settings.whisper_model_cache_path,
    )

    vad_filter = settings.whisper_vad_filter
    segments_list: list[dict[str, Any]] = []
    full_text_parts: list[str] = []
    total_duration = 0.0

    seg_iter, info = model.transcribe(
        audio_path,
        language=language if language and language != "auto" else None,
        vad_filter=vad_filter,
        beam_size=5,
        word_timestamps=True,
    )

    for seg_id, segment in enumerate(seg_iter, 1):
        words = (
            [
                {"word": w.word, "start": w.start, "end": w.end, "confidence": w.probability}
                for w in (segment.words or [])
            ]
        )

        segments_list.append({
            "segmentId": seg_id,
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "text": segment.text.strip(),
            "confidence": round(segment.avg_logprob, 4) if segment.avg_logprob else None,
            "words": words,
        })
        full_text_parts.append(segment.text.strip())
        total_duration = segment.end

    full_text = " ".join(full_text_parts)

    return segments_list, round(total_duration, 3), full_text
