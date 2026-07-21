import logging
import os
import tempfile
from typing import Optional

import httpx
from minio import Minio
from minio.error import S3Error

from src.config import settings

logger = logging.getLogger(__name__)

_client: Optional[Minio] = None


def get_minio_client() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_use_ssl,
        )
        _ensure_bucket(_client)
    return _client


def _ensure_bucket(client: Minio) -> None:
    try:
        if not client.bucket_exists(settings.minio_bucket):
            client.make_bucket(settings.minio_bucket)
            logger.info("Created bucket: %s", settings.minio_bucket)
    except S3Error as e:
        logger.error("Failed to ensure bucket %s: %s", settings.minio_bucket, e)


def upload_file(local_path: str, object_key: str, content_type: str = "application/octet-stream") -> str:
    client = get_minio_client()
    client.fput_object(
        bucket_name=settings.minio_bucket,
        object_name=object_key,
        file_path=local_path,
        content_type=content_type,
    )
    logger.info("Uploaded %s -> %s/%s", local_path, settings.minio_bucket, object_key)
    return object_key


def download_file(object_key: str, local_path: str) -> str:
    client = get_minio_client()
    client.fget_object(
        bucket_name=settings.minio_bucket,
        object_name=object_key,
        file_path=local_path,
    )
    logger.info("Downloaded %s/%s -> %s", settings.minio_bucket, object_key, local_path)
    return local_path


def upload_bytes(data: bytes, object_key: str, content_type: str = "application/octet-stream") -> str:
    import io
    client = get_minio_client()
    client.put_object(
        bucket_name=settings.minio_bucket,
        object_name=object_key,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    logger.info("Uploaded bytes -> %s/%s (%d bytes)", settings.minio_bucket, object_key, len(data))
    return object_key


def presigned_get_url(object_key: str, expires_seconds: int = 900) -> str:
    client = get_minio_client()
    return client.presigned_get_object(
        bucket_name=settings.minio_bucket,
        object_name=object_key,
        expires=expires_seconds,
    )


def object_exists(object_key: str) -> bool:
    client = get_minio_client()
    try:
        client.stat_object(settings.minio_bucket, object_key)
        return True
    except S3Error:
        return False
