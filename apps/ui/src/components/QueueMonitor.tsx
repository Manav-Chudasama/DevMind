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

function QueueCard({
  name,
  icon,
  description,
  stats,
  loading,
}: {
  name: string;
  icon: string;
  description: string;
  stats: QueueCounts;
  loading: boolean;
}) {
  return (
    <div className="card">
      <div className="card-header" style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {name}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {description}
            </div>
          </div>
        </div>
        <span className="live-indicator">
          <span className="live-dot" />
          Live
        </span>
      </div>
      <div className="card-body" style={{ padding: "14px 18px" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px" }}>
            <div className="spinner" />
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
            }}
          >
            <div
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                padding: "8px 10px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 2,
                }}
              >
                Active
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 17,
                  fontWeight: 700,
                  color:
                    stats.active > 0
                      ? "var(--status-indexing)"
                      : "var(--text-primary)",
                }}
              >
                {stats.active}
              </div>
            </div>

            <div
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                padding: "8px 10px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 2,
                }}
              >
                Waiting
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 17,
                  fontWeight: 700,
                  color:
                    stats.waiting > 0
                      ? "var(--status-pending)"
                      : "var(--text-primary)",
                }}
              >
                {stats.waiting}
              </div>
            </div>

            <div
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                padding: "8px 10px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 2,
                }}
              >
                Done
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 17,
                  fontWeight: 700,
                  color: "var(--status-up)",
                }}
              >
                {stats.completed}
              </div>
            </div>

            <div
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                padding: "8px 10px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 2,
                }}
              >
                Failed
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 17,
                  fontWeight: 700,
                  color:
                    stats.failed > 0
                      ? "var(--status-down)"
                      : "var(--text-primary)",
                }}
              >
                {stats.failed}
              </div>
            </div>
          </div>
        )}
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
      // API not reachable
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
    <div className="grid-2 mb-24">
      <QueueCard
        name="devmind-index-repo"
        icon="📦"
        description="Repo cloning & vector embeddings"
        stats={stats?.indexRepo ?? EMPTY}
        loading={loading}
      />
      <QueueCard
        name="devmind-fix-issue"
        icon="⚡"
        description="Multi-agent issue fix & PR generation"
        stats={stats?.fixIssue ?? EMPTY}
        loading={loading}
      />
    </div>
  );
}
