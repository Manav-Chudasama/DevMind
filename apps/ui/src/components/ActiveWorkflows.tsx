import type { Job, Repo } from "@devmind/shared";
import Link from "next/link";

interface Props { jobs: Job[]; repos: Repo[]; }

const AGENT_COLORS: Record<string, string> = {
  orchestrator: "var(--agent-orchestrator)",
  rag:          "var(--agent-rag)",
  planner:      "var(--agent-planner)",
  coder:        "var(--agent-coder)",
  reviewer:     "var(--agent-reviewer)",
  system:       "var(--agent-system)",
};

function getCurrentAgent(job: Job): string {
  if (!job.agent_logs?.length) return "starting";
  const last = job.agent_logs[job.agent_logs.length - 1];
  return last.agent;
}

export function ActiveWorkflows({ jobs, repos }: Props) {
  const repoMap = new Map(repos.map((r) => [r.id, r]));

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Active Workflows</span>
        {jobs.length > 0 && (
          <span className="live-indicator">
            <span className="live-dot" />
            {jobs.length} running
          </span>
        )}
      </div>
      <div className="card-body">
        {jobs.length === 0 ? (
          <div className="empty-state" style={{ padding: "32px 16px" }}>
            <div className="empty-state-icon">🤖</div>
            <div className="empty-state-title">No active workflows</div>
            <div className="empty-state-sub">Agents wake up when a GitHub issue is opened on a registered repo.</div>
          </div>
        ) : (
          jobs.map((job) => {
            const repo = repoMap.get(job.repo_id);
            const agent = getCurrentAgent(job);
            const color = AGENT_COLORS[agent] ?? "var(--text-muted)";

            return (
              <Link key={job.id} href={`/jobs/${job.id}`} className="workflow-card">
                <div className="workflow-card-phase" />
                <div className="workflow-card-info">
                  <div className="workflow-card-title">
                    #{job.issue_number} · {job.issue_title ?? "Untitled Issue"}
                  </div>
                  <div className="workflow-card-sub">
                    {repo ? `${repo.owner}/${repo.repo_name}` : job.repo_id.slice(0, 8)}
                  </div>
                </div>
                <div
                  className="workflow-card-agent"
                  style={{
                    background: `${color}18`,
                    color,
                    border: `1px solid ${color}40`,
                  }}
                >
                  [{agent}]
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
