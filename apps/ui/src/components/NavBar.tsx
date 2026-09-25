"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface HealthStatus {
  status: string;
  postgres: "up" | "down";
  redis: "up" | "down";
  worker: "up" | "down";
}

function HealthDot({ up, loading }: { up: boolean; loading: boolean }) {
  return (
    <span
      className={`dot ${loading ? "dot--loading" : up ? "dot--up" : "dot--down"}`}
    />
  );
}

export function NavBar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchHealth() {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) setHealth(await res.json());
      else setHealth(null);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const links = [
    { href: "/",      label: "Overview" },
    { href: "/repos", label: "Repositories" },
    { href: "/jobs",  label: "Jobs" },
  ];

  return (
    <nav className="nav">
      {/* Brand */}
      <Link href="/" className="nav-brand">
        <div className="nav-brand-icon">⚡</div>
        DevMind
      </Link>

      {/* Nav Links */}
      <div className="nav-links">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`nav-link ${pathname === l.href ? "active" : ""}`}
          >
            {l.label}
          </Link>
        ))}
      </div>

      {/* Live Health Pill */}
      <div className="nav-health">
        <div className="health-item">
          <HealthDot up={health?.status === "ok"} loading={loading} />
          API
        </div>
        <div className="health-sep" />
        <div className="health-item">
          <HealthDot up={health?.worker === "up"} loading={loading} />
          Worker
        </div>
        <div className="health-sep" />
        <div className="health-item">
          <HealthDot up={health?.postgres === "up"} loading={loading} />
          Postgres
        </div>
        <div className="health-sep" />
        <div className="health-item">
          <HealthDot up={health?.redis === "up"} loading={loading} />
          Redis
        </div>
      </div>

      {/* Add Repo Quick Action */}
      <Link href="/repos" className="nav-add-btn">
        + Add Repo
      </Link>
    </nav>
  );
}
