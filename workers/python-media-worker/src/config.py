from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    consumer_group: str = "group:media-workers"
    stream_tasks: str = "stream:media-tasks"
    media_api_url: str = "http://media-pipeline-api:3001"
    media_capabilities: str = "ingestion,transcription,render-video,render-image"

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
