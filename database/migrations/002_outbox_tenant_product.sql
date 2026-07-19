-- Migration 002 : Ajout tenant_id et product_id aux outbox_events
ALTER TABLE media_pipeline.outbox_events 
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT;

CREATE INDEX IF NOT EXISTS idx_outbox_events_tenant ON media_pipeline.outbox_events(tenant_id);
