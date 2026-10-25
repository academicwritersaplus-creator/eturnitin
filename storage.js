'use strict';
// File storage for uploaded originals.
// - "local": files are written to STORAGE_DIR, outside the public web folder,
//   under random names. They are never served directly; only the owner's
//   extracted text is shown through authenticated API routes.
// - "s3": any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO).
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

function safeKey(key) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
  return key;
}

const local = {
  root: path.resolve(config.storageDir),
  async save(key, buffer) {
    const file = path.join(this.root, safeKey(key));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer, { mode: 0o600 });
  },
  async read(key) {
    return fs.readFile(path.join(this.root, safeKey(key)));
  },
  async remove(key) {
    await fs.rm(path.join(this.root, safeKey(key)), { force: true });
  },
};

let s3Client = null;
async function s3() {
  if (s3Client) return s3Client;
  let sdk;
  try { sdk = require('@aws-sdk/client-s3'); } catch {
    throw new Error('STORAGE_DRIVER=s3 needs the package @aws-sdk/client-s3 (npm install @aws-sdk/client-s3)');
  }
  const client = new sdk.S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    forcePathStyle: Boolean(config.s3.endpoint),
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  });
  s3Client = { sdk, client };
  return s3Client;
}

const remote = {
  async save(key, buffer) {
    const { sdk, client } = await s3();
    await client.send(new sdk.PutObjectCommand({
      Bucket: config.s3.bucket, Key: safeKey(key), Body: buffer, ServerSideEncryption: config.s3.endpoint ? undefined : 'AES256',
    }));
  },
  async read(key) {
    const { sdk, client } = await s3();
    const out = await client.send(new sdk.GetObjectCommand({ Bucket: config.s3.bucket, Key: safeKey(key) }));
    return Buffer.from(await out.Body.transformToByteArray());
  },
  async remove(key) {
    const { sdk, client } = await s3();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: config.s3.bucket, Key: safeKey(key) }));
  },
};

module.exports = config.storageDriver === 's3' ? remote : local;
