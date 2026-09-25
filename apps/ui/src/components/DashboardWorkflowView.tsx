"use client";

import type { Job, Repo, AgentLog } from "@devmind/shared";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* ──────────────────────────────────────────────
   Constants & Config
   ────────────────────────────────────────────── */

const ISSUE_PIPELINE_STEPS = [
  { id: "orchestrator", label: "Orchestrator", icon: "⚡" },
  { id: "rag",          label: "RAG",          icon: "🔍" },
  { id: "planner",      label: "Planner",      icon: "📋" },
  { id: "coder",        label: "Coder",        icon: "💻" },
  { id: "reviewer",     label: "Reviewer",     icon: "🔬" },
];

const INDEX_PIPELINE_STEPS = [
  { id: "clone",      label: "Git Clone",    icon: "📥" },
  { id: "walk",       label: "File Walker",  icon: "📂" },
  { id: "chunk",      label: "Chunker",      icon: "✂️" },
  { id: "embed",      label: "Embedder",     icon: "🧠" },
  { id: "pgvector",   label: "pgvector",     icon: "💾" },
];

const AGENT_COLORS: Record<string, string> = {
  orchestrator: "var(--agent-orchestrator)",
  rag:          "var(--agent-rag)",
  planner:      "var(--agent-planner)",
  coder:        "var(--agent-coder)",
  reviewer:     "var(--agent-reviewer)",
  system:       "var(--agent-system)",
};

interface QueueCounts {
  active: number;
  waiting: number;
  completed: number;
  failed: number;
}

interface QueueStats {
  indexRepo: QueueCounts;
  fixIssue: QueueCounts;
}

const EMPTY_COUNTS: QueueCounts = { active: 0, waiting: 0, completed: 0, failed: 0 };

/* ──────────────────────────────────────────────
   Sub-components
   ────────────────────────────────────────────── */

function IssuePipelineStepper({ logs, status }: { logs: AgentLog[]; status: string }) {
  const seenAgents = new Set(logs.map((l) => l.agent));
  const lastAgent = logs.length > 0 ? logs[logs.length - 1].agent : null;
  const isDone = status === "done" || status === "declined" || status === "failed";

  return (
    <div className="pipeline-stepper" style={{ padding: "12px 0 6px" }}>
      {ISSUE_PIPELINE_STEPS.map((step, i) => {
        const done = isDone ? seenAgents.has(step.id) : seenAgents.has(step.id) && lastAgent !== step.id;
        const active = !isDone && lastAgent === step.id;
        const state = done ? "done" : active ? "active" : "idle";

        return (
          <div key={step.id} className="pipeline-step">
            <div className={`pipeline-node pipeline-node--${state}`}>
              <div className={`pipeline-node-circle pipeline-node-circle--${state}`}>
                {done ? "✓" : step.icon}
              </div>
              <div className="pipeline-node-label">{step.label}</div>
            </div>
            {i < ISSUE_PIPELINE_STEPS.length - 1 && (
              <div className={`pipeline-connector ${done ? "pipeline-connector--done" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function IndexPipelineStepper({ status }: { status: Repo["status"] }) {
  const isReady = status === "ready";
  const isIndexing = status === "indexing";

  return (
    <div className="pipeline-stepper" style={{ padding: "12px 0 6px" }}>
      {INDEX_PIPELINE_STEPS.map((step, i) => {
        const done = isReady;
        const active = isIndexing && i === 3; // embed step in progress
        const state = done ? "done" : active ? "active" : "idle";

        return (
          <div key={step.id} className="pipeline-step">
            <div className={`pipeline-node pipeline-node--${state}`}>
              <div className={`pipeline-node-circle pipeline-node-circle--${state}`}>
                {done ? "✓" : step.icon}
              </div>
              <div className="pipeline-node-label">{step.label}</div>
            </div>
            {i < INDEX_PIPELINE_STEPS.length - 1 && (
              <div className={`pipeline-connector ${done ? "pipeline-connector--done" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReviewerSection({ logs }: { logs: AgentLog[] }) {
  const reviewerLogs = logs.filter((l) => l.agent === "reviewer");
  if (reviewerLogs.length === 0) return null;

  const lastLog = reviewerLogs[reviewerLogs.length - 1];
  const scoreMatch = reviewerLogs
    .map((l) => l.message.match(/score[:\s]+(\d+)\s*\/\s*10/i))
    .filter(Boolean)
    .pop();
  const score = scoreMatch ? +scoreMatch[1] : null;
  const pass = score != null && score >= 7;

  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "12px 16px",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Reviewer Decision
        </span>
        {score != null && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: 14,
              color: pass ? "var(--status-up)" : "var(--agent-reviewer)",
            }}
          >
            {score}/10 {pass ? "✓ PASS" : "✕ FAIL"}
          </span>
        )}
      </div>
      {score != null && (
        <div className="score-meter" style={{ marginBottom: 8 }}>
          <div className="score-bar">
            <div
              className={`score-fill score-fill--${pass ? "pass" : "fail"}`}
              style={{ width: `${score * 10}%` }}
            />
          </div>
        </div>
      )}
      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
        {lastLog.message}
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Main Master-Detail View
   ────────────────────────────────────────────── */

interface Props {
  initialJobs: Job[];
  repos: Repo[];
}

type TabType = "all" | "issues" | "indexing";

export function DashboardWorkflowView({ initialJobs, repos: initialRepos }: Props) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [repos, setRepos] = useState<Repo[]>(initialRepos);
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [reindexingId, setReindexingId] = useState<string | null>(null);

  const repoMap = new Map(repos.map((r) => [r.id, r]));

  // Selected item: either an issue job or an indexing repo
  type SelectedTarget =
    | { type: "issue"; id: string }
    | { type: "index"; id: string };

  const firstRunningJob = jobs.find((j) => j.status === "running");
  const firstIndexingRepo = repos.find((r) => r.status === "indexing");

  const [selected, setSelected] = useState<SelectedTarget | null>(() => {
    if (firstRunningJob) return { type: "issue", id: firstRunningJob.id };
    if (firstIndexingRepo) return { type: "index", id: firstIndexingRepo.id };
    if (jobs.length > 0) return { type: "issue", id: jobs[0].id };
    if (repos.length > 0) return { type: "index", id: repos[0].id };
    return null;
  });

  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);

  // Active selected entities
  const selectedJob =
    selected?.type === "issue" ? jobs.find((j) => j.id === selected.id) ?? null : null;
  const selectedRepo =
    selected?.type === "index" ? repos.find((r) => r.id === selected.id) ?? null : null;

  // Selected job live logs & streaming
  const [liveLogs, setLiveLogs] = useState<AgentLog[]>(selectedJob?.agent_logs ?? []);
  const [isStreaming, setIsStreaming] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Poll BullMQ queue stats
  useEffect(() => {
    async function fetchQueues() {
      try {
        const res = await fetch("/api/queues");
        if (res.ok) setQueueStats(await res.json());
      } catch {}
    }
    fetchQueues();
    const interval = setInterval(fetchQueues, 3000);
    return () => clearInterval(interval);
  }, []);

  // Update live logs when selected job changes
  useEffect(() => {
    if (!selectedJob) {
      setLiveLogs([]);
      return;
    }
    setLiveLogs(selectedJob.agent_logs ?? []);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const isTerminal =
      selectedJob.status === "done" ||
      selectedJob.status === "declined" ||
      selectedJob.status === "failed";

    if (isTerminal) {
      setIsStreaming(false);
      return;
    }

    const es = new EventSource(`/api/jobs/${selectedJob.id}/stream`);
    esRef.current = es;

    es.addEventListener("log", (e) => {
      try {
        const entry: AgentLog = JSON.parse(e.data);
        setLiveLogs((prev) => {
          const key = `${entry.timestamp}:${entry.agent}:${entry.message}`;
          if (prev.some((l) => `${l.timestamp}:${l.agent}:${l.message}` === key)) return prev;
          return [...prev, entry];
        });
      } catch {}
    });

    es.addEventListener("status", (e) => {
      try {
        const update = JSON.parse(e.data) as Partial<Job>;
        setJobs((prev) =>
          prev.map((j) => (j.id === selectedJob.id ? { ...j, ...update } : j))
        );
        if (
          update.status === "done" ||
          update.status === "declined" ||
          update.status === "failed"
        ) {
          setIsStreaming(false);
          es.close();
        }
      } catch {}
    });

    es.onopen = () => setIsStreaming(true);
    es.onerror = () => {
      setIsStreaming(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [selectedJob?.id, selectedJob?.status]);

  const terminalBottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    terminalBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveLogs]);

  async function handleReindex(repoId: string) {
    setReindexingId(repoId);
    try {
      await fetch(`/api/repos/${repoId}/reindex`, { method: "POST" });
      setRepos((prev) =>
        prev.map((r) => (r.id === repoId ? { ...r, status: "indexing" } : r))
      );
    } catch {} finally {
      setTimeout(() => setReindexingId(null), 1500);
    }
  }

  const fixStats = queueStats?.fixIssue ?? EMPTY_COUNTS;
  const indexStats = queueStats?.indexRepo ?? EMPTY_COUNTS;

  // Build unified item list
  interface UnifiedItem {
    id: string;
    type: "issue" | "index";
    title: string;
    subtitle: string;
    status: string;
    timestamp: string;
    rawJob?: Job;
    rawRepo?: Repo;
  }

  const unifiedList: UnifiedItem[] = [
    ...jobs.map((j) => {
      const r = repoMap.get(j.repo_id);
      return {
        id: j.id,
        type: "issue" as const,
        title: `#${j.issue_number} ${j.issue_title ?? "Untitled"}`,
        subtitle: r ? `${r.owner}/${r.repo_name}` : j.repo_id.slice(0, 8),
        status: j.status,
        timestamp: j.created_at,
        rawJob: j,
      };
    }),
    ...repos.map((r) => ({
      id: r.id,
      type: "index" as const,
      title: `Index: ${r.owner}/${r.repo_name}`,
      subtitle: r.clone_path ? `📁 ${r.clone_path}` : "RAG Embeddings",
      status: r.status,
      timestamp: r.created_at,
      rawRepo: r,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const filteredItems = unifiedList.filter((item) => {
    if (activeTab === "issues") return item.type === "issue";
    if (activeTab === "indexing") return item.type === "index";
    return true;
  });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "390px 1fr",
        gap: 18,
        marginBottom: 24,
      }}
    >
      {/* ─── LEFT CARD: BullMQ Queues (Issue + Index) ────────────────────── */}
      <div className="card" style={{ display: "flex", flexDirection: "column" }}>
        {/* Top Header with live counters for both queues */}
        <div className="card-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <span className="card-title" style={{ margin: 0 }}>BullMQ Queues</span>
            </div>
            <span className="live-indicator">
              <span className="live-dot" />
              Live
            </span>
          </div>

          {/* Dual Queue Counter Badges */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {/* Fix Issue Queue */}
            <div
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "7px 9px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                <span>⚡ fix-issue</span>
                <span style={{ color: fixStats.active > 0 ? "var(--status-indexing)" : "var(--text-muted)" }}>
                  {fixStats.active} act
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                <span>wait: {fixStats.waiting}</span>
                <span>done: {fixStats.completed}</span>
              </div>
            </div>

            {/* Index Repo Queue */}
            <div
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "7px 9px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                <span>📦 index-repo</span>
                <span style={{ color: indexStats.active > 0 ? "var(--status-indexing)" : "var(--text-muted)" }}>
                  {indexStats.active} act
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                <span>wait: {indexStats.waiting}</span>
                <span>done: {indexStats.completed}</span>
              </div>
            </div>
          </div>

          {/* Simple Queue Switcher Tabs */}
          <div style={{ display: "flex", gap: 4, background: "var(--bg-base)", padding: 3, borderRadius: "var(--radius-sm)" }}>
            <button
              onClick={() => setActiveTab("all")}
              style={{
                flex: 1,
                padding: "4px 8px",
                border: "none",
                borderRadius: 4,
                fontSize: 11.5,
                fontWeight: 500,
                cursor: "pointer",
                background: activeTab === "all" ? "var(--bg-elevated)" : "transparent",
                color: activeTab === "all" ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              All ({unifiedList.length})
            </button>
            <button
              onClick={() => setActiveTab("issues")}
              style={{
                flex: 1,
                padding: "4px 8px",
                border: "none",
                borderRadius: 4,
                fontSize: 11.5,
                fontWeight: 500,
                cursor: "pointer",
                background: activeTab === "issues" ? "var(--bg-elevated)" : "transparent",
                color: activeTab === "issues" ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              ⚡ Issues ({jobs.length})
            </button>
            <button
              onClick={() => setActiveTab("indexing")}
              style={{
                flex: 1,
                padding: "4px 8px",
                border: "none",
                borderRadius: 4,
                fontSize: 11.5,
                fontWeight: 500,
                cursor: "pointer",
                background: activeTab === "indexing" ? "var(--bg-elevated)" : "transparent",
                color: activeTab === "indexing" ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              📦 Index ({repos.length})
            </button>
          </div>
        </div>

        {/* Scrollable Unified Queue List */}
        <div style={{ flex: 1, maxHeight: 560, overflowY: "auto", padding: 10 }}>
          {filteredItems.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px 16px" }}>
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-title" style={{ fontSize: 13.5 }}>No queue items</div>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isSelected = selected?.id === item.id && selected?.type === item.type;
              const isIssue = item.type === "issue";

              return (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => setSelected({ type: item.type, id: item.id })}
                  style={{
                    background: isSelected ? "var(--bg-hover)" : "var(--bg-elevated)",
                    border: isSelected ? "1px solid var(--agent-orchestrator)" : "1px solid var(--border)",
                    boxShadow: isSelected ? "0 0 12px rgba(167, 139, 250, 0.15)" : "none",
                    borderRadius: "var(--radius-md)",
                    padding: "10px 12px",
                    marginBottom: 7,
                    cursor: "pointer",
                    transition: "all var(--transition)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 3 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{isIssue ? "⚡" : "📦"}</span>
                      <span
                        style={{
                          fontWeight: isSelected ? 600 : 500,
                          fontSize: 12.5,
                          color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.title}
                      </span>
                    </div>
                    <span className={`badge badge--${item.status}`} style={{ fontSize: 10, padding: "1px 6px", flexShrink: 0 }}>
                      {item.status}
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-muted)", paddingLeft: 19 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.subtitle}
                    </span>
                    <span style={{ flexShrink: 0 }}>
                      {new Date(item.timestamp).toLocaleDateString("en", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ─── RIGHT CARD: Process Inspector ─────────────────────────────────── */}
      <div className="card" style={{ display: "flex", flexDirection: "column" }}>
        {selected?.type === "issue" && selectedJob ? (
          /* ── Case 1: Issue Job Selected ── */
          <>
            <div className="card-header" style={{ padding: "14px 20px" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 3 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                    #{selectedJob.issue_number} {selectedJob.issue_title ?? "Untitled Issue"}
                  </span>
                  <span className={`badge badge--${selectedJob.status}`} style={{ fontSize: 11 }}>
                    {selectedJob.status}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text-muted)" }}>
                  <span>
                    📦 {repoMap.get(selectedJob.repo_id) ? `${repoMap.get(selectedJob.repo_id)!.owner}/${repoMap.get(selectedJob.repo_id)!.repo_name}` : selectedJob.repo_id}
                  </span>
                  {selectedJob.pr_url && (
                    <a href={selectedJob.pr_url} target="_blank" rel="noopener noreferrer" className="link">
                      🔀 View Pull Request ↗
                    </a>
                  )}
                </div>
              </div>

              <Link href={`/jobs/${selectedJob.id}`} className="btn btn--secondary btn--sm">
                Full Page ↗
              </Link>
            </div>

            <div className="card-body" style={{ padding: "16px 20px" }}>
              {/* 5-Agent Stepper */}
              <IssuePipelineStepper logs={liveLogs} status={selectedJob.status} />

              {/* Reviewer Score */}
              <ReviewerSection logs={liveLogs} />

              {/* Terminal Logs */}
              <div className="terminal" style={{ marginTop: 10 }}>
                <div className="terminal-header">
                  <div className="terminal-dot terminal-dot--red" />
                  <div className="terminal-dot terminal-dot--amber" />
                  <div className="terminal-dot terminal-dot--green" />
                  <span className="terminal-title">agent-process-stream</span>
                  {isStreaming && (
                    <span className="live-indicator" style={{ marginLeft: "auto" }}>
                      <span className="live-dot" /> streaming
                    </span>
                  )}
                </div>
                <div className="terminal-body" style={{ maxHeight: 340 }}>
                  {liveLogs.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Waiting for agents to output logs…
                    </div>
                  ) : (
                    liveLogs.map((log, i) => {
                      const color = AGENT_COLORS[log.agent] ?? "var(--agent-system)";
                      const time = new Date(log.timestamp).toLocaleTimeString("en", { hour12: false });
                      return (
                        <div key={i} className="log-line">
                          <span className="log-time">{time}</span>
                          <span className="log-agent" style={{ color }}>[{log.agent}]</span>
                          <span className="log-msg">{log.message}</span>
                        </div>
                      );
                    })
                  )}
                  <div ref={terminalBottomRef} />
                </div>
              </div>
            </div>
          </>
        ) : selected?.type === "index" && selectedRepo ? (
          /* ── Case 2: Indexing Job Selected ── */
          <>
            <div className="card-header" style={{ padding: "14px 20px" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 3 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                    📦 {selectedRepo.owner}/{selectedRepo.repo_name}
                  </span>
                  <span className={`badge badge--${selectedRepo.status}`} style={{ fontSize: 11 }}>
                    {selectedRepo.status}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text-muted)" }}>
                  <span>Registered: {new Date(selectedRepo.created_at).toLocaleDateString()}</span>
                  <a href={selectedRepo.github_url} target="_blank" rel="noopener noreferrer" className="link">
                    GitHub ↗
                  </a>
                </div>
              </div>

              <button
                className="btn btn--secondary btn--sm"
                onClick={() => handleReindex(selectedRepo.id)}
                disabled={reindexingId === selectedRepo.id || selectedRepo.status === "indexing"}
                style={{ opacity: selectedRepo.status === "indexing" ? 0.6 : 1 }}
              >
                {reindexingId === selectedRepo.id || selectedRepo.status === "indexing" ? (
                  <>
                    <span className="spinner" style={{ width: 12, height: 12 }} />
                    Indexing…
                  </>
                ) : (
                  "↺ Re-Index"
                )}
              </button>
            </div>

            <div className="card-body" style={{ padding: "16px 20px" }}>
              {/* Indexing Pipeline Stepper */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>
                  RAG Indexing Pipeline
                </div>
                <IndexPipelineStepper status={selectedRepo.status} />
              </div>

              {/* Repo Details Summary */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Clone Directory</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedRepo.clone_path || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>GitHub Webhook</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)" }}>
                    {selectedRepo.webhook_id ? `ID #${selectedRepo.webhook_id}` : "Registered"}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Vector Model</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--agent-rag)" }}>
                    text-embedding-3-small (1536 dims)
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Index Type</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--status-up)" }}>
                    pgvector HNSW Cosine
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: "rgba(56, 189, 248, 0.08)",
                  border: "1px solid rgba(56, 189, 248, 0.2)",
                  borderRadius: "var(--radius-md)",
                  padding: "12px 16px",
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                💡 <strong>Codebase Indexed:</strong> This repository has been vectorized and stored in Postgres pgvector. When new issues are opened on GitHub, the RAG agent retrieves the most relevant file chunks from this index before the Planner and Coder agents write the fix.
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state" style={{ padding: "80px 24px" }}>
            <div className="empty-state-icon">🤖</div>
            <div className="empty-state-title">No Item Selected</div>
            <div className="empty-state-sub">
              Select any issue job or indexing repository on the left to inspect its process.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
