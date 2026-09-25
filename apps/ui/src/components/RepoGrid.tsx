"use client";

import type { Repo } from "@devmind/shared";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props { repos: Repo[]; }

const STATUS_LABEL: Record<string, string> = {
  ready: "● ready",
  indexing: "⟳ indexing",
  pending: "⟳ pending",
  error: "✕ error",
};

function RepoCard({ repo }: { repo: Repo }) {
  const [reindexing, setReindexing] = useState(false);
  const router = useRouter();

  async function handleReindex() {
    setReindexing(true);
    try {
      await fetch(`/api/repos/${repo.id}/reindex`, { method: "POST" });
      setTimeout(() => { router.refresh(); setReindexing(false); }, 1500);
    } catch { setReindexing(false); }
  }

  return (
    <div className="repo-card">
      {/* Top: Name + Badge */}
      <div className="repo-card-top">
        <div style={{ minWidth: 0 }}>
          <div className="repo-name">{repo.owner}/{repo.repo_name}</div>
          <div className="repo-meta">
            Registered {new Date(repo.created_at).toLocaleDateString("en", { month: "short", day: "numeric" })}
          </div>
        </div>
        <span className={`badge badge--${repo.status}`}>
          {STATUS_LABEL[repo.status] ?? repo.status}
        </span>
      </div>

      {/* Meta */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {repo.clone_path && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            📁 {repo.clone_path}
          </div>
        )}
        {repo.webhook_id && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            🪝 Webhook #{repo.webhook_id}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="repo-actions">
        <button
          className="btn btn--secondary btn--sm"
          onClick={handleReindex}
          disabled={reindexing || repo.status === "indexing"}
          style={{ opacity: (reindexing || repo.status === "indexing") ? 0.55 : 1 }}
        >
          {reindexing ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />Re-indexing…</> : "↺ Re-index"}
        </button>
        <a
          href={repo.github_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--ghost btn--sm"
        >
          GitHub ↗
        </a>
      </div>
    </div>
  );
}

export function RepoGrid({ repos }: Props) {
  if (repos.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📦</div>
        <div className="empty-state-title">No repositories registered</div>
        <div className="empty-state-sub">
          Register a GitHub repository above. DevMind will clone it, index the codebase,
          and register a webhook to watch for new issues automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="repo-grid">
      {repos.map((r) => <RepoCard key={r.id} repo={r} />)}
    </div>
  );
}
