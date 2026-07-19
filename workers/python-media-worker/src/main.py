import logging
import time
import uuid
from collections.abc import Callable
from threading import Event, Thread
from typing import Any, cast

import httpx
import redis as redis_lib

from src.capabilities import supports_step
from src.config import settings
from src.handlers import handle_ingestion
from src.models import TaskMessage, WorkerResultRequest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("python-media-worker")

HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "ingestion": handle_ingestion,
}


def send_heartbeat(
    client: httpx.Client,
    worker_id: str,
    active_steps: list[dict[str, Any]],
) -> None:
    for step in active_steps:
        step_id = step.get("stepId")
        if not step_id:
            continue
        try:
            resp = client.post(
                f"{settings.media_api_url}/internal/job-steps/{step_id}/heartbeat",
                json={
                    "workerId": worker_id,
                    "progress": step.get("progress", 0),
                    "leaseDurationSeconds": 60,
                },
                timeout=10,
            )
            logger.debug("Heartbeat for step %s: %s", step_id, resp.status_code)
        except Exception as exc:
            logger.warning("Heartbeat failed for step %s: %s", step_id, exc)


def heartbeat_loop(worker_id: str, stop: Event) -> None:
    active_steps: list[dict[str, Any]] = []
    with httpx.Client(base_url=settings.media_api_url) as client:
        while not stop.is_set():
            send_heartbeat(client, worker_id, active_steps)
            stop.wait(15)


def main() -> None:
    worker_id = str(uuid.uuid4())
    logger.info("Starting Python Media Worker [%s]", worker_id)
    logger.info("Capabilities: %s", settings.media_capabilities)

    redis_client = redis_lib.Redis.from_url(settings.redis_url)
    redis_client.ping()
    logger.info("Connected to Redis")

    try:
        redis_client.xgroup_create(
            settings.stream_tasks,
            settings.consumer_group,
            id="0",
            mkstream=True,
        )
        logger.info(
            "Consumer group '%s' ready on '%s'",
            settings.consumer_group,
            settings.stream_tasks,
        )
    except redis_lib.ResponseError as exc:
        if "BUSYGROUP" in str(exc):
            logger.info("Consumer group '%s' already exists", settings.consumer_group)
        else:
            raise

    stop_heartbeat = Event()
    heartbeat_thread = Thread(
        target=heartbeat_loop, args=(worker_id, stop_heartbeat), daemon=True
    )
    heartbeat_thread.start()
    logger.info("Heartbeat thread started")

    logger.info("Waiting for messages...")

    while True:
        try:
            raw_results = redis_client.xreadgroup(
                groupname=settings.consumer_group,
                consumername=worker_id,
                streams={settings.stream_tasks: ">"},
                count=1,
                block=5000,
            )
        except Exception as exc:
            logger.error("XREADGROUP error: %s", exc)
            time.sleep(1)
            continue

        if not raw_results:
            continue

        results = cast(list[tuple[Any, list[tuple[Any, dict[Any, Any]]]]], raw_results)
        for stream_name, messages in results:
            for msg_id, msg_data in messages:
                process_message(
                    redis_client, worker_id, stream_name, msg_id, msg_data
                )


def process_message(
    redis_client: redis_lib.Redis,
    worker_id: str,
    stream_name: Any,
    msg_id: Any,
    msg_data: dict[Any, Any],
) -> None:
    decoded: dict[str, Any] = {}
    for k, v in msg_data.items():
        key = k.decode() if isinstance(k, bytes) else k
        decoded[key] = v.decode() if isinstance(v, bytes) else v

    step_name = decoded.get("step", "?")
    logger.info("Received message [%s]: %s", msg_id, step_name)

    try:
        task = TaskMessage.model_validate(decoded)
    except Exception as exc:
        logger.error("Failed to parse message %s: %s", msg_id, exc)
        redis_client.xack(stream_name, settings.consumer_group, msg_id)
        return

    if not supports_step(task.step):
        logger.info("Step '%s' not in capabilities, XACK and skip", task.step)
        redis_client.xack(stream_name, settings.consumer_group, msg_id)
        return

    handler = HANDLERS.get(task.step)
    if handler is None:
        logger.warning("No handler registered for step '%s', XACK and skip", task.step)
        redis_client.xack(stream_name, settings.consumer_group, msg_id)
        return

    try:
        result = handler(task.data)
    except Exception as exc:
        logger.error("Handler failed for step '%s' [%s]: %s", task.step, msg_id, exc)
        redis_client.xack(stream_name, settings.consumer_group, msg_id)
        return

    result_type = {
        "ingestion": "MediaIngestionCompleted",
        "transcription": "TranscriptionCompleted",
        "render-video": "RenderCompleted",
        "render-image": "ImageGenerationCompleted",
    }.get(task.step, f"{task.step}Completed")

    payload = WorkerResultRequest(
        jobId=task.data.get("jobId", ""),
        stepId=task.data.get("stepId", ""),
        idempotencyKey=task.idempotency_key,
        resultType=result_type,
        result=result,
    )

    try:
        with httpx.Client(base_url=settings.media_api_url) as client:
            resp = client.post(
                "/internal/worker-results",
                json=payload.model_dump(by_alias=True),
                timeout=30,
            )
            logger.info("Worker result posted: %s", resp.status_code)
            if resp.status_code >= 400:
                logger.error("API returned %s: %s", resp.status_code, resp.text)
    except Exception as exc:
        logger.error("Failed to post worker result: %s", exc)

    redis_client.xack(stream_name, settings.consumer_group, msg_id)
    logger.info("Message %s acknowledged", msg_id)
