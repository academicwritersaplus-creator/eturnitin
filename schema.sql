-- TimCheck database schema (PostgreSQL 13+)
-- Safe to run more than once: every statement is idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fast ILIKE search on titles

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(254) NOT NULL,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- --------------------------------------------- comparison collection
-- The "sample sources" every submission is compared against.
CREATE TABLE IF NOT EXISTS sources (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(300) NOT NULL,
  author      VARCHAR(200),
  origin      VARCHAR(300),            -- free text: where the sample came from
  body        TEXT         NOT NULL,
  word_count  INTEGER      NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sources_title_idx ON sources (title);

-- Inverted index: one row per 5-word "shingle" in every source.
-- Looking up all shingles of a submission is a single indexed query,
-- so the collection can grow to many thousands of sources.
CREATE TABLE IF NOT EXISTS source_shingles (
  hash      BIGINT  NOT NULL,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  pos       INTEGER NOT NULL           -- word position of the shingle in the source
);
CREATE INDEX IF NOT EXISTS source_shingles_hash_idx ON source_shingles (hash);
CREATE INDEX IF NOT EXISTS source_shingles_source_idx ON source_shingles (source_id);

-- ------------------------------------------------------------ documents
CREATE TABLE IF NOT EXISTS documents (
  id                UUID PRIMARY KEY,
  user_id           INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             VARCHAR(200) NOT NULL,
  input_type        VARCHAR(10)  NOT NULL CHECK (input_type IN ('pdf', 'docx', 'text')),
  original_filename VARCHAR(255),
  size_bytes        INTEGER      NOT NULL DEFAULT 0,
  storage_key       VARCHAR(300) NOT NULL,          -- where the original file lives
  status            VARCHAR(12)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message     TEXT,
  attempts          INTEGER      NOT NULL DEFAULT 0,
  extracted_text    TEXT,
  text_sha256       CHAR(64),
  word_count        INTEGER,
  similarity        NUMERIC(5,1),
  matched_words     INTEGER,
  report_ref        VARCHAR(40)  NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS documents_user_created_idx ON documents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_status_created_idx ON documents (status, created_at);
CREATE INDEX IF NOT EXISTS documents_created_idx ON documents (created_at DESC);
CREATE INDEX IF NOT EXISTS documents_title_trgm_idx ON documents USING gin (title gin_trgm_ops);

-- One row per highlighted passage in a report.
CREATE TABLE IF NOT EXISTS matches (
  id            SERIAL PRIMARY KEY,
  document_id   UUID    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  char_start    INTEGER NOT NULL,      -- character offsets in documents.extracted_text
  char_end      INTEGER NOT NULL,
  word_count    INTEGER NOT NULL,
  source_excerpt TEXT   NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_document_idx ON matches (document_id);

-- Small key/value settings (for example the generated session secret).
CREATE TABLE IF NOT EXISTS app_settings (
  key   VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL
);

-- Login sessions (used by connect-pg-simple).
CREATE TABLE IF NOT EXISTS user_sessions (
  sid    VARCHAR      NOT NULL PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);
