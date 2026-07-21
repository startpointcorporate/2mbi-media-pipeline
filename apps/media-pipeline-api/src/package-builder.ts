import { getObject, putObject } from './minio.js';
import { query } from './db.js';
import { PassThrough } from 'node:stream';
import crypto from 'node:crypto';

const archiver = () => {
  try {
    return require('archiver');
  } catch {
    throw new Error('archiver package is not installed');
  }
};

async function collectAssets(mediaId: string): Promise<Array<{ key: string; filename: string }>> {
  const assets: Array<{ key: string; filename: string }> = [];

  const clipAssets = await query(
    `SELECT ca.key, ca.format, c.title, c.id as clip_id
     FROM media_pipeline.clip_assets ca
     JOIN media_pipeline.clips c ON c.id = ca.clip_id
     WHERE ca.media_id = $1 AND c.status = 'generated'
     ORDER BY ca.format`,
    [mediaId],
  );
  for (const row of clipAssets.rows) {
    const ext = row.key?.split('.').pop() || 'mp4';
    assets.push({
      key: row.key as string,
      filename: `clips/${row.format}/${row.title?.replace(/[^a-zA-Z0-9_-]/g, '_') || row.clip_id}.${ext}`,
    });
  }

  const transcript = await query(
    `SELECT json_key, srt_key, vtt_key FROM media_pipeline.transcriptions
     WHERE media_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [mediaId],
  );
  if (transcript.rowCount && transcript.rowCount > 0) {
    const t = transcript.rows[0];
    if (t.json_key) assets.push({ key: t.json_key as string, filename: 'transcript/transcript.json' });
    if (t.srt_key) assets.push({ key: t.srt_key as string, filename: 'transcript/transcript.srt' });
    if (t.vtt_key) assets.push({ key: t.vtt_key as string, filename: 'transcript/transcript.vtt' });
  }

  const proposals = await query(
    `SELECT id, title, hook, description, hashtags, platforms, score
     FROM media_pipeline.clip_proposals
     WHERE media_id = $1 AND status = 'accepted'
     ORDER BY score DESC`,
    [mediaId],
  );

  if (proposals.rowCount && proposals.rowCount > 0) {
    const posts: unknown[] = proposals.rows.map((r) => ({
      title: r.title,
      hook: r.hook,
      description: r.description,
      hashtags: typeof r.hashtags === 'string' ? JSON.parse(r.hashtags as string) : r.hashtags,
      platforms: typeof r.platforms === 'string' ? JSON.parse(r.platforms as string) : r.platforms,
      score: r.score,
    }));

    let youtubeMetadata = {
      title: (posts[0] as Record<string, string>)?.title || 'Video',
      description: (posts[0] as Record<string, string>)?.description || '',
      tags: (posts[0] as Record<string, string[]>)?.hashtags?.map((h: string) => h.replace('#', '')) || [],
      category: 'Entertainment',
      privacyStatus: 'unlisted',
      language: 'fr',
    };

    const planResult = await query(
      `SELECT raw_result_key FROM media_pipeline.editorial_plans
       WHERE media_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [mediaId],
    );

    if (planResult.rowCount && planResult.rowCount > 0 && planResult.rows[0].raw_result_key) {
      try {
        const { body } = await getObject(planResult.rows[0].raw_result_key as string);
        const planJson = JSON.parse(body.toString('utf-8'));
        if (planJson.youtubeMetadata) {
          youtubeMetadata = {
            ...youtubeMetadata,
            ...planJson.youtubeMetadata,
          };
        }
      } catch {
        // Fallback to post-based metadata if plan JSON is unavailable
      }
    }

    const manifest = {
      mediaId,
      generatedAt: new Date().toISOString(),
      postProposals: posts,
      youtubeMetadata,
    };

    const manifestKey = `packages/${mediaId}/manifest.json`;
    await putObject(manifestKey, Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
    assets.push({ key: manifestKey, filename: 'manifest.json' });
  }

  return assets;
}

export async function generatePackage(mediaId: string): Promise<{
  packageKey: string;
  fileSize: number;
  checksum: string;
  assetCount: number;
}> {
  const Archiver = archiver();
  const assets = await collectAssets(mediaId);

  const passThrough = new PassThrough();
  const archive = Archiver('zip', { zlib: { level: 9 } });
  archive.pipe(passThrough);

  for (const asset of assets) {
    try {
      const { body } = await getObject(asset.key);
      archive.append(body, { name: asset.filename });
    } catch (err) {
      console.warn(`Failed to add ${asset.key} to package:`, err);
    }
  }

  archive.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of passThrough) {
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);

  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const packageKey = `packages/${mediaId}/package-${Date.now()}.zip`;

  await putObject(packageKey, buffer, 'application/zip');

  return {
    packageKey,
    fileSize: buffer.length,
    checksum,
    assetCount: assets.length,
  };
}
