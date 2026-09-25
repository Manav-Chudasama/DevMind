import type { Metadata } from "next";
import type { Repo, Job } from "@devmind/shared";
import Link from "next/link";
import { MetricCard } from "@/components/MetricCard";
import { QueueMonitor } from "@/components/QueueMonitor";
import { ActiveWorkflows } from "@/components/ActiveWorkflows";
import { RecentJobsTable } from "@/components/RecentJobsTable";

export const metadata: Metadata = { title: "Overview" };

async function getData() {
  const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

  const [reposRes, jobsRes] = await Promise.allSettled([
    fetch(`${API}/api/repos`, { next: { revalidate: 5 } }),
    fetch(`${API}/api/jobs`,  { next: { revalidate: 5 } }),
  ]);

  const repos: Repo[] = reposRes.status === "fulfilled" && reposRes.value.ok
    ? await reposRes.value.json()
    : [];

  const jobs: Job[] = jobsRes.status === "fulfilled" && jobsRes.value.ok
    ? await jobsRes.value.json()
    : [];

  return { repos, jobs };
}

export default async function OverviewPage() {
  const { repos, jobs } = await getData();

  const runningJobs  = jobs.filter((j) => j.status === "running");
  const doneJobs     = jobs.filter((j) => j.status === "done");
  const readyRepos   = repos.filter((r) => r.status === "ready");
  const passedJobs   = jobs.filter((j) => j.status === "done" && j.pr_url);
  const successRate  = doneJobs.length > 0
    ? Math.round((passedJobs.length / doneJobs.length) * 100)
    : 0;

  return (
    <main className="page-content">
      {/* KPI Metrics */}
      <div className="metric-grid mb-24">
        <MetricCard
          label="Active Workflows"
          value={runningJobs.length}
          sub={`${jobs.filter((j) => j.status === "queued").length} queued`}
          variant="purple"
          icon="⚡"
        />
        <MetricCard
          label="Repositories"
          value={repos.length}
          sub={`${readyRepos.length} ready · ${repos.filter((r) => r.status === "indexing").length} indexing`}
          variant="blue"
          icon="📦"
        />
        <MetricCard
          label="PRs Created"
          value={passedJobs.length}
          sub={`from ${doneJobs.length} completed jobs`}
          variant="green"
          icon="🔀"
        />
        <MetricCard
          label="Success Rate"
          value={`${successRate}%`}
          sub="reviewer score ≥ 7/10"
          variant="amber"
          icon="✓"
        />
      </div>

      {/* Queue Monitor + Active Workflows */}
      <div className="grid-sidebar mb-24">
        <QueueMonitor />
        <ActiveWorkflows jobs={runningJobs} repos={repos} />
      </div>

      {/* Recent Activity */}
      <div className="section-header">
        <div>
          <div className="section-title">Recent Activity</div>
          <div className="section-sub">Latest 20 issue processing jobs</div>
        </div>
        <Link href="/jobs" className="btn btn--ghost btn--sm">View All →</Link>
      </div>

      <div className="card">
        <RecentJobsTable jobs={jobs.slice(0, 20)} repos={repos} />
      </div>
    </main>
  );
}
