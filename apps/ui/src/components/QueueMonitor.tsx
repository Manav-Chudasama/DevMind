"use client";

import { useEffect, useState } from "react";

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

const EMPTY: QueueCounts = { active: 0, waiting: 0, completed: 0, failed: 0 };

function QueueRow({ name, stats }: { name: string; stats: QueueCounts }) {
  return (
    <div className="queue-item">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="queue-name">{name}</div>
        <div className="queue-stats">
          <div className="queue-stat">
            <span className="queue-stat-label">Active</span>
            <span className={`queue-stat-value ${stats.active > 0 ? "queue-stat-value--active" : ""}`}>
              {stats.active}
            </span>
          </div>
          <div className="queue-stat">
            <span className="queue-stat-label">Waiting</span>
            <span className="queue-stat-value">{stats.waiting}</span>
          </div>
          <div className="queue-stat">
            <span className="queue-stat-label">Done</span>
            <span className="queue-stat-value queue-stat-value--done">{stats.completed}</span>
          </div>
          <div className="queue-stat">
            <span className="queue-stat-label">Failed</span>
            <span className={`queue-stat-value ${stats.failed > 0 ? "queue-stat-value--failed" : ""}`}>
              {stats.failed}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function QueueMonitor() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetch_stats() {
    try {
      const res = await fetch("/api/queues");
      if (res.ok) setStats(await res.json());
    } catch {
      // API not reachable — show graceful fallback
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch_stats();
    const id = setInterval(fetch_stats, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">BullMQ Queues</span>
        {stats && (
          <span className="live-indicator">
            <span className="live-dot" />
            Live
          </span>
        )}
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
            <div className="spinner" />
          </div>
        ) : (
          <>
            <QueueRow
              name="devmind-index-repo"
              stats={stats?.indexRepo ?? EMPTY}
            />
            <QueueRow
              name="devmind-fix-issue"
              stats={stats?.fixIssue ?? EMPTY}
            />
            {!stats && (
              <p className="text-muted text-sm" style={{ marginTop: 12 }}>
                Queue stats unavailable — start the API.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
