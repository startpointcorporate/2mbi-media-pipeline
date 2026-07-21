import { parseEnv } from '../env.js';

export interface EditorialAiProvider {
  analyzeTranscript(request: EditorialAnalysisRequest): Promise<EditorialAnalysisResult>;
}

export interface SegmentRef {
  segmentId: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface EditorialAnalysisRequest {
  mediaId: string;
  tenantId: string;
  productId: string;
  language: string;
  contentType?: string;
  editorialGoals?: string;
  targetPlatforms: string[];
  constraints: {
    minimumClipDurationSeconds: number;
    maximumClipDurationSeconds: number;
    maximumClipCount: number;
  };
  segments: SegmentRef[];
  brandRules?: string;
  exclusions?: string[];
}

export interface ClipProposal {
  startSegmentId: number;
  endSegmentId: number;
  title: string;
  hook: string;
  reason: string;
  score: number;
  platforms: string[];
  description: string;
  hashtags: string[];
}

export interface YouTubeMetadataResult {
  title: string;
  description: string;
  tags: string[];
  category: string;
  privacyStatus: string;
  language: string;
}

export interface EditorialAnalysisResult {
  summary: string;
  clips: ClipProposal[];
  youtubeMetadata?: YouTubeMetadataResult;
  keywords?: string[];
}

function buildPrompt(request: EditorialAnalysisRequest): string {
  const segmentsList = request.segments
    .map((s) => `[${s.segmentId}] ${s.text}`)
    .join('\n\n');

  return `You are an editorial assistant for a video media company. Your task is to analyze a transcribed video and produce:

1. YouTube metadata (SEO title, long description, tags, category)
2. Social media clip proposals (best moments for Instagram, TikTok, YouTube Shorts)

CONTEXT:
- Content type: ${request.contentType || 'general'}
- Language: ${request.language}
- Target platforms: ${request.targetPlatforms.join(', ')}
- Constraints: clips must be ${request.constraints.minimumClipDurationSeconds}-${request.constraints.maximumClipDurationSeconds} seconds long, maximum ${request.constraints.maximumClipCount} clips${request.editorialGoals ? `\n- Editorial goals: ${request.editorialGoals}` : ''}${request.brandRules ? `\n- Brand rules: ${request.brandRules}` : ''}

RULES:
1. Select segments by their segment ID numbers. Do NOT invent timecodes.
2. Each clip must span 3-10 consecutive segments.
3. Output valid JSON only, no markdown, no explanations.
4. Score each clip from 0.0 to 1.0 based on engagement potential.
5. Provide a catchy title, hook, social description and hashtags for each clip.
6. YouTube metadata should be SEO-optimized and include a compelling title (max 100 chars), a rich description (2-3 paragraphs with keywords and links placeholders), and 10-15 relevant tags.

TRANSCRIPT SEGMENTS:
${segmentsList}

Respond with ONLY a JSON object in this exact format:
{
  "summary": "Brief content summary in French",
  "youtubeMetadata": {
    "title": "SEO-optimized title (max 100 characters) in French",
    "description": "Rich description with keywords, 2-3 paragraphs. Include {link} placeholder for URLs.",
    "tags": ["tag1", "tag2", "tag3"],
    "category": "Entertainment",
    "privacyStatus": "unlisted",
    "language": "fr"
  },
  "clips": [
    {
      "startSegmentId": number,
      "endSegmentId": number,
      "title": "Catchy title in French",
      "hook": "Short hook in French",
      "reason": "Why this clip works",
      "score": 0.85,
      "platforms": ["instagram", "tiktok"],
      "description": "Social media description with emojis",
      "hashtags": ["#tag1", "#tag2"]
    }
  ]
}`;
}

export class OllamaEditorialAiProvider implements EditorialAiProvider {
  private busy = 0;

  async analyzeTranscript(request: EditorialAnalysisRequest): Promise<EditorialAnalysisResult> {
    const env = parseEnv();

    while (this.busy >= env.EDITORIAL_AI_MAX_CONCURRENCY) {
      await new Promise((r) => setTimeout(r, 500));
    }

    this.busy++;
    try {
      const prompt = buildPrompt(request);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);

      try {
        const response = await fetch(`${env.OLLAMA_BASE_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: env.OLLAMA_MODEL,
            prompt,
            stream: false,
            options: {
              temperature: env.OLLAMA_TEMPERATURE,
              num_predict: 4096,
            },
            format: 'json',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Ollama API returned ${response.status}: ${await response.text()}`);
        }

        const body = (await response.json()) as { response?: string; error?: string };
        if (body.error) {
          throw new Error(`Ollama error: ${body.error}`);
        }

        const raw = body.response || '';
        return this.parseAndValidate(raw, request);
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      this.busy--;
    }
  }

  private parseAndValidate(raw: string, request: EditorialAnalysisRequest): EditorialAnalysisResult {
    let parsed: unknown;
    const cleanRaw = raw.trim();

    try {
      parsed = JSON.parse(cleanRaw);
    } catch {
      const extracted = this.extractJson(cleanRaw);
      if (extracted) {
        try {
          parsed = JSON.parse(extracted);
        } catch {
          throw new Error('Failed to parse Ollama response as JSON');
        }
      } else {
        throw new Error('Failed to parse Ollama response as JSON');
      }
    }

    const obj = parsed as Record<string, unknown>;

    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('Ollama response is not a JSON object');
    }

    if (!obj.summary || typeof obj.summary !== 'string') {
      throw new Error('Ollama response missing summary field');
    }

    if (!Array.isArray(obj.clips)) {
      throw new Error('Ollama response missing clips array');
    }

    const clips: ClipProposal[] = [];
    for (const clip of obj.clips) {
      const c = clip as Record<string, unknown>;
      const proposal = this.validateClip(c, request);
      if (proposal) {
        clips.push(proposal);
      }
    }

    if (clips.length === 0) {
      throw new Error('No valid clips found in Ollama response');
    }

    let youtubeMetadata: YouTubeMetadataResult | undefined;
    if (obj.youtubeMetadata && typeof obj.youtubeMetadata === 'object' && !Array.isArray(obj.youtubeMetadata)) {
      const yt = obj.youtubeMetadata as Record<string, unknown>;
      youtubeMetadata = {
        title: String(yt.title || clips[0]?.title || 'Video').slice(0, 100),
        description: String(yt.description || clips[0]?.description || ''),
        tags: Array.isArray(yt.tags) ? (yt.tags as string[]).slice(0, 15) : [],
        category: String(yt.category || 'Entertainment'),
        privacyStatus: String(yt.privacyStatus || 'unlisted'),
        language: String(yt.language || request.language),
      };
    }

    return {
      summary: obj.summary as string,
      clips: clips.slice(0, request.constraints.maximumClipCount),
      youtubeMetadata,
      keywords: Array.isArray(obj.keywords) ? (obj.keywords as string[]) : undefined,
    };
  }

  private validateClip(
    c: Record<string, unknown>,
    request: EditorialAnalysisRequest,
  ): ClipProposal | null {
    const startSegmentId = Number(c.startSegmentId);
    const endSegmentId = Number(c.endSegmentId);
    const score = Number(c.score);
    const title = String(c.title || '');
    const hook = String(c.hook || '');
    const description = String(c.description || '');
    const reason = String(c.reason || '');

    if (isNaN(startSegmentId) || isNaN(endSegmentId) || startSegmentId < 1 || endSegmentId < startSegmentId) {
      return null;
    }

    if (!title || !hook || !description) {
      return null;
    }

    const startSeg = request.segments.find((s) => s.segmentId === startSegmentId);
    const endSeg = request.segments.find((s) => s.segmentId === endSegmentId);
    if (!startSeg || !endSeg) {
      return null;
    }

    const clipDuration = endSeg.end - startSeg.start;
    if (
      clipDuration < request.constraints.minimumClipDurationSeconds ||
      clipDuration > request.constraints.maximumClipDurationSeconds
    ) {
      return null;
    }

    let platforms: string[] = [];
    if (Array.isArray(c.platforms)) {
      platforms = c.platforms.filter((p): p is string => typeof p === 'string');
    }
    if (platforms.length === 0) {
      platforms = [...request.targetPlatforms];
    }

    let hashtags: string[] = [];
    if (Array.isArray(c.hashtags)) {
      hashtags = c.hashtags.filter((h): h is string => typeof h === 'string').map((h) =>
        h.startsWith('#') ? h : `#${h}`,
      );
    }

    return {
      startSegmentId,
      endSegmentId,
      title,
      hook,
      reason,
      score: isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score)),
      platforms,
      description,
      hashtags,
    };
  }

  private extractJson(text: string): string | null {
    const patterns = [
      /```json\s*([\s\S]*?)\s*```/,
      /```\s*([\s\S]*?)\s*```/,
      /(\{[\s\S]*\})/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
    return null;
  }
}
