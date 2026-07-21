import logging
from typing import Any

logger = logging.getLogger(__name__)


def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_vtt_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def segments_to_srt(segments: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for idx, segment in enumerate(segments, 1):
        lines.append(str(idx))
        start = format_timestamp(segment["start"])
        end = format_timestamp(segment["end"])
        lines.append(f"{start} --> {end}")
        lines.append(segment["text"])
        lines.append("")
    return "\n".join(lines)


def segments_to_vtt(segments: list[dict[str, Any]]) -> str:
    lines: list[str] = ["WEBVTT", ""]
    for idx, segment in enumerate(segments, 1):
        start = format_vtt_timestamp(segment["start"])
        end = format_vtt_timestamp(segment["end"])
        lines.append(f"{start} --> {end}")
        lines.append(segment["text"])
        lines.append("")
    return "\n".join(lines)


def recalc_timecodes(
    segments: list[dict[str, Any]],
    clip_start: float,
    clip_end: float | None = None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for seg in segments:
        seg_end = seg["end"]
        seg_start = seg["start"]
        if seg_end <= clip_start:
            continue
        if clip_end is not None and seg_start >= clip_end:
            continue
        if seg_start >= clip_start:
            result.append({
                **seg,
                "start": seg_start - clip_start,
                "end": seg_end - clip_start,
            })
        else:
            result.append({
                **seg,
                "start": 0.0,
                "end": seg_end - clip_start,
            })
    return result
