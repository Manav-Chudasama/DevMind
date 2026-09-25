"use client";

import type { Job, Repo } from "@devmind/shared";
import { useState } from "react";
import Link from "next/link";

interface Props {
  jobs: Job[];
  repos: Repo[];
  counts: Record<string, number>;
}

const FILTERS = ["all", "running", "queued", "done", "declined", "failed"] as const;
type Filter = typeof FILTERS[number];

export function JobsTable({ jobs, repos, counts }: Props) {
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const repoMap = new Map(repos.map((r) => [r.id, r]));

  const filtered = activeFilter === "all"
    ? jobs
    : jobs.filter((j) => j.status === activeFilter);

  return (
    <>
      {/* Filter Tabs */}
      <div className="card-header">
        <div className="filter-tabs">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`filter-tab ${activeFilter === f ? "filter-tab--active" : ""}`}
              onClick={() => setActiveFilter(f)}
            >
              {f}
              <span className="filter-tab-count">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">No {activeFilter} jobs</div>
          <div className="empty-state-sub">Jobs appear when GitHub issues are processed.</div>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Issue</th>
              <th>Repository</th>
              <th>Status</th>
              <th>Review Score</th>
              <th>PR</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((job) => {
              const repo = repoMap.get(job.repo_id);
              const lastScore = job.agent_logs
                ?.filter((l) => l.agent === "reviewer")
                .map((l) => { const m = l.message.match(/score (\d+)\/10/); return m ? +m[1] : null; })
                .filter(Boolean).pop() as number | undefined;

              return (
                <tr key={job.id}>
                  <td>
                    <Link href={`/jobs/${job.id}`} className="link" style={{ fontWeight: 500 }}>
                      #{job.issue_number} {job.issue_title ?? "Untitled"}
                    </Link>
                  </td>
                  <td>
                    <span className="text-mono" style={{ fontSize: 12 }}>
                      {repo ? `${repo.owner}/${repo.repo_name}` : "—"}
                    </span>
                  </td>
                  <td><span className={`badge badge--${job.status}`}>{job.status}</span></td>
                  <td>
                    {lastScore
                      ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: lastScore >= 7 ? "var(--status-up)" : "var(--agent-reviewer)" }}>{lastScore}/10</span>
                      : <span className="text-muted">—</span>
                    }
                  </td>
                  <td>
                    {job.pr_url
                      ? <a href={job.pr_url} target="_blank" rel="noopener noreferrer" className="link">View PR ↗</a>
                      : <span className="text-muted">—</span>
                    }
                  </td>
                  <td className="text-muted text-sm">
                    {new Date(job.created_at).toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
