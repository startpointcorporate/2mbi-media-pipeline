import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from src.config import settings

logger = logging.getLogger(__name__)


def run_ffprobe(file_path: str) -> dict[str, Any]:
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file_path,
    ]
    logger.info("Running ffprobe: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")

    data = json.loads(result.stdout)

    video_stream = None
    audio_stream = None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video" and video_stream is None:
            video_stream = stream
        elif stream.get("codec_type") == "audio" and audio_stream is None:
            audio_stream = stream

    fmt = data.get("format", {})
    return {
        "duration": float(fmt.get("duration", 0)),
        "bitRate": int(fmt.get("bit_rate", 0)) if fmt.get("bit_rate") else 0,
        "formatName": fmt.get("format_name", ""),
        "videoCodec": video_stream.get("codec_name") if video_stream else None,
        "videoWidth": video_stream.get("width") if video_stream else None,
        "videoHeight": video_stream.get("height") if video_stream else None,
        "videoFps": _parse_fps(video_stream) if video_stream else None,
        "audioCodec": audio_stream.get("codec_name") if audio_stream else None,
        "audioChannels": audio_stream.get("channels") if audio_stream else None,
        "audioSampleRate": audio_stream.get("sample_rate") if audio_stream else None,
    }


def _parse_fps(stream: dict) -> float | None:
    fps_str = stream.get("r_frame_rate", "")
    if fps_str and "/" in fps_str:
        parts = fps_str.split("/")
        try:
            return float(parts[0]) / float(parts[1])
        except (ValueError, ZeroDivisionError):
            pass
    return None


def extract_audio(input_path: str, output_path: str) -> str:
    cmd = [
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-vn",
        "-c:a", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        output_path,
    ]
    logger.info("Extracting audio: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {result.stderr}")
    return output_path


def generate_clip(
    input_path: str,
    output_path: str,
    start_time: float,
    duration: float,
    faststart: bool = True,
    reencode: bool = True,
) -> str:
    if reencode:
        cmd = [
            "ffmpeg",
            "-y",
            "-ss", str(start_time),
            "-i", input_path,
            "-t", str(duration),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-pix_fmt", "yuv420p",
        ]
    else:
        cmd = [
            "ffmpeg",
            "-y",
            "-ss", str(start_time),
            "-i", input_path,
            "-t", str(duration),
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
        ]
    if faststart:
        cmd.extend(["-movflags", "+faststart"])
    cmd.append(output_path)

    logger.info("Generating clip: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"Clip generation failed: {result.stderr}")
    return output_path


def render_format(
    input_path: str,
    output_path: str,
    width: int,
    height: int,
    strategy: str = "contain",
    faststart: bool = True,
) -> str:
    filter_complex = _build_scale_filter(width, height, strategy)
    cmd = [
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-vf", filter_complex,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-pix_fmt", "yuv420p",
    ]
    if faststart:
        cmd.extend(["-movflags", "+faststart"])
    cmd.append(output_path)

    logger.info("Rendering format %s: %s", strategy, " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"Format render failed: {result.stderr}")
    return output_path


def _build_scale_filter(width: int, height: int, strategy: str) -> str:
    if strategy == "crop":
        return f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    elif strategy == "contain":
        return f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"
    elif strategy == "blur-background":
        return (
            f"split[original][copy];"
            f"[copy]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=20[bg];"
            f"[original]scale={width}:{height}:force_original_aspect_ratio=decrease[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2"
        )
    elif strategy == "center-crop":
        return f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    else:
        return f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"


def burn_subtitles(
    video_path: str,
    subtitle_path: str,
    output_path: str,
    font_name: str = "Arial",
    font_size: int = 24,
    primary_color: str = "white",
    outline_color: str = "black",
    outline_width: int = 2,
    alignment: int = 2,
    margin_v: int = 50,
) -> str:
    style = (
        f"FontName={font_name},FontSize={font_size},"
        f"PrimaryColour=&H{_color_to_ass(primary_color)},"
        f"OutlineColour=&H{_color_to_ass(outline_color)},"
        f"Outline={outline_width},Alignment={alignment},"
        f"MarginV={margin_v}"
    )
    cmd = [
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-vf", f"subtitles={subtitle_path}:force_style='{style}'",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "copy",
        "-movflags", "+faststart",
        output_path,
    ]
    logger.info("Burning subtitles: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"Subtitle burn failed: {result.stderr}")
    return output_path


def apply_branding(
    video_path: str,
    output_path: str,
    brand_config: dict[str, Any],
) -> str:
    filters = []
    if "logo" in brand_config:
        logo = brand_config["logo"]
        logo_key = logo.get("key")
        if logo_key:
            tmp_logo = _download_to_temp(logo_key)
            position = logo.get("position", "bottom-right")
            margin_x = logo.get("marginX", 20)
            margin_y = logo.get("marginY", 20)
            opacity = logo.get("opacity", 1.0)
            w_pct = logo.get("widthPct", 10) / 100
            overlay = f"overlay={_overlay_x(position, margin_x)}:{_overlay_y(position, margin_y)}"
            filters.append(f"movie={tmp_logo},scale=iw*{w_pct}:-1[logo];")
            if opacity < 1.0:
                filters.append(f"[logo]format=rgba,colorchannelmixer=aa={opacity}[logoa];")
                filters.append(overlay.replace("[logo]", "[logoa]"))
            else:
                filters.append(overlay)

    if "intro" in brand_config and brand_config["intro"].get("enabled"):
        pass

    if filters:
        filter_str = ";".join(filters)
        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-filter_complex", filter_str,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "copy",
            "-movflags", "+faststart",
            output_path,
        ]
    else:
        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-c", "copy",
            "-movflags", "+faststart",
            output_path,
        ]

    logger.info("Applying branding: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"Branding failed: {result.stderr}")
    return output_path


def _overlay_x(position: str, margin: int) -> str:
    if "right" in position:
        return f"main_w-overlay_w-{margin}"
    elif "center" in position:
        return f"(main_w-overlay_w)/2"
    return str(margin)


def _overlay_y(position: str, margin: int) -> str:
    if "bottom" in position:
        return f"main_h-overlay_h-{margin}"
    elif "center" in position:
        return f"(main_h-overlay_h)/2"
    return str(margin)


def _color_to_ass(hex_color: str) -> str:
    c = hex_color.lstrip("#")
    return f"{c[4:6]}{c[2:4]}{c[0:2]}" if len(c) == 6 else "FFFFFF"


def _download_to_temp(key: str) -> str:
    from src.minio_client import download_file

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(key).suffix)
    download_file(key, tmp.name)
    return tmp.name


def get_file_size(path: str) -> int:
    return os.path.getsize(path)


def cleanup_temp_files(*paths: str) -> None:
    for p in paths:
        try:
            if os.path.exists(p):
                os.remove(p)
                logger.debug("Cleaned up temp file: %s", p)
        except Exception:
            logger.warning("Failed to clean up temp file: %s", p)
