-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Repos ────────────────────────────────────────────────────────────────────
CREATE TABLE repos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  github_url  TEXT        NOT NULL UNIQUE,   -- one row per GitHub URL (idempotent register)
  owner       TEXT        NOT NULL,
  repo_name   TEXT        NOT NULL,
  clone_path  TEXT,
  webhook_id  TEXT,
  status      TEXT        DEFAULT 'pending',  -- pending | indexing | ready | error
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Jobs ─────────────────────────────────────────────────────────────────────
CREATE TABLE jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id       UUID        REFERENCES repos(id),
  issue_number  INTEGER     NOT NULL,
  issue_title   TEXT,
  issue_body    TEXT,
  status        TEXT        DEFAULT 'queued',  -- queued | running | done | failed
  pr_url        TEXT,
  agent_logs    JSONB       DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Embeddings ───────────────────────────────────────────────────────────────
CREATE TABLE embeddings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id      UUID        REFERENCES repos(id),
  file_path    TEXT        NOT NULL,
  chunk_index  INTEGER,
  chunk_text   TEXT        NOT NULL,
  embedding    vector(1536),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Cosine similarity index for RAG retrieval (Phase 3).
-- HNSW, not ivfflat: ivfflat computes cluster centroids at build time, so an
-- index created on an empty table (which is what happens here on first boot)
-- has no meaningful centroids and recalls poorly. HNSW builds incrementally.
CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops);

-- Every retrieval filters by repo_id before ranking.
CREATE INDEX ON embeddings (repo_id);
