# AGENTS.md — DevMind Project Guide for AI Agents

This file is the primary reference for any AI coding agent working on this codebase.
Read it fully before making changes. The [devmind_implementation_plan.md](devmind_implementation_plan.md) is the extended design document.

---

## What is DevMind?

An autonomous multi-agent platform that watches GitHub repos and automatically fixes issues by writing code and opening pull requests. A pipeline of 5 AI agents (Orchestrator, RAG, Planner, Coder, Reviewer) wakes up on every issue, reads the codebase, writes a fix, and opens a PR. The human reviews and merges.

---

## Runtime & Package Manager

- **Runtime: Bun** — use `bun` everywhere. Never suggest `node`, `npx`, `npm install`, or `ts-node`.
- `bun add <pkg>` — install a dependency
- `bun add -d <pkg>` — install a dev dependency
- `bun run dev` — run the dev script in a package
- `bun --watch src/index.ts` — watch mode (replaces nodemon/tsx)
- `bunx <tool>` — replaces npx

## Monorepo Layout

```
devmind/
├── package.json              (Bun workspaces root)
├── docker-compose.yml        (infra only: postgres, redis, redisinsight)
├── .env.example              (all required env vars — copy to .env)
│
├── apps/
│   ├── api/                  (@devmind/api) Express API + webhook receiver — port 8080
│   ├── worker/               (@devmind/worker) BullMQ workers + LangGraph agents
│   └── ui/                   (@devmind/ui) Next.js 15 dashboard — port 3000
│
└── packages/
    └── shared/               (@devmind/shared) shared TypeScript types only
```

Root dev scripts (run from repo root):
```
bun run dev:api      → starts apps/api in watch mode
bun run dev:worker   → starts apps/worker in watch mode
bun run dev:ui       → starts apps/ui (Next.js dev)
bun run infra:up     → docker compose up -d
bun run infra:down   → docker compose down
```

---

## Docker (Infrastructure only)

Only three infra services run in Docker. The three apps (api, worker, ui) run locally.

| Service | Image | Port |
|---|---|---|
| Postgres + pgvector | pgvector/pgvector:pg16 | 5432 |
| Redis Stack | redis/redis-stack-server:latest | 6379 |
| RedisInsight | redis/redisinsight:latest | 8001 |

Dockerfiles for api/worker/ui are added in Phase 6 (production). Do not add them earlier.

---

## Database Schema

Three tables in the `devmind` Postgres database. Schema lives in `apps/api/src/db/schema.sql` and is auto-applied on first `docker compose up`.

- `repos` — registered GitHub repos (id, github_url, owner, repo_name, status, webhook_id)
- `jobs` — issue fix jobs (id, repo_id, issue_number, status, pr_url, agent_logs JSONB)
- `embeddings` — pgvector embeddings (id, repo_id, file_path, chunk_text, embedding vector(1536))

---

## Environment Variables

See `.env.example` for all vars. Three require external accounts:

| Var | Source | Needed from |
|---|---|---|
| `GITHUB_TOKEN` | GitHub PAT (repo + admin:repo_hook scopes) | Phase 2 |
| `GITHUB_WEBHOOK_SECRET` | Any random string (must match GitHub webhook config) | Phase 2 |
| `OPENAI_API_KEY` | platform.openai.com | Phase 3 |

All others are local config with sensible defaults (`localhost:5432`, `localhost:6379`, etc.).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| API | Express 4 + TypeScript |
| Worker | BullMQ + LangGraph.js + TypeScript |
| Agent Framework | LangGraph.js (`@langchain/langgraph`) |
| LLM | OpenAI GPT-4o (`@langchain/openai`) |
| Embeddings | OpenAI text-embedding-3-small |
| Database | Postgres 16 + pgvector (`postgres` npm package) |
| Queue + Memory | Redis Stack (`ioredis`) |
| Frontend | Next.js 15 App Router + TypeScript |
| GitHub API | Octokit |
| Git ops | simple-git |

---

## The 5 Agents (Phase 4)

```
START
  → Orchestrator   (check Redis memory, enrich context)
  → RAG            (cosine search over embeddings, filtered by repo_id)
  → Planner        (structured fix plan: files + changes + reasoning)
  → Coder          (read files via GitHub API, generate diff)
  → Reviewer       (score 1-10; if < 7 → back to Coder, max 3 iterations)
      │
      ├── score >= 7  →  createPR → postComment → saveMemory → END
      └── score < 7   →  Coder (loop)
```

Graph state is in `packages/shared/types.ts` as `GraphState`.

---

## Implementation Phases

| Phase | What ships | Status |
|---|---|---|
| 1 | Monorepo scaffold + Docker infra + app health checks | In progress |
| 2 | Express routes + BullMQ queue publisher + webhook receiver | Pending |
| 3 | RAG indexer (chunker + embedder + retriever) | Pending |
| 4 | Full LangGraph agent pipeline | Pending |
| 5 | Next.js dashboard + SSE log streaming | Pending |
| 6 | Polish, Dockerfiles for apps, deployment | Pending |

---

## Key Rules for AI Agents

1. **Bun only** — never suggest Node.js commands or npm/npx.
2. **No Dockerfiles for apps** until Phase 6.
3. **No agent/LangGraph code** until Phase 4.
4. **No BullMQ consumers** until Phase 2.
5. **GitHub MCP is read-only** — the MCP tool must never create repos, push files, open PRs, or register webhooks. Those actions are done by the running DevMind app using `GITHUB_TOKEN`.
6. **Shared types only** in `packages/shared` — no runtime logic there.
7. **One concern per file** — keep files small and focused.
