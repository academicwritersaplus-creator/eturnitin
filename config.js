'use strict';
require('dotenv').config({ quiet: true });

function int(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

// Render sets RENDER=true and RENDER_EXTERNAL_URL automatically.
const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const databaseUrl = process.env.DATABASE_URL || 'postgres://timcheck:timcheck@localhost:5432/timcheck';

// SSL: use DATABASE_SSL if set. Otherwise turn SSL on for hosted databases
// (host names with a dot, like *.render.com or *.neon.tech) and off for local
// or private-network hosts (localhost, Render's internal "dpg-..." names).
function wantSsl() {
  if (process.env.DATABASE_SSL === 'true') return true;
  if (process.env.DATABASE_SSL === 'false') return false;
  try {
    const host = new URL(databaseUrl).hostname;
    return host.includes('.') && !/^(localhost|127\.0\.0\.1)$/.test(host);
  } catch { return false; }
}

const config = {
  isProd,
  port: int('PORT', 3000),
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl,
  databaseSsl: wantSsl(),
  sessionSecret: process.env.SESSION_SECRET || '',
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),

  // File storage
  storageDriver: process.env.STORAGE_DRIVER || 'local',        // 'local' or 's3'
  storageDir: process.env.STORAGE_DIR || './storage',
  s3: {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,             // set for Cloudflare R2, Backblaze, MinIO
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },

  // Limits
  maxUploadMb: int('MAX_UPLOAD_MB', 10),
  uploadsPerHour: int('UPLOADS_PER_HOUR', 120),
  maxPasteChars: int('MAX_PASTE_CHARS', 200000),
  maxWordsChecked: int('MAX_WORDS_CHECKED', 60000),
  minWords: 20,

  // Background worker
  runWorkerInWeb: process.env.RUN_WORKER_IN_WEB !== 'false',
  workerConcurrency: int('WORKER_CONCURRENCY', 2),
  workerPollMs: int('WORKER_POLL_MS', 1500),
  maxAttempts: 3,
};

// If SESSION_SECRET is empty, server.js creates one and stores it in the database.

module.exports = config;
