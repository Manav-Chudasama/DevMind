import type { Metadata } from "next";
import type { Job, Repo } from "@devmind/shared";
import { notFound } from "next/navigation";
import { JobDetailClient } from "@/components/JobDetailClient";

interface Props { params: Promise<{ id: string }>; }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Job ${id.slice(0, 8)}` };
}

async function getData(id: string): Promise<{ job: Job; repo: Repo | null }> {
  const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  try {
    const [jobRes, reposRes] = await Promise.all([
      fetch(`${API}/api/jobs/${id}`, { next: { revalidate: 0 } }),
      fetch(`${API}/api/repos`,     { next: { revalidate: 30 } }),
    ]);
    if (!jobRes.ok) return notFound();
    const job: Job = await jobRes.json();
    const repos: Repo[] = reposRes.ok ? await reposRes.json() : [];
    const repo = repos.find((r) => r.id === job.repo_id) ?? null;
    return { job, repo };
  } catch {
    return notFound();
  }
}

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;
  const { job, repo } = await getData(id);
  return <JobDetailClient job={job} repo={repo} />;
}
