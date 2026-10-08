# 🧠 DevMind

<div align="center">

![DevMind Banner](https://img.shields.io/badge/DevMind-Autonomous%20AI%20Software%20Engineer-7C3AED?style=for-the-badge&logo=openai&logoColor=white)

[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?style=flat-square&logo=bun&logoColor=black)](https://bun.sh)
[![Language: TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Framework: Next.js 15](https://img.shields.io/badge/Next.js-15%20App%20Router-black?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![Agents: LangGraph.js](https://img.shields.io/badge/Agents-LangGraph.js-orange?style=flat-square&logo=langchain&logoColor=white)](https://langchain-ai.github.io/langgraphjs/)
[![Vector DB: pgvector](https://img.shields.io/badge/Vector%20DB-pgvector%20(Postgres%2016)-336791?style=flat-square&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Queue: BullMQ + Redis](https://img.shields.io/badge/Queue-BullMQ%20%2B%20Redis%20Stack-dc382d?style=flat-square&logo=redis&logoColor=white)](https://bullmq.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**An autonomous multi-agent platform that monitors GitHub repositories, indexes codebases with vector RAG, diagnoses issues, writes production-ready code, self-critiques changes, and opens pull requests automatically.**

[Key Features](#-key-features) • [Architecture](#-architecture) • [Agent Pipeline](#-the-5-agent-pipeline) • [Getting Started](#-getting-started) • [Environment Config](#-environment-variables) • [Development Scripts](#-development-scripts)

</div>

---

## 💡 What is DevMind?

DevMind acts as an autonomous AI software engineer directly integrated into your GitHub workflow. When an issue is opened or a human developer requests revisions via comments, DevMind:

1. **Retrieves codebase context** using high-density vector embeddings (`pgvector` + OpenAI).
2. **Formulates a structured execution plan** identifying the exact root cause and target files.
3. **Generates targeted unified code diffs** tailored to your repository conventions.
4. **Performs self-critique and automated review scoring** (1–10). If the score is `< 7`, it loops back to the Coder agent with constructive feedback.
5. **Pushes a git branch and opens a Pull Request** with detailed reasoning, file changes, and review verdicts.
6. **Maintains Human-in-the-Loop safety** — DevMind never automatically merges code without human approval.

---

## ⚡ Key Features

- **Multi-Agent LangGraph Pipeline**: 5 specialized agents (`Orchestrator`, `RAG`, `Planner`, `Coder`, `Reviewer`) collaborate through a stateful graph with conditional self-correction loops.
- **Isolated Multi-Repo RAG**: Register multiple GitHub repositories in a single instance. Embeddings are tagged and queried by `repo_id`, ensuring zero cross-repo context contamination.
- **Resilient Distributed Queues**: Built on BullMQ and Redis Stack with independent job queues (`index-repo` and `fix-issue`), concurrency throttles, and Redis-backed worker locks.
- **Interactive Revisions via Mentions**: Ping `@devmind` or `/devmind` on pull request review threads or issue comments to trigger iterative code adjustments.
- **Real-Time Observability Dashboard**: Built with Next.js 15 App Router and Server-Sent Events (SSE) to stream live agent reasoning steps, file diffs, job progression, and system health metrics.
- **Local & Sovereign**: Runs on your own machine or private cloud using Docker infrastructure and the high-performance Bun runtime.

---

## 🏛 Architecture

```mermaid
flowchart TD
    GH([GitHub Repositories]) -->|Webhook: issue / comment| API[Express API :8080]
    API -->|HMAC Verification & Validation| BMQ[(BullMQ + Redis)]
    
    subgraph Worker Pool [DevMind Worker :8081]
        BMQ -->|Job Dispatch| W[BullMQ Consumer]
        W --> LG[LangGraph Pipeline]
        
        subgraph LangGraph State Machine
            ORCH[1. Orchestrator<br/>Redis Memory Context] --> RAG[2. RAG Agent<br/>pgvector Cosine Search]
            RAG --> PLAN[3. Planner Agent<br/>Fix Strategy / Decline Check]
            PLAN -->|Action: Fix| CODE[4. Coder Agent<br/>Diff & Patch Generation]
            PLAN -->|Action: Decline| DECLINE[Decline Node<br/>Post Explanation]
            CODE --> REV[5. Reviewer Agent<br/>Code Quality & Score 1-10]
            REV -->|Score < 7 & Iterations < Max| CODE
            REV -->|Score >= 7 or Max Iterations| FIN[Finalize Node<br/>Git Commit & PR]
        end
    end

    RAG <-->|Vector Retrieval| PG[(Postgres 16 + pgvector)]
    FIN -->|Create Branch & Open PR| GH
    DECLINE -->|Comment Reason| GH
    
    W -.->|Publish Logs via Redis Pub/Sub| API
    API -.->|Server-Sent Events /api/jobs/:id/stream| UI[Next.js 15 Dashboard :3000]
```

---

## 🤖 The 5-Agent Pipeline

```
START
  │
  ▼
[ 1. Orchestrator ] ── Reads episodic memory & past fix patterns from Redis
  │
  ▼
[ 2. RAG Agent ] ───── Performs cosine similarity search over pgvector embeddings
  │
  ▼
[ 3. Planner ] ─────── Determines actionable strategy; declines non-code or out-of-scope issues
  │         │
  │ (fix)   └── (decline) ──► Posts helpful comment to issue & ends
  ▼
[ 4. Coder ] ───────── Synthesizes git patches and unified file diffs
  │
  ▼
[ 5. Reviewer ] ────── Scores diff quality (1–10) across functionality, regressions, and syntax
  │
  ├── Score < 7 & loop < limit ──► Loops back to [Coder] with targeted critique
  └── Score ≥ 7 or limit hit  ──► [Finalize] pushes branch, opens GitHub PR, saves memory
```

---

## 📁 Monorepo Structure

```
devmind/
├── package.json              # Bun workspace root configuration & orchestrator scripts
├── docker-compose.yml        # Infrastructure: Postgres 16 (pgvector), Redis Stack, RedisInsight
├── .env.example              # Environment variables template
├── Agents.md                 # Agent-level design instructions & operating rules
│
├── apps/
│   ├── api/                  # Express 4 API server, webhook receiver, SSE endpoints (Port 8080)
│   ├── worker/               # BullMQ background workers, LangGraph pipeline, RAG engine (Port 8081)
│   └── ui/                   # Next.js 15 App Router dashboard with live streaming logs (Port 3000)
│
├── packages/
│   └── shared/               # Shared TypeScript schemas, database types, and queue contracts
│
└── scripts/
    └── kill-dev.ps1          # Utility script to cleanly terminate dangling dev processes (Windows)
```

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (`>= 1.1`) installed globally
- [Docker](https://www.docker.com/) & Docker Compose
- An [OpenAI API Key](https://platform.openai.com/) (with access to `gpt-4o` and `text-embedding-3-small`)
- A [GitHub Personal Access Token](https://github.com/settings/tokens) (Classic PAT with `repo` and `admin:repo_hook` scopes)

---

### Step 1: Clone & Install Dependencies

```bash
git clone https://github.com/Manav-Chudasama/DevMind.git
cd DevMind

# Install monorepo dependencies using Bun
bun install
```

---

### Step 2: Configure Environment Variables

Copy `.env.example` to `.env` in the root directory:

```bash
cp .env.example .env
```

Open `.env` and configure your credentials:

```ini
# External Credentials
GITHUB_TOKEN=ghp_your_github_personal_access_token_here
GITHUB_WEBHOOK_SECRET=your_custom_webhook_secret_string
OPENAI_API_KEY=sk-your_openai_api_key_here

# LLM Models
LLM_MODEL=gpt-4o
EMBEDDING_MODEL=text-embedding-3-small

# Database & Redis (matches docker-compose.yml defaults)
DATABASE_URL=postgresql://admin:secret@localhost:5432/devmind
REDIS_URL=redis://localhost:6379

# Network URLs
PORT=8080
PUBLIC_URL=http://localhost:8080
WORKER_BASE_URL=http://localhost:8081
WORKER_HEALTH_PORT=8081
```

> **Note for Local Webhook Testing**: Use a tunneling tool like [ngrok](https://ngrok.com) (`ngrok http 8080`) and set `PUBLIC_URL` to your forwarder URL (`https://your-domain.ngrok-free.app`) so GitHub can deliver webhooks.

---

### Step 3: Launch Local Infrastructure

Start the Docker containers (PostgreSQL with `pgvector`, Redis Stack, and RedisInsight):

```bash
bun run infra:up
```

- **PostgreSQL**: `localhost:5432` (Auto-initializes schema from `apps/api/src/db/schema.sql`)
- **Redis**: `localhost:6379`
- **RedisInsight GUI**: [http://localhost:8001](http://localhost:8001)

---

### Step 4: Run Dev Services

Start each service in separate terminal sessions:

```bash
# Terminal 1 — Start the Express API (Runs in watch mode)
bun run dev:api

# Terminal 2 — Start the BullMQ Worker & LangGraph Agents
bun run dev:worker

# Terminal 3 — Start the Next.js 15 UI Dashboard
bun run dev:ui
```

Access the dashboard at **[http://localhost:3000](http://localhost:3000)**.

---

## 🛠 Development Scripts

All scripts should be executed with `bun` from the monorepo root:

| Command | Description |
|---|---|
| `bun run dev:api` | Starts `apps/api` with automatic watch reload on `http://localhost:8080` |
| `bun run dev:worker` | Starts `apps/worker` BullMQ processor on `http://localhost:8081` |
| `bun run dev:ui` | Starts `apps/ui` Next.js development server on `http://localhost:3000` |
| `bun run infra:up` | Starts Docker containers for Postgres, Redis Stack, and RedisInsight |
| `bun run infra:down` | Shuts down Docker infrastructure containers |
| `bun run infra:logs` | Streams live logs from Docker containers |
| `bun run kill:dev` | Force terminates orphaned Bun processes on ports 8080, 8081, and 3000 |

> ⚠️ **Worker Hot Reloading**: The worker intentionally runs without `--watch` to prevent orphaned BullMQ jobs and lock collisions mid-execution. After modifying worker files, stop and restart `bun run dev:worker`.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GITHUB_TOKEN` | GitHub PAT (`repo` + `admin:repo_hook` scopes) | Required |
| `GITHUB_WEBHOOK_SECRET` | Secret token to sign and verify webhook payloads | Required |
| `OPENAI_API_KEY` | OpenAI API key for embeddings and agent generation | Required |
| `LLM_MODEL` | Foundation model for Planner, Coder, and Reviewer agents | `gpt-4o` |
| `EMBEDDING_MODEL` | Vector embedding model (1536 dimensions) | `text-embedding-3-small` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://admin:secret@localhost:5432/devmind` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `PORT` | HTTP port for the Express API | `8080` |
| `PUBLIC_URL` | Public API URL used during webhook registration | `http://localhost:8080` |
| `WORKER_BASE_URL` | URL where the API reaches the worker internal HTTP service | `http://localhost:8081` |
| `WORKER_HEALTH_PORT` | HTTP port bound by the worker for health probes & RAG search | `8081` |
| `WORKER_CONCURRENCY` | Maximum concurrent repo indexing jobs | `5` |
| `MAX_REVIEW_ITERATIONS` | Max self-critique loop iterations before opening PR | `3` |
| `GIT_AUTHOR_NAME` | Git commit author name used by DevMind | `DevMind` |
| `GIT_AUTHOR_EMAIL` | Git commit email used by DevMind | `devmind@users.noreply.github.com` |

---

## 📡 API & Webhook Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | `GET` | Health status checking Postgres, Redis, and Worker connectivity |
| `/api/repos` | `GET` | List all tracked repositories and their indexing statuses |
| `/api/repos` | `POST` | Register a new repo (`{ "github_url": "..." }`), clones & indexes it |
| `/api/repos/:id/reindex` | `POST` | Trigger a fresh embedding re-index of an existing repo |
| `/api/repos/:id/search` | `GET` | Proxy vector search queries (`?q=...&k=5`) to pgvector |
| `/api/jobs` | `GET` | List recent issue resolution jobs and their status |
| `/api/jobs/:id` | `GET` | Fetch metadata and completed agent logs for a specific job |
| `/api/jobs/:id/stream` | `GET` | Server-Sent Events (SSE) live streaming logs for active agent jobs |
| `/api/webhook/:repo_id` | `POST` | Secure HMAC-verified webhook endpoint for GitHub issue & comment events |

---

## 💬 Mention Triggers & Bot Revisions

DevMind listens for issues as well as comment mentions to enable iterative workflows:

- **Issue Opened**: Automatically triggers index matching, planning, code generation, and PR creation.
- **PR / Issue Comments**: Mention `@devmind` or `/devmind` with your review feedback:
  ```markdown
  @devmind please update the test cases to cover edge conditions when the payload is empty.
  ```
  DevMind will checkout the working branch, pass previous diffs and human feedback to the Planner and Coder, and push revised commits directly to the PR branch.

---

## 🔒 Safety & Best Practices

- **Zero Unattended Merges**: DevMind only creates branches and pull requests. Merging always requires human review and confirmation.
- **HMAC Webhook Verification**: All GitHub events are checked against `x-hub-signature-256` using constant-time cryptographic verification on raw request buffers.
- **Bot Loop Protection**: Automated comments posted by DevMind carry signatures to prevent infinite recursive feedback loops.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
