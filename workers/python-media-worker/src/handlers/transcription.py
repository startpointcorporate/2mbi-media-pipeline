import logging
import time
import uuid

from src.config import Settings
from src.models import TaskMessage, WorkerResultRequest

logger = logging.getLogger(__name__)


def handle_transcription(task: TaskMessage, settings: Settings) -> WorkerResultRequest:
    logger.info("=== Transcription handler (mock) ===")
    logger.info("Would run: WhisperX for automatic speech recognition")
    logger.info("Would run: speaker diarization via pyannote.audio")
    logger.info("Would run: word-level timestamps alignment")
    logger.info("Would upload: transcript JSON to MinIO")
    logger.info("=== Transcription complete ===")

    time.sleep(2)

    return WorkerResultRequest(
        jobId=task.data.get("jobId", ""),
        stepId=task.data.get("stepId", ""),
        idempotencyKey=task.idempotency_key,
        resultType="TranscriptionCompleted",
        result={
            "transcriptId": uuid.uuid4().hex[:12],
            "segmentCount": 42,
        },
    )
