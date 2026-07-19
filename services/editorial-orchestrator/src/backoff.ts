export const BACKOFF_SECONDS: Record<string, number[]> = {
  'IngestionRequested': [30, 120, 600],
  'TranscriptionRequested': [60, 300, 900],
  'RenderVideoRequested': [60, 300, 900],
  'RenderImageRequested': [30, 120, 600],
  'EditorialAnalysisRequested': [30, 120, 600],
  'PublishRequested': [30, 120, 600],
  'PublishingStatusCheckRequested': [300, 900, 1800],
};

export const MAX_ATTEMPTS = 3;
