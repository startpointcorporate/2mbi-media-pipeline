from typing import Any

from pydantic import BaseModel, Field


class TaskMessage(BaseModel):
    model_config = {"populate_by_name": True}

    schema_version: int | None = Field(default=1, alias="schemaVersion")
    idempotency_key: str = Field(alias="idempotencyKey")
    correlation_id: str = Field(alias="correlationId")
    step: str
    data: dict[str, Any]


class WorkerResultRequest(BaseModel):
    model_config = {"populate_by_name": True}

    job_id: str = Field(alias="jobId")
    step_id: str = Field(alias="stepId")
    idempotency_key: str = Field(alias="idempotencyKey")
    result_type: str = Field(alias="resultType")
    result: dict[str, Any]
