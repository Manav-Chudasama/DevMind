import type { Job, Repo } from "@devmind/shared";
import Link from "next/link";

interface Props { jobs: Job[]; repos: Repo[]; }

const STATUS_LABEL: Record<string, string> = {
  running: "running",
  queued:  "queued",
  done:    "done",
  declined: "declined",
  failed:  "failed",
};

function ScoreBadge({ score }: { score: number | undefined }) {
  if (!score) return <span className="text-muted">—</span>;
  const pass = score >= 7;
  return (
    <span style={{
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      fontWeight: 600,
      color: pass ? "var(--status-up)" : "var(--agent-reviewer)",
    }}>
      {score}/10
    </span>
  );
}

export function RecentJobsTable({ jobs, repos }: Props) {
  const repoMap = new Map(repos.map((r) => [r.id, r]));

  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div className="empty-state-title">No jobs yet</div>
        <div className="empty-state-sub">Jobs appear here when GitHub issues are opened on registered repos.</div>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Issue</th>
          <th>Repository</th>
          <th>Status</th>
          <th>Score</th>
          <th>PR</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => {
          const repo = repoMap.get(job.repo_id);
          const lastLog = job.agent_logs?.[job.agent_logs.length - 1];
          const reviewScore = job.agent_logs
            ?.filter((l) => l.agent === "reviewer")
            .map((l) => {
              const m = l.message.match(/score (\d+)\/10/);
              return m ? Number(m[1]) : null;
            })
            .filter(Boolean)
            .pop() as number | undefined;

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
              <td>
                <span className={`badge badge--${job.status}`}>
                  {STATUS_LABEL[job.status] ?? job.status}
                </span>
              </td>
              <td><ScoreBadge score={reviewScore} /></td>
              <td>
                {job.pr_url ? (
                  <a href={job.pr_url} target="_blank" rel="noopener noreferrer" className="link">
                    View PR ↗
                  </a>
                ) : <span className="text-muted">—</span>}
              </td>
              <td className="text-muted text-sm">
                {new Date(job.created_at).toLocaleDateString("en", {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
