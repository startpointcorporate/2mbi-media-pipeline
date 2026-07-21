-- Migration 004: Media packages table + YouTube metadata

-- ═══ MEDIA PACKAGES ═══
CREATE TABLE IF NOT EXISTS media_pipeline.media_packages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id          UUID NOT NULL REFERENCES media_pipeline.media_assets(id) ON DELETE CASCADE,
    job_id            UUID NOT NULL REFERENCES media_pipeline.media_jobs(id) ON DELETE CASCADE,
    tenant_id         TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    package_key       TEXT,
    modified_key      TEXT,
    archive_key       TEXT,
    file_size         BIGINT,
    checksum          TEXT,
    clip_count        INT NOT NULL DEFAULT 0,
    asset_count       INT NOT NULL DEFAULT 0,
    youtube_metadata  JSONB,
    post_proposals    JSONB,
    validation_notes  TEXT,
    validated_by      TEXT,
    validated_at      TIMESTAMPTZ,
    published_at      TIMESTAMPTZ,
    archived_at       TIMESTAMPTZ,
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_packages_media_id ON media_pipeline.media_packages(media_id);
CREATE INDEX IF NOT EXISTS idx_media_packages_tenant_id ON media_pipeline.media_packages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_packages_status ON media_pipeline.media_packages(status);

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'media_pipeline'
          AND tablename = 'media_packages'
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I_updated_at ON media_pipeline.%I;
             CREATE TRIGGER %I_updated_at BEFORE UPDATE ON media_pipeline.%I
             FOR EACH ROW EXECUTE FUNCTION media_pipeline.set_updated_at()',
            t, t, t, t
        );
    END LOOP;
END $$;
