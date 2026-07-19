import logging
import signal
import time
import uuid
from threading import Event, Lock, Thread
from typing import Any, cast

import httpx
import redis as redis_lib

from src.capabilities import supports_step
from src.config import settings
from src.handlers import HANDLERS
from src.models import TaskMessage, WorkerResultRequest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("python-media-worker")

_active_steps: set[str] = set()
_active_steps_lock = Lock()


def send_heartbeat(
    client: httpx.Client,
    worker_id: str,
) -> None:
    with _active_steps_lock:
        step_ids = list(_active_steps)
    for step_id in step_ids:
        if not step_id:
            continue
        try:
            resp = client.post(
                f"{settings.media_api_url}/internal/job-steps/{step_id}/heartbeat",
                json={
                    "workerId": worker_id,
                    "progress": 0,
                    "leaseDurationSeconds": 60,
                },
                timeout=10,
            )
            logger.debug("Heartbeat for step %s: %s", step_id, resp.status_code)
        except Exception as exc:
            logger.warning("Heartbeat failed for step %s: %s", step_id, exc)


def heartbeat_loop(worker_id: str, stop: Event) -> None:
    with httpx.Client(base_url=settings.media_api_url) as client:
        while not stop.is_set():
            send_heartbeat(client, worker_id)
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

    shutdown = Event()

    def handle_signal(signum: int, _frame: Any) -> None:
        logger.info("Received signal %d, shutting down...", signum)
        shutdown.set()
        stop_heartbeat.set()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    logger.info("Waiting for messages...")

    while not shutdown.is_set():
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

    heartbeat_thread.join(timeout=5)
    logger.info("Worker shut down gracefully")


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

    step_id = task.data.get("stepId", "")
    if step_id:
        with _active_steps_lock:
            _active_steps.add(step_id)

    try:
        result = handler(task, settings)
    except Exception as exc:
        logger.error("Handler failed for step '%s' [%s]: %s", task.step, msg_id, exc)
        redis_client.xack(stream_name, settings.consumer_group, msg_id)
        return
    finally:
        if step_id:
            with _active_steps_lock:
                _active_steps.discard(step_id)

    try:
        with httpx.Client(base_url=settings.media_api_url) as client:
            resp = client.post(
                "/internal/worker-results",
                json=result.model_dump(by_alias=True),
                timeout=30,
            )
            logger.info("Worker result posted: %s", resp.status_code)
            if resp.status_code >= 400:
                logger.error("API returned %s: %s", resp.status_code, resp.text)
    except Exception as exc:
        logger.error("Failed to post worker result: %s", exc)

    redis_client.xack(stream_name, settings.consumer_group, msg_id)
    logger.info("Message %s acknowledged", msg_id)
