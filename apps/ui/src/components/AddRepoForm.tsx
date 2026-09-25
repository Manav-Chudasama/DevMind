"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddRepoForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  const isValid = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || loading) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github_url: url.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? data.error ?? "Registration failed");
      } else {
        setSuccess(`✓ ${data.owner}/${data.repo_name} registered — indexing started`);
        setUrl("");
        setTimeout(() => { router.refresh(); setSuccess(null); }, 3000);
      }
    } catch (err: any) {
      setError("Could not reach the API server — is it running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "flex", gap: 10 }}>
        <input
          className="input"
          type="url"
          placeholder="https://github.com/owner/repository"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(null); }}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!isValid || loading}
          style={{ flexShrink: 0, opacity: (!isValid || loading) ? 0.55 : 1 }}
        >
          {loading ? <><span className="spinner" />Registering…</> : "Register Repo"}
        </button>
      </div>
      <div style={{ marginTop: 8, minHeight: 20 }}>
        {error && (
          <p style={{ color: "var(--status-down)", fontSize: 12 }}>⚠ {error}</p>
        )}
        {success && (
          <p style={{ color: "var(--status-up)", fontSize: 12 }}>{success}</p>
        )}
        {!error && !success && url && !isValid && (
          <p style={{ color: "var(--status-pending)", fontSize: 12 }}>
            Must be a valid GitHub URL: https://github.com/owner/repo
          </p>
        )}
      </div>
    </form>
  );
}
