type HealthStatus = {
  status: string;
  postgres: "up" | "down";
  redis: "up" | "down";
  worker: "up" | "down";
};

async function getHealth(): Promise<HealthStatus | null> {
  try {
    const res = await fetch("http://localhost:8080/health", {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const dot = (up: boolean) => (
  <span style={{ color: up ? "#3fb950" : "#f85149" }}>{up ? "● up" : "● down"}</span>
);

export default async function HomePage() {
  const health = await getHealth();

  return (
    <main style={{ padding: "3rem 4rem", maxWidth: 720 }}>
      {/* Header */}
      <h1 style={{ fontSize: "2rem", marginBottom: "0.25rem" }}>DevMind</h1>
      <p style={{ color: "#8b949e", marginTop: 0 }}>
        Autonomous multi-agent platform — watches GitHub repos, fixes issues, opens PRs.
      </p>

      <hr style={{ borderColor: "#30363d", margin: "2rem 0" }} />

      {/* Infrastructure Status */}
      <h2 style={{ fontSize: "1rem", color: "#8b949e", textTransform: "uppercase", letterSpacing: 1 }}>
        Infrastructure Status
      </h2>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          <tr>
            <td style={{ padding: "0.5rem 1rem 0.5rem 0", color: "#8b949e" }}>API (Express :8080)</td>
            <td>{dot(health?.status === "ok")}</td>
          </tr>
          <tr>
            <td style={{ padding: "0.5rem 1rem 0.5rem 0", color: "#8b949e" }}>Postgres + pgvector</td>
            <td>{dot(health?.postgres === "up")}</td>
          </tr>
          <tr>
            <td style={{ padding: "0.5rem 1rem 0.5rem 0", color: "#8b949e" }}>Redis Stack</td>
            <td>{dot(health?.redis === "up")}</td>
          </tr>
          <tr>
            <td style={{ padding: "0.5rem 1rem 0.5rem 0", color: "#8b949e" }}>Worker (BullMQ)</td>
            <td>{dot(health?.worker === "up")}</td>
          </tr>
        </tbody>
      </table>

      {!health && (
        <p style={{ color: "#8b949e", fontSize: "0.875rem", marginTop: "1rem" }}>
          Start the API with: <code style={{ color: "#79c0ff" }}>bun run dev:api</code>
        </p>
      )}
      {health?.worker === "down" && (
        <p style={{ color: "#8b949e", fontSize: "0.875rem", marginTop: "1rem" }}>
          Worker not detected. Start it with: <code style={{ color: "#79c0ff" }}>bun run dev:worker</code>
        </p>
      )}

      <hr style={{ borderColor: "#30363d", margin: "2rem 0" }} />

      {/* Phase progress */}
      <h2 style={{ fontSize: "1rem", color: "#8b949e", textTransform: "uppercase", letterSpacing: 1 }}>
        Build Progress
      </h2>
      <ul style={{ lineHeight: 2, paddingLeft: "1.25rem" }}>
        <li style={{ color: "#3fb950" }}>Phase 1 — Scaffold &amp; Infrastructure ✓</li>
        <li style={{ color: "#8b949e" }}>Phase 2 — API Routes &amp; Queue Publisher</li>
        <li style={{ color: "#8b949e" }}>Phase 3 — RAG Indexer</li>
        <li style={{ color: "#8b949e" }}>Phase 4 — Agent Pipeline (LangGraph)</li>
        <li style={{ color: "#8b949e" }}>Phase 5 — Dashboard &amp; SSE Streaming</li>
        <li style={{ color: "#8b949e" }}>Phase 6 — Polish &amp; Production</li>
      </ul>
    </main>
  );
}
