'use strict';
/*
 * Background worker. Uploads are saved as "pending" and the web request
 * returns at once. Workers pick jobs from the documents table using
 * FOR UPDATE SKIP LOCKED, so you can run several workers (or several
 * servers) without two of them processing the same document.
 *
 * Runs inside the web process by default. For larger installs run it on
 * its own:  RUN_WORKER_IN_WEB=false in the web service + `npm run worker`.
 */
const crypto = require('crypto');
const config = require('./config');
const { pool } = require('./db');
const storage = require('./storage');
const { extractText } = require('./extract');
const { checkText } = require('./similarity');

let stopping = false;

async function claimJob() {
  const { rows } = await pool.query(`
    UPDATE documents SET status = 'processing', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM documents WHERE status = 'pending'
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id, input_type, storage_key, attempts`);
  return rows[0] || null;
}

async function processJob(job) {
  const buffer = await storage.read(job.storage_key);
  const text = await extractText(buffer, job.input_type);
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length < config.minWords) {
    throw new Error(`The document has only ${words.length} words. At least ${config.minWords} are needed.`);
  }
  const result = await checkText(pool, text, { maxWords: config.maxWordsChecked });
  const sha = crypto.createHash('sha256').update(text).digest('hex');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM matches WHERE document_id = $1', [job.id]);
    if (result.passages.length) {
      await client.query(
        `INSERT INTO matches (document_id, source_id, char_start, char_end, word_count, source_excerpt)
         SELECT $1, * FROM unnest($2::int[], $3::int[], $4::int[], $5::int[], $6::text[])`,
        [job.id,
          result.passages.map(p => p.sourceId), result.passages.map(p => p.charStart),
          result.passages.map(p => p.charEnd), result.passages.map(p => p.wordCount),
          result.passages.map(p => p.excerpt)],
      );
    }
    await client.query(
      `UPDATE documents SET status = 'completed', extracted_text = $2, text_sha256 = $3,
         word_count = $4, matched_words = $5, similarity = $6, completed_at = now(),
         error_message = $7
       WHERE id = $1`,
      [job.id, text, sha, result.totalWords, result.matchedWords, result.similarity,
        result.truncated ? `Only the first ${config.maxWordsChecked} words were checked.` : null],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function failOrRetry(job, err) {
  const userError = err && err.message ? err.message.slice(0, 500) : 'Unknown error';
  const permanent = /No text found|Unsupported|only \d+ words|Invalid/.test(userError);
  const finalFail = permanent || job.attempts >= config.maxAttempts;
  await pool.query(
    `UPDATE documents SET status = $2::varchar, error_message = $3,
       completed_at = CASE WHEN $2::varchar = 'failed' THEN now() END
     WHERE id = $1`,
    [job.id, finalFail ? 'failed' : 'pending', userError],
  );
  console.warn(`[worker] ${job.id} ${finalFail ? 'failed' : 'will retry'}: ${userError}`);
}

// If a worker crashed mid-job, put stuck jobs back in the queue.
async function recoverStale() {
  await pool.query(`
    UPDATE documents
    SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'pending' END,
        error_message = CASE WHEN attempts >= $1 THEN 'Processing timed out.' ELSE error_message END
    WHERE status = 'processing' AND started_at < now() - interval '10 minutes'`, [config.maxAttempts]);
}

async function loop(id) {
  while (!stopping) {
    let job = null;
    try {
      job = await claimJob();
      if (!job) { await new Promise(r => setTimeout(r, config.workerPollMs)); continue; }
      await processJob(job);
    } catch (err) {
      if (job) await failOrRetry(job, err).catch(e => console.error('[worker]', e.message));
      else { console.error(`[worker ${id}]`, err.message); await new Promise(r => setTimeout(r, 3000)); }
    }
  }
}

function start() {
  recoverStale().catch(e => console.error('[worker] recover', e.message));
  setInterval(() => recoverStale().catch(() => {}), 60000).unref();
  for (let i = 0; i < config.workerConcurrency; i++) loop(i + 1);
  console.log(`[worker] started ${config.workerConcurrency} worker loop(s)`);
}

function stop() { stopping = true; }

if (require.main === module) {
  start();
  process.on('SIGTERM', () => { stop(); setTimeout(() => process.exit(0), 2000); });
}

module.exports = { start, stop, processJob };
