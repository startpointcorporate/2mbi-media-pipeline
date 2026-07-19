import logging
import time
import uuid

from src.config import Settings
from src.models import TaskMessage, WorkerResultRequest

logger = logging.getLogger(__name__)


def handle_render_image(task: TaskMessage, settings: Settings) -> WorkerResultRequest:
    logger.info("=== Image Generation handler (mock) ===")
    logger.info("Would run: image composition via Pillow")
    logger.info("Would run: HTML rendering via Playwright")
    logger.info("Would upload: generated image to MinIO")
    logger.info("=== Image Generation complete ===")

    time.sleep(1)

    return WorkerResultRequest(
        jobId=task.data.get("jobId", ""),
        stepId=task.data.get("stepId", ""),
        idempotencyKey=task.idempotency_key,
        resultType="ImageGenerationCompleted",
        result={
            "generatedAssetId": uuid.uuid4().hex[:12],
        },
    )
