import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand, CreateBucketCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseEnv } from './env.js';

const env = parseEnv();

const s3Client = new S3Client({
  endpoint: `http${env.MINIO_USE_SSL ? 's' : ''}://${env.MINIO_ENDPOINT}`,
  region: 'us-east-1',
  credentials: {
    accessKeyId: env.MINIO_ACCESS_KEY,
    secretAccessKey: env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

function ensureBucket(): Promise<void> {
  return (async () => {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: env.MINIO_BUCKET }));
    } catch (err: unknown) {
      const e = err as { name?: string; '$metadata'?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.name === 'NoSuchBucket' || e['$metadata']?.httpStatusCode === 404) {
        await s3Client.send(new CreateBucketCommand({ Bucket: env.MINIO_BUCKET }));
        console.log(`Created bucket: ${env.MINIO_BUCKET}`);
      } else {
        console.error(`Failed to check/create bucket ${env.MINIO_BUCKET}:`, err);
      }
    }
  })();
}

async function headObject(key: string): Promise<{ contentLength?: number; contentType?: string; etag?: string }> {
  const bucket = env.MINIO_BUCKET;
  const res = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return {
    contentLength: res.ContentLength,
    contentType: res.ContentType,
    etag: res.ETag,
  };
}

async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const bucket = env.MINIO_BUCKET;
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

async function getObject(key: string): Promise<{ body: Buffer; contentType?: string }> {
  const bucket = env.MINIO_BUCKET;
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const contentType = res.ContentType;
  const chunks: Buffer[] = [];
  const body = res.Body;
  if (body) {
    if (typeof (body as { pipe: unknown }).pipe === 'function') {
      for await (const chunk of body as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
    } else if (body instanceof ReadableStream) {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
    } else if (typeof (body as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
      const ab = await (body as Blob).arrayBuffer();
      return { body: Buffer.from(ab), contentType };
    } else {
      const text = await (body as { transformToString: () => Promise<string> }).transformToString();
      return { body: Buffer.from(text, 'utf-8'), contentType };
    }
  }
  return { body: Buffer.concat(chunks), contentType };
}

async function presignedGetUrl(
  key: string,
  expiresInSeconds = 900,
): Promise<string> {
  const bucket = env.MINIO_BUCKET;
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

async function deleteObject(key: string): Promise<void> {
  const bucket = env.MINIO_BUCKET;
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export { s3Client, ensureBucket, headObject, putObject, getObject, presignedGetUrl, deleteObject };
