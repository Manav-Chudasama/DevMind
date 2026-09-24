// ─── Repo ─────────────────────────────────────────────────────────────────────

export type RepoStatus = "pending" | "indexing" | "ready" | "error";

export interface Repo {
  id: string;
  github_url: string;
  owner: string;
  repo_name: string;
  clone_path?: string;
  webhook_id?: string;
  status: RepoStatus;
  created_at: string;
}

// ─── Job ──────────────────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  repo_id: string;
  issue_number: number;
  issue_title?: string;
  issue_body?: string;
  status: JobStatus;
  pr_url?: string;
  agent_logs: AgentLog[];
  created_at: string;
}

// ─── Agent Logs ───────────────────────────────────────────────────────────────

export interface AgentLog {
  agent: "orchestrator" | "rag" | "planner" | "coder" | "reviewer" | "system";
  message: string;
  timestamp: string;
}

// ─── LangGraph State (Phase 4) ────────────────────────────────────────────────

export interface CodeChunk {
  file_path: string;
  chunk_text: string;
  similarity: number;
}

export interface FileDiff {
  file_path: string;
  original: string;
  patched: string;
  diff: string;
}

export interface GraphState {
  repoId: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  pastMemory: string;
  retrievedContext: CodeChunk[];
  plan: string;
  targetFiles: string[];
  codeDiffs: FileDiff[];
  reviewScore: number;
  reviewFeedback: string;
  iterationCount: number;
  prUrl: string;
  agentLogs: AgentLog[];
}
