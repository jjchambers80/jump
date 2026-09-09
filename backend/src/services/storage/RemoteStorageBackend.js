import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { StorageBackend } from './StorageBackend.js';

/**
 * S3-compatible remote storage backend.
 * Works with any S3-compatible provider: Railway Buckets, AWS S3, Cloudflare R2, MinIO.
 * Configured via BUCKET_* env vars.
 */
export class RemoteStorageBackend extends StorageBackend {
  constructor() {
    super();
    const config = {
      region: process.env.BUCKET_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.BUCKET_ACCESS_KEY_ID,
        secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY,
      },
    };
    if (process.env.BUCKET_ENDPOINT) {
      config.endpoint = process.env.BUCKET_ENDPOINT;
      config.forcePathStyle = true;
    }
    this.client = new S3Client(config);
    this.bucket = process.env.BUCKET_NAME;
    this.publicUrlPrefix = process.env.BUCKET_PUBLIC_URL;
  }

  async put(key, buffer, contentType) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  }

  async get(key) {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      return {
        buffer: Buffer.concat(chunks),
        contentType: response.ContentType,
      };
    } catch (error) {
      if (error.name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async delete(key) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async exists(key) {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  getPublicUrl(key) {
    if (this.publicUrlPrefix) {
      return `${this.publicUrlPrefix}/${key}`;
    }
    if (process.env.BUCKET_ENDPOINT) {
      return `${process.env.BUCKET_ENDPOINT}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.${process.env.BUCKET_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  }
}
