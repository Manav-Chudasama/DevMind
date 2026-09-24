// ─── Queue names ──────────────────────────────────────────────────────────────
// Single source of truth for BullMQ queue names. Both the API (publisher) and
// the worker (consumer, Phase 3+) must import from here so they can never drift.

// NOTE: BullMQ (v5+) forbids ':' in queue names because it uses ':' internally
// as its Redis key delimiter (bull:{queueName}:{jobId}). Use hyphens.
export const QUEUE_INDEX_REPO = "devmind-index-repo" as const;
export const QUEUE_FIX_ISSUE = "devmind-fix-issue" as const;

export type QueueName = typeof QUEUE_INDEX_REPO | typeof QUEUE_FIX_ISSUE;

// ─── Job payloads ─────────────────────────────────────────────────────────────
// Kept intentionally small — everything else lives in Postgres, keyed by ids
// below. This keeps Redis memory low and makes replays trivial.

export interface IndexRepoJob {
  repoId: string;      // repos.id (UUID)
  githubUrl: string;   // full https URL, kept for logging convenience
  clonePath: string;   // absolute path on disk where the repo was cloned
}

export interface FixIssueJob {
  jobId: string;       // jobs.id (UUID) — worker updates this row as it runs
  repoId: string;      // repos.id (UUID) — for RAG scoping
  owner: string;       // GitHub owner (org or user)
  repoName: string;    // GitHub repo name
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
}
