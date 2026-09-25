"use client";

import type { Job, Repo, AgentLog } from "@devmind/shared";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

/* ──────────────────────────────────────────────
   Pipeline Step Config
   ────────────────────────────────────────────── */

const PIPELINE_STEPS = [
  { id: "orchestrator", label: "Orchestrator", icon: "⚡" },
  { id: "rag",          label: "RAG",          icon: "🔍" },
  { id: "planner",      label: "Planner",      icon: "📋" },
  { id: "coder",        label: "Coder",        icon: "💻" },
  { id: "reviewer",     label: "Reviewer",     icon: "🔬" },
];

const AGENT_COLORS: Record<string, string> = {
  orchestrator: "var(--agent-orchestrator)",
  rag:          "var(--agent-rag)",
  planner:      "var(--agent-planner)",
  coder:        "var(--agent-coder)",
  reviewer:     "var(--agent-reviewer)",
  system:       "var(--agent-system)",
};

/* ──────────────────────────────────────────────
   Pipeline Stepper
   ────────────────────────────────────────────── */

function PipelineStepper({ logs, status }: { logs: AgentLog[]; status: string }) {
  const seenAgents = new Set(logs.map((l) => l.agent));
  const lastAgent = logs.length > 0 ? logs[logs.length - 1].agent : null;
  const isDone = status === "done" || status === "declined" || status === "failed";

  return (
    <div className="pipeline-stepper">
      {PIPELINE_STEPS.map((step, i) => {
        const done   = isDone ? seenAgents.has(step.id) : seenAgents.has(step.id) && lastAgent !== step.id;
        const active = !isDone && lastAgent === step.id;
        const state  = done ? "done" : active ? "active" : "idle";

        return (
          <div key={step.id} className="pipeline-step">
            <div className={`pipeline-node pipeline-node--${state}`}>
              <div className={`pipeline-node-circle pipeline-node-circle--${state}`}>
                {done ? "✓" : step.icon}
              </div>
              <div className="pipeline-node-label">{step.label}</div>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div className={`pipeline-connector ${done ? "pipeline-connector--done" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Agent Terminal
   ────────────────────────────────────────────── */

function AgentTerminal({ logs, streaming }: { logs: AgentLog[]; streaming: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="terminal">
      <div className="terminal-header">
        <div className="terminal-dot terminal-dot--red" />
        <div className="terminal-dot terminal-dot--amber" />
        <div className="terminal-dot terminal-dot--green" />
        <span className="terminal-title">agent-logs</span>
        {streaming && (
          <span className="live-indicator" style={{ marginLeft: "auto" }}>
            <span className="live-dot" /> streaming
          </span>
        )}
      </div>
      <div className="terminal-body">
        {logs.length === 0 && (
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Waiting for agents to start…
          </div>
        )}
        {logs.map((log, i) => {
          const color = AGENT_COLORS[log.agent] ?? "var(--agent-system)";
          const time = new Date(log.timestamp).toLocaleTimeString("en", { hour12: false });
          return (
            <div key={i} className="log-line">
              <span className="log-time">{time}</span>
              <span className="log-agent" style={{ color }}>[{log.agent}]</span>
              <span className="log-msg">{log.message}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Reviewer Score Panel
   ────────────────────────────────────────────── */

function ReviewerPanel({ logs }: { logs: AgentLog[] }) {
  const reviewerLogs = logs.filter((l) => l.agent === "reviewer");
  if (reviewerLogs.length === 0) return null;

  const lastLog = reviewerLogs[reviewerLogs.length - 1];
  const scoreMatch = reviewerLogs
    .map((l) => l.message.match(/score[:\s]+(\d+)\s*\/\s*10/i))
    .filter(Boolean)
    .pop() ?? null;
  const score = scoreMatch ? +scoreMatch[1] : null;
  const pass = score != null && score >= 7;

  return (
    <div className="card mb-16">
      <div className="card-header">
        <span className="card-title">Reviewer Decision</span>
        {score != null && (
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: pass ? "var(--status-up)" : "var(--agent-reviewer)" }}>
            {score}/10 {pass ? "✓ PASS" : "✕ FAIL"}
          </span>
        )}
      </div>
      <div className="card-body">
        {score != null && (
          <>
            <div className="score-meter mb-12">
              <div className="score-bar">
                <div
                  className={`score-fill score-fill--${pass ? "pass" : "fail"}`}
                  style={{ width: `${score * 10}%` }}
                />
              </div>
              <span className="score-value" style={{ color: pass ? "var(--status-up)" : "var(--agent-reviewer)" }}>
                {score}/10
              </span>
            </div>
          </>
        )}
        <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          {lastLog.message}
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Main Client Component
   ────────────────────────────────────────────── */

interface Props { job: Job; repo: Repo | null; }

export function JobDetailClient({ job: initialJob, repo }: Props) {
  const [job, setJob] = useState<Job>(initialJob);
  const [streaming, setStreaming] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Collect logs (DB logs + live streamed)
  const [liveLogs, setLiveLogs] = useState<AgentLog[]>(initialJob.agent_logs ?? []);
  const isTerminal = job.status === "done" || job.status === "declined" || job.status === "failed";

  // SSE connection for running jobs
  const connect = useCallback(() => {
    if (isTerminal) return;
    if (esRef.current) esRef.current.close();

    const es = new EventSource(`/api/jobs/${job.id}/stream`);
    esRef.current = es;

    es.addEventListener("log", (e) => {
      try {
        const entry: AgentLog = JSON.parse(e.data);
        setLiveLogs((prev) => {
          // Deduplicate by timestamp+agent+message
          const key = `${entry.timestamp}:${entry.agent}:${entry.message}`;
          if (prev.some((l) => `${l.timestamp}:${l.agent}:${l.message}` === key)) return prev;
          return [...prev, entry];
        });
      } catch {}
    });

    es.addEventListener("status", (e) => {
      try {
        const update = JSON.parse(e.data) as Partial<Job>;
        setJob((prev) => ({ ...prev, ...update }));
        if (update.status === "done" || update.status === "declined" || update.status === "failed") {
          setStreaming(false);
          es.close();
        }
      } catch {}
    });

    es.onopen = () => setStreaming(true);
    es.onerror = () => {
      setStreaming(false);
      // Retry after 5s if job is still running
      setTimeout(() => {
        if (!isTerminal) connect();
      }, 5000);
    };
  }, [job.id, isTerminal]);

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  const repoLabel = repo ? `${repo.owner}/${repo.repo_name}` : job.repo_id;

  return (
    <main className="page-content">
      {/* Breadcrumb */}
      <div className="flex-center gap-10 mb-16" style={{ fontSize: 13 }}>
        <Link href="/jobs" className="text-muted link">Jobs</Link>
        <span className="text-muted">/</span>
        <span className="text-secondary">#{job.issue_number} {job.issue_title ?? "Untitled"}</span>
      </div>

      {/* Job Header */}
      <div className="card mb-16">
        <div className="card-body">
          <div className="flex-between" style={{ flexWrap: "wrap", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
                #{job.issue_number} {job.issue_title ?? "Untitled Issue"}
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
                <span>📦 {repoLabel}</span>
                <span>🕐 {new Date(job.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</span>
                {job.pr_url && (
                  <a href={job.pr_url} target="_blank" rel="noopener noreferrer" className="link">
                    🔀 View PR ↗
                  </a>
                )}
              </div>
            </div>
            <span className={`badge badge--${job.status}`} style={{ fontSize: 13, padding: "5px 14px" }}>
              {job.status}
            </span>
          </div>

          {/* Pipeline Stepper */}
          <PipelineStepper logs={liveLogs} status={job.status} />
        </div>
      </div>

      {/* Reviewer Panel (if applicable) */}
      <ReviewerPanel logs={liveLogs} />

      {/* Agent Log Terminal */}
      <div className="card-header mb-8 p-0" style={{ paddingBottom: 8 }}>
        <span className="section-title">Agent Log Stream</span>
        {streaming && (
          <span className="live-indicator">
            <span className="live-dot" />
            Live
          </span>
        )}
      </div>
      <AgentTerminal logs={liveLogs} streaming={streaming} />
    </main>
  );
}
