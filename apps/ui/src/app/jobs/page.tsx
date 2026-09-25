import type { Metadata } from "next";
import type { Job, Repo } from "@devmind/shared";
import { JobsTable } from "@/components/JobsTable";

export const metadata: Metadata = { title: "Jobs" };

async function getData() {
  const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const [jobsRes, reposRes] = await Promise.allSettled([
    fetch(`${API}/api/jobs`,  { next: { revalidate: 4 } }),
    fetch(`${API}/api/repos`, { next: { revalidate: 30 } }),
  ]);
  const jobs: Job[]   = jobsRes.status  === "fulfilled" && jobsRes.value.ok  ? await jobsRes.value.json()  : [];
  const repos: Repo[] = reposRes.status === "fulfilled" && reposRes.value.ok ? await reposRes.value.json() : [];
  return { jobs, repos };
}

export default async function JobsPage() {
  const { jobs, repos } = await getData();

  const counts = {
    all:      jobs.length,
    running:  jobs.filter((j) => j.status === "running").length,
    queued:   jobs.filter((j) => j.status === "queued").length,
    done:     jobs.filter((j) => j.status === "done").length,
    declined: jobs.filter((j) => j.status === "declined").length,
    failed:   jobs.filter((j) => j.status === "failed").length,
  };

  return (
    <main className="page-content">
      <div className="section-header mb-24">
        <div>
          <div className="section-title">Issue Jobs</div>
          <div className="section-sub">{counts.all} total · {counts.running} active · {counts.done} completed</div>
        </div>
      </div>
      <div className="card">
        <JobsTable jobs={jobs} repos={repos} counts={counts} />
      </div>
    </main>
  );
}
