-- Migration 001 : Schéma initial du pipeline média
-- Tables : media_assets, media_jobs, media_job_steps, outbox_events
-- Version : 1.0 | Idempotent

CREATE SCHEMA IF NOT EXISTS media_pipeline;

-- ═══ MEDIA ASSETS ═══
CREATE TABLE IF NOT EXISTS media_pipeline.media_assets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type         TEXT NOT NULL,
    file_size         BIGINT NOT NULL,
    source_key        TEXT NOT NULL,
    normalized_key    TEXT,
    audio_key         TEXT,
    sha256            TEXT,
    metadata          JSONB NOT NULL DEFAULT '{}',
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══ MEDIA JOBS ═══
CREATE TABLE IF NOT EXISTS media_pipeline.media_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_asset_id   UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    tenant_id        TEXT NOT NULL,
    product_id       TEXT NOT NULL,
    pipeline_profile TEXT NOT NULL,
    workflow_version TEXT NOT NULL DEFAULT '1.0',
    status           TEXT NOT NULL DEFAULT 'pending',
    correlation_id   UUID NOT NULL,
    error_message    TEXT,
    version          INT NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_jobs_media_asset_id ON media_pipeline.media_jobs(media_asset_id);

-- ═══ MEDIA JOB STEPS ═══
CREATE TABLE IF NOT EXISTS media_pipeline.media_job_steps (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES media_pipeline.media_jobs(id) ON DELETE CASCADE,
    step_name         TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    attempt_count     INT NOT NULL DEFAULT 0,
    max_attempts      INT NOT NULL DEFAULT 3,
    error_message     TEXT,
    result            JSONB,
    idempotency_key   TEXT NOT NULL UNIQUE,
    worker_id         TEXT,
    last_heartbeat_at TIMESTAMPTZ,
    lease_expires_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_job_steps_job_id ON media_pipeline.media_job_steps(job_id);

-- ═══ OUTBOX EVENTS ═══
CREATE TABLE IF NOT EXISTS media_pipeline.outbox_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type        TEXT NOT NULL,
    payload           JSONB NOT NULL,
    correlation_id    UUID NOT NULL,
    causation_id      UUID,
    idempotency_key   TEXT NOT NULL UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at      TIMESTAMPTZ,
    attempts          INT NOT NULL DEFAULT 0,
    max_attempts      INT NOT NULL DEFAULT 10,
    error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_processed_created ON media_pipeline.outbox_events(processed_at, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_events_idempotency_key ON media_pipeline.outbox_events(idempotency_key);

-- ═══ TRIGGER : updated_at automatique ═══
CREATE OR REPLACE FUNCTION media_pipeline.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'media_pipeline'
          AND tablename IN ('media_assets', 'media_jobs')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I_updated_at ON media_pipeline.%I;
             CREATE TRIGGER %I_updated_at BEFORE UPDATE ON media_pipeline.%I
             FOR EACH ROW EXECUTE FUNCTION media_pipeline.set_updated_at()',
            t, t, t, t
        );
    END LOOP;
END $$;
