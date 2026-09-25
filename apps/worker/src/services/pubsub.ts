import Redis from "ioredis";
import type { AgentLog, JobStatus } from "@devmind/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let _publisher: Redis | null = null;
function getPublisher(): Redis {
  if (!_publisher) {
    _publisher = new Redis(REDIS_URL);
  }
  return _publisher;
}

export async function publishJobLog(jobId: string, log: AgentLog): Promise<void> {
  try {
    const payload = JSON.stringify({ type: "log", data: log });
    await getPublisher().publish(`devmind:logs:${jobId}`, payload);
  } catch (err: any) {
    console.error(`[pubsub] failed to publish log for ${jobId}:`, err?.message);
  }
}

export async function publishJobStatus(
  jobId: string,
  status: JobStatus,
  prUrl?: string
): Promise<void> {
  try {
    const payload = JSON.stringify({
      type: "status",
      data: { status, pr_url: prUrl },
    });
    await getPublisher().publish(`devmind:logs:${jobId}`, payload);
  } catch (err: any) {
    console.error(`[pubsub] failed to publish status for ${jobId}:`, err?.message);
  }
}

export async function closePubSub(): Promise<void> {
  await _publisher?.quit().catch(() => {});
  _publisher = null;
}
