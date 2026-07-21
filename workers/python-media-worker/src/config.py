from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    consumer_group: str = "2mbi:group:media-workers"
    stream_tasks: str = "2mbi:media:tasks"
    media_api_url: str = "http://media-pipeline-api:3001"
    media_api_key: str = "internal_secret_key"
    media_capabilities: str = "IngestionRequested,TranscriptionRequested,RenderVideoRequested,RenderImageRequested"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "2mbi-media"
    minio_use_ssl: bool = False
    whisper_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_vad_filter: bool = True
    whisper_max_concurrency: int = 1
    whisper_model_cache_path: str = "/models/whisper"
    clip_lead_in_seconds: float = 0.5
    clip_lead_out_seconds: float = 0.8
    clip_min_duration_seconds: float = 15.0
    clip_max_duration_seconds: float = 60.0
    render_profiles: str = '{"landscape":{"width":1920,"height":1080,"strategy":"contain"},"portrait":{"width":1080,"height":1920,"strategy":"blur-background"},"square":{"width":1080,"height":1080,"strategy":"contain"}}'
    heartbeat_interval_seconds: int = 15
    lease_duration_seconds: int = 60
    temp_dir: str = "/tmp/media-worker"

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
