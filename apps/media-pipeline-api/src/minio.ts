import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseEnv } from './env.js';

const env = parseEnv();

const s3Client = new S3Client({
  endpoint: `http${env.MINIO_USE_SSL ? 's' : ''}://${env.MINIO_ENDPOINT}`,
  region: env.MINIO_REGION,
  credentials: {
    accessKeyId: env.MINIO_ACCESS_KEY,
    secretAccessKey: env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

const REQUIRED_BUCKETS = ['media-source', 'media-generated', 'media-temp', 'media-transcripts'];

async function ensureBuckets(): Promise<void> {
  for (const bucket of REQUIRED_BUCKETS) {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
        console.log(`Created bucket: ${bucket}`);
      } else {
        console.error(`Failed to check/create bucket ${bucket}:`, err);
      }
    }
  }
}

async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

async function presignedGetUrl(
  bucket: string,
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return getSignedUrl(
    s3Client,
    new PutObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

export { s3Client, ensureBuckets, putObject, presignedGetUrl };
