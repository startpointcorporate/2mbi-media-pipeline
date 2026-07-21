-- Migration 003: Editorial pipeline tables + indexes + constraints
-- Adds: tenant isolation to steps, transcriptions, clips, render profiles,
--        brand profiles, publications, delivery tracking, history

-- ═══ ADD tenant_id/product_id to media_job_steps ═══
ALTER TABLE media_pipeline.media_job_steps
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT;

-- ═══ PERFORMANCE INDEXES ═══
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_id ON media_pipeline.media_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_status ON media_pipeline.media_assets(status);
CREATE INDEX IF NOT EXISTS idx_media_assets_sha256 ON media_pipeline.media_assets(sha256);

CREATE INDEX IF NOT EXISTS idx_media_jobs_tenant_id ON media_pipeline.media_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_jobs_status ON media_pipeline.media_jobs(status);
CREATE INDEX IF NOT EXISTS idx_media_jobs_correlation_id ON media_pipeline.media_jobs(correlation_id);

CREATE INDEX IF NOT EXISTS idx_media_job_steps_tenant_id ON media_pipeline.media_job_steps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_job_steps_status ON media_pipeline.media_job_steps(status);
CREATE INDEX IF NOT EXISTS idx_media_job_steps_lease_expires ON media_pipeline.media_job_steps(lease_expires_at) WHERE lease_expires_at IS NOT NULL;

-- ═══ TRANSCRIPTIONS ═══
CREATE TABLE IF NOT EXISTS media_pipeline.transcriptions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id         UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    job_id           UUID NOT NULL REFERENCES media_pipeline.media_jobs(id) ON DELETE CASCADE,
    tenant_id        TEXT NOT NULL,
    product_id       TEXT NOT NULL,
    language         TEXT NOT NULL DEFAULT 'fr',
    duration_seconds FLOAT NOT NULL,
    full_text        TEXT NOT NULL,
    json_key         TEXT NOT NULL,
    srt_key          TEXT NOT NULL,
    vtt_key          TEXT NOT NULL,
    segment_count    INT NOT NULL,
    word_count       INT,
    model_name       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_media_id ON media_pipeline.transcriptions(media_id);
CREATE INDEX IF NOT EXISTS idx_transcriptions_tenant_id ON media_pipeline.transcriptions(tenant_id);

-- ═══ TRANSCRIPTION SEGMENTS ═══
CREATE TABLE IF NOT EXISTS media_pipeline.transcription_segments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcription_id UUID NOT NULL REFERENCES media_pipeline.transcriptions(id) ON DELETE CASCADE,
    media_id        UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    segment_id      INT NOT NULL,
    start_time      FLOAT NOT NULL,
    end_time        FLOAT NOT NULL,
    text            TEXT NOT NULL,
    speaker         TEXT,
    confidence      FLOAT,
    words           JSONB,
    tenant_id       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(transcription_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_segments_transcription_id ON media_pipeline.transcription_segments(transcription_id);
CREATE INDEX IF NOT EXISTS idx_segments_media_id ON media_pipeline.transcription_segments(media_id);

-- ═══ EDITORIAL PLANS (analysis results) ═══
CREATE TABLE IF NOT EXISTS media_pipeline.editorial_plans (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id         UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    job_id           UUID NOT NULL REFERENCES media_pipeline.media_jobs(id) ON DELETE CASCADE,
    transcription_id UUID REFERENCES media_pipeline.transcriptions(id),
    tenant_id        TEXT NOT NULL,
    product_id       TEXT NOT NULL,
    summary          TEXT NOT NULL,
    raw_result_key   TEXT NOT NULL,
    model_name       TEXT,
    status           TEXT NOT NULL DEFAULT 'draft',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_editorial_plans_media_id ON media_pipeline.editorial_plans(media_id);
CREATE INDEX IF NOT EXISTS idx_editorial_plans_tenant_id ON media_pipeline.editorial_plans(tenant_id);

-- ═══ CLIP PROPOSALS (from editorial analysis) ═══
CREATE TABLE IF NOT EXISTS media_pipeline.clip_proposals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id           UUID NOT NULL REFERENCES media_pipeline.editorial_plans(id) ON DELETE CASCADE,
    media_id          UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    tenant_id         TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    start_segment_id  INT NOT NULL,
    end_segment_id    INT NOT NULL,
    start_time        FLOAT NOT NULL,
    end_time          FLOAT NOT NULL,
    title             TEXT NOT NULL,
    hook              TEXT NOT NULL,
    reason            TEXT,
    score             FLOAT NOT NULL DEFAULT 0,
    platforms         JSONB NOT NULL DEFAULT '[]',
    description       TEXT NOT NULL DEFAULT '',
    hashtags          JSONB NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL DEFAULT 'pending',
    reviewer_id       TEXT,
    reviewed_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clip_proposals_plan_id ON media_pipeline.clip_proposals(plan_id);
CREATE INDEX IF NOT EXISTS idx_clip_proposals_media_id ON media_pipeline.clip_proposals(media_id);
CREATE INDEX IF NOT EXISTS idx_clip_proposals_status ON media_pipeline.clip_proposals(status);
CREATE INDEX IF NOT EXISTS idx_clip_proposals_tenant_id ON media_pipeline.clip_proposals(tenant_id);

-- ═══ GENERATED CLIPS ═══
CREATE TABLE IF NOT EXISTS media_pipeline.clips (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id       UUID REFERENCES media_pipeline.clip_proposals(id),
    media_id          UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    job_id            UUID NOT NULL REFERENCES media_pipeline.media_jobs(id) ON DELETE CASCADE,
    tenant_id         TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    start_time        FLOAT NOT NULL,
    end_time          FLOAT NOT NULL,
    duration_seconds  FLOAT NOT NULL,
    source_key        TEXT NOT NULL,
    title             TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'generated',
    checksum          TEXT,
    file_size         BIGINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clips_media_id ON media_pipeline.clips(media_id);
CREATE INDEX IF NOT EXISTS idx_clips_tenant_id ON media_pipeline.clips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clips_proposal_id ON media_pipeline.clips(proposal_id);

-- ═══ CLIP ASSETS (rendered variants) ═══
CREATE TABLE IF NOT EXISTS media_pipeline.clip_assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clip_id         UUID NOT NULL REFERENCES media_pipeline.clips(id) ON DELETE CASCADE,
    media_id        UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL,
    product_id      TEXT NOT NULL,
    format          TEXT NOT NULL,
    width           INT NOT NULL,
    height          INT NOT NULL,
    key             TEXT NOT NULL,
    file_size       BIGINT NOT NULL,
    duration_ms     INT,
    mime_type       TEXT NOT NULL DEFAULT 'video/mp4',
    has_captions    BOOLEAN NOT NULL DEFAULT false,
    has_branding    BOOLEAN NOT NULL DEFAULT false,
    checksum        TEXT,
    is_public       BOOLEAN NOT NULL DEFAULT false,
    public_url      TEXT,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(clip_id, format, key)
);

CREATE INDEX IF NOT EXISTS idx_clip_assets_clip_id ON media_pipeline.clip_assets(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_assets_media_id ON media_pipeline.clip_assets(media_id);
CREATE INDEX IF NOT EXISTS idx_clip_assets_is_public ON media_pipeline.clip_assets(is_public) WHERE is_public = true;

-- ═══ RENDER PROFILES ═══
CREATE TABLE IF NOT EXISTS media_pipeline.render_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL DEFAULT '_default',
    name            TEXT NOT NULL,
    format          TEXT NOT NULL,
    width           INT NOT NULL,
    height          INT NOT NULL,
    strategy        TEXT NOT NULL DEFAULT 'contain',
    codec           TEXT NOT NULL DEFAULT 'h264',
    audio_codec     TEXT NOT NULL DEFAULT 'aac',
    faststart       BOOLEAN NOT NULL DEFAULT true,
    bitrate         TEXT,
    audio_bitrate   TEXT,
    fps             INT,
    pixel_format    TEXT NOT NULL DEFAULT 'yuv420p',
    is_default      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_render_profiles_tenant_id ON media_pipeline.render_profiles(tenant_id);

-- ═══ BRAND PROFILES ═══
CREATE TABLE IF NOT EXISTS media_pipeline.brand_profiles (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         TEXT NOT NULL,
    name              TEXT NOT NULL,
    config            JSONB NOT NULL DEFAULT '{}',
    is_default        BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_brand_profiles_tenant_id ON media_pipeline.brand_profiles(tenant_id);

-- ═══ MEDIA PUBLICATIONS ═══
CREATE TABLE IF NOT EXISTS media_pipeline.media_publications (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id          UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    job_id            UUID NOT NULL REFERENCES media_pipeline.media_jobs(id) ON DELETE CASCADE,
    tenant_id         TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'draft',
    scheduled_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_publications_media_id ON media_pipeline.media_publications(media_id);
CREATE INDEX IF NOT EXISTS idx_media_publications_tenant_id ON media_pipeline.media_publications(tenant_id);

-- ═══ POSTIZ PUBLICATIONS (external references) ═══
CREATE TABLE IF NOT EXISTS media_pipeline.postiz_publications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id      UUID NOT NULL REFERENCES media_pipeline.media_publications(id) ON DELETE CASCADE,
    media_id            UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    tenant_id           TEXT NOT NULL,
    channel             TEXT NOT NULL,
    external_id         TEXT,
    status              TEXT NOT NULL DEFAULT 'draft',
    public_url          TEXT,
    error_message       TEXT,
    attempt_count       INT NOT NULL DEFAULT 0,
    idempotency_key     TEXT NOT NULL UNIQUE,
    scheduled_at        TIMESTAMPTZ,
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_postiz_publications_publication_id ON media_pipeline.postiz_publications(publication_id);
CREATE INDEX IF NOT EXISTS idx_postiz_publications_media_id ON media_pipeline.postiz_publications(media_id);
CREATE INDEX IF NOT EXISTS idx_postiz_publications_external_id ON media_pipeline.postiz_publications(external_id);
CREATE INDEX IF NOT EXISTS idx_postiz_publications_idempotency ON media_pipeline.postiz_publications(idempotency_key);

-- ═══ PIPELINE HISTORY (audit log) ═══
CREATE TABLE IF NOT EXISTS media_pipeline.pipeline_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id        UUID NOT NULL,
    job_id          UUID,
    tenant_id       TEXT NOT NULL,
    step_type       TEXT NOT NULL,
    action          TEXT NOT NULL,
    status          TEXT NOT NULL,
    actor           TEXT,
    details         JSONB,
    correlation_id  UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_history_media_id ON media_pipeline.pipeline_history(media_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_tenant_id ON media_pipeline.pipeline_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_created_at ON media_pipeline.pipeline_history(created_at);

-- ═══ TRIGGER: updated_at for new tables ═══
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
          AND tablename IN (
            'media_assets', 'media_jobs',
            'transcriptions', 'editorial_plans', 'clip_proposals',
            'clips', 'clip_assets', 'brand_profiles',
            'media_publications', 'postiz_publications'
          )
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I_updated_at ON media_pipeline.%I;
             CREATE TRIGGER %I_updated_at BEFORE UPDATE ON media_pipeline.%I
             FOR EACH ROW EXECUTE FUNCTION media_pipeline.set_updated_at()',
            t, t, t, t
        );
    END LOOP;
END $$;

-- ═══ SEED DEFAULT RENDER PROFILES ═══
INSERT INTO media_pipeline.render_profiles (tenant_id, name, format, width, height, strategy, codec, audio_codec, faststart, is_default)
VALUES
  ('_default', 'landscape-1080p', '16:9', 1920, 1080, 'contain', 'h264', 'aac', true, false),
  ('_default', 'portrait-1080p', '9:16', 1080, 1920, 'blur-background', 'h264', 'aac', true, false),
  ('_default', 'square-1080p', '1:1', 1080, 1080, 'contain', 'h264', 'aac', true, false)
ON CONFLICT (tenant_id, name) DO NOTHING;
