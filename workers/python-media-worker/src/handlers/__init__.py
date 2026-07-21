from collections.abc import Callable
from typing import Any

from src.handlers.ingestion import handle_ingestion
from src.handlers.render_image import handle_render_image
from src.handlers.render_video import handle_render_video
from src.handlers.transcription import handle_transcription

HANDLERS: dict[str, Callable[..., Any]] = {
    "IngestionRequested": handle_ingestion,
    "TranscriptionRequested": handle_transcription,
    "RenderVideoRequested": handle_render_video,
    "RenderImageRequested": handle_render_image,
}

__all__ = ["HANDLERS"]
