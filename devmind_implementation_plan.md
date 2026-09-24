# DevMind — Project Context & Implementation Plan

> This document is the single source of truth for the DevMind project.
> It captures the vision, mental model, design decisions, and implementation plan.
> Use this as context when working in Cursor.

---

## What Is DevMind?

DevMind is an **autonomous multi-agent platform** that watches GitHub repositories and automatically fixes issues by writing code and opening pull requests — without human intervention (until approval).

You point it at a GitHub repo. It reads and indexes the entire codebase. When someone opens an issue, a pipeline of AI agents wakes up, reads the relevant code, writes a fix, reviews it, and opens a PR. You review the PR and merge.

It runs entirely on your local machine (or a cheap VPS). No SaaS. No vendor lock-in. Fully yours.

---

## Why This Project?

This project was designed to implement every major concept in modern agentic AI engineering in one cohesive, real-world system:

| Concept | Where It Appears |
|---|---|
| **RAG (Retrieval-Augmented Generation)** | Codebase indexed into pgvector. Agents retrieve relevant files before acting. |
| **Tool Calling** | Agents call real tools: GitHub API, file reader, code executor |
| **Agentic Memory** | Short-term (conversation buffer), long-term (Redis), episodic (past fix patterns) |
| **Multi-Agent Systems** | 5 specialized agents: Orchestrator, RAG, Planner, Coder, Reviewer |
| **Agent Orchestration** | LangGraph state machine coordinates agents with conditional edges |
| **Reflection / Self-Critique** | Reviewer agent scores and loops back to Coder if quality is low |
| **Human-in-the-Loop** | Nothing merges without your approval |
| **Parallel Execution** | Multiple issues processed simultaneously via BullMQ worker pool |
| **Real-time Streaming** | Agent logs streamed live to UI via SSE |
| **Webhook-driven Architecture** | GitHub fires events → system reacts autonomously |

---

## Mental Model

### The Core Loop

```
Someone opens an issue on GitHub
    ↓
GitHub fires a webhook to our server
    ↓
Server publishes a job to BullMQ queue
    ↓
A worker picks up the job
    ↓
LangGraph pipeline runs:
    Orchestrator → RAG → Planner → Coder → Reviewer
    ↓
PR is opened. Comment posted on issue.
    ↓
You review and merge.
```

### Think of it like hiring a junior dev

- You file a bug report (GitHub issue)
- The dev reads the codebase to understand context (RAG Agent)
- The dev makes a plan (Planner Agent)
- The dev writes the fix (Coder Agent)
- A senior reviews it (Reviewer Agent)
- If bad → goes back to dev. If good → PR opened.
- You approve and merge.

The key difference: this "dev" works on 5 issues simultaneously, never sleeps, and gets better over time by remembering past fixes.

---

## Multi-Repo Design

A core design goal was: **one DevMind instance manages multiple repos.**

- You register repos via the UI by pasting a GitHub URL
- DevMind clones the repo, indexes it, and registers a webhook automatically
- Every repo gets its own isolated embedding space (filtered by `repo_id`)
- Issues from different repos are processed independently, in parallel
- No repo's context ever bleeds into another

```
Register https://github.com/manav/project-a  →  repo_id: abc
Register https://github.com/manav/project-b  →  repo_id: xyz

Issue on project-a  →  RAG search filtered to repo_id: abc only
Issue on project-b  →  RAG search filtered to repo_id: xyz only
```

---

## Concurrency Model

Every issue gets its own isolated LangGraph pipeline instance. They run in parallel.

```
BullMQ Worker Process (concurrency: 5)
│
├── Worker 1  →  Issue #12 on project-a  →  own LangGraph state
├── Worker 2  →  Issue #7  on project-b  →  own LangGraph state
├── Worker 3  →  Issue #15 on project-a  →  own LangGraph state
├── Worker 4  (idle)
└── Worker 5  (idle)
```

**What's isolated per issue:**
- LangGraph state (plan, diff, review score, logs)

**What's shared across all workers:**
- Postgres DB (different rows)
- Redis (different keys, namespaced by repo_id + job_id)
- Embeddings table (filtered by repo_id)
- Redis Agent Memory (shared knowledge base — agents learn from each other)
- LangCache (shared LLM response cache — saves tokens on similar issues)

**Conflict handling:**
If two issues on the same repo try to modify the same file simultaneously, a repo-level mutex in Redis prevents concurrent writes.

---

## Key Design Decisions & Why

### 1. BullMQ over Kafka
Kafka is for high-volume event streaming (millions/day). We're processing maybe 100 issues/day across 10 repos. BullMQ gives us job queues with retries, priority, delays, and concurrency — all we need. Kafka would add Zookeeper + broker complexity with zero benefit at our scale.

### 2. pgvector over Pinecone / Weaviate
We're already running Postgres for the repos/jobs DB. pgvector adds vector search to the same container. No new service, no new SDK, no extra cost. The `repo_id` filter makes searches fast and isolated.

### 3. Redis Iris Platform locally via redis-stack
Redis Iris is Redis's managed AI platform (Agent Memory, LangCache, Context Retriever). All of these features are available in the open-source `redis/redis-stack` Docker image. We use redis-stack locally and can swap to Redis Iris Cloud for production without changing code.

### 4. LangGraph over raw LLM calls
LangGraph gives us a proper state machine with typed state, conditional edges, and cycle detection. The Reviewer → Coder loop is a cycle. Without LangGraph, managing that loop, the shared state, and the logging would be error-prone custom code.

### 5. Deterministic-First approach
Agents use code for deterministic operations (git clone, file read, diff creation, webhook validation). LLMs are only called for natural language tasks (understanding issues, writing code, reviewing). This makes the system reliable — failures are in predictable places.

### 6. Monorepo with npm workspaces
Three apps (api, worker, ui) share types from a `packages/shared` package. This prevents type drift between the API's job schema and the Worker's job handler. All three run in their own Docker containers.

---

## The 5 Agents

### Orchestrator Agent
- Entry point for every job
- Checks Redis Agent Memory: "Has this type of issue been fixed before?"
- Routes to RAG with an enriched query (original issue + past context)
- After completion: writes the fix pattern to memory for future use
- Manages overall LangGraph state

### RAG Agent
- Embeds the issue description
- Runs cosine similarity search against `embeddings` table (filtered by repo_id)
- Optionally expands context: if a chunk is partial, fetch the full file
- Returns top-K relevant code chunks with file paths

### Planner Agent
- Given: issue body + relevant code context
- Outputs: structured fix plan
  - Which files to change
  - What specifically to change in each file
  - Why (reasoning)

### Coder Agent
- Reads each target file in full via GitHub API
- Generates patched version using LLM
- Creates a unified diff
- Has access to tools: `readFile`, `searchCode`, `writeFile`

### Reviewer Agent
- Reviews the generated diff
- Scores it 1–10
- Identifies: bugs, regressions, style issues, incomplete fixes
- If score < 7: sends feedback back to Coder (max 3 iterations)
- If score >= 7: approves → PR creation proceeds

---

## The Infrastructure Stack

### 3 Servers You Run

```
Server 1: Next.js (port 3000)    — Dashboard UI
Server 2: Express (port 8080)    — API + Webhook receiver
Server 3: Worker process         — BullMQ + LangGraph agents (no port)
```

### 2 Infrastructure Services (Dockerized)

```
Postgres + pgvector (port 5432)  — Repos, jobs, embeddings
Redis Stack (port 6379)          — Queue, agent memory, LLM cache
RedisInsight (port 8001)         — Visual debugger for Redis
```

### Everything in docker-compose

```
docker-compose up  →  all 6 services running
```

One command. Entire system boots.

---

## Webhook Flow (How GitHub triggers agents)

```
1. You register a repo → DevMind calls GitHub API to register a webhook
   pointing to: https://your-public-ip/api/webhook/{repo_id}

2. Someone opens an issue on that repo

3. GitHub sends HTTP POST to your webhook URL (within seconds)

4. Express validates the HMAC-SHA256 signature (security)

5. Express publishes job to BullMQ → returns 200 to GitHub immediately
   (GitHub needs a response within 10 seconds or it retries)

6. Worker picks up job asynchronously → pipeline runs

7. PR opened, comment posted, job marked done
```

For local development: ngrok exposes localhost:8080 with a public URL.
For production: deploy API to Railway/Render — it gets a public URL natively.

---

## Project Structure (Monorepo)

```
devmind/
├── docker-compose.yml
├── .env.example
├── package.json               (workspace root)
│
├── apps/
│   ├── api/                   (Express API Server)
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── repos.ts   (register, list repos)
│   │   │   │   ├── jobs.ts    (job status, logs)
│   │   │   │   └── webhook.ts (GitHub webhook receiver)
│   │   │   ├── services/
│   │   │   │   ├── github.ts  (GitHub API wrapper - Octokit)
│   │   │   │   ├── queue.ts   (BullMQ publisher)
│   │   │   │   └── repo.ts    (clone, register webhook)
│   │   │   └── db/
│   │   │       ├── client.ts  (Postgres connection)
│   │   │       └── schema.sql
│   │   └── package.json
│   │
│   ├── worker/                (BullMQ Worker + LangGraph Agents)
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── index.ts       (worker bootstrap - sets concurrency)
│   │   │   ├── queues/
│   │   │   │   ├── indexRepo.ts   (handles index-repo jobs)
│   │   │   │   └── fixIssue.ts    (handles fix-issue jobs)
│   │   │   ├── agents/
│   │   │   │   ├── orchestrator.ts
│   │   │   │   ├── ragAgent.ts
│   │   │   │   ├── plannerAgent.ts
│   │   │   │   ├── coderAgent.ts
│   │   │   │   └── reviewerAgent.ts
│   │   │   ├── graph/
│   │   │   │   └── pipeline.ts    (LangGraph state machine definition)
│   │   │   ├── tools/
│   │   │   │   ├── githubTools.ts (readFile, createPR, postComment)
│   │   │   │   ├── fileTools.ts   (local file ops)
│   │   │   │   └── searchTools.ts (RAG search wrapper)
│   │   │   ├── memory/
│   │   │   │   └── agentMemory.ts (Redis Agent Memory read/write)
│   │   │   └── rag/
│   │   │       ├── chunker.ts     (semantic + fixed chunking)
│   │   │       ├── embedder.ts    (OpenAI embedding calls)
│   │   │       └── retriever.ts   (pgvector cosine search)
│   │   └── package.json
│   │
│   └── ui/                    (Next.js 15 Dashboard)
│       ├── Dockerfile
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx          (Dashboard — stats + activity)
│       │   │   ├── repos/page.tsx    (Repo management)
│       │   │   └── jobs/page.tsx     (Job queue viewer)
│       │   └── components/
│       │       ├── RepoCard.tsx
│       │       ├── JobCard.tsx
│       │       └── AgentLogStream.tsx (SSE real-time logs)
│       └── package.json
│
└── packages/
    └── shared/                (shared TypeScript types)
        ├── types.ts           (Repo, Job, AgentLog, GraphState types)
        └── package.json
```

---

## Implementation Plan

### Phase 1 — Scaffold & Infrastructure
**Goal:** Everything boots with `docker-compose up`. No app logic yet.
**Time: ~3–4 hours**

- [ ] Init monorepo with npm workspaces
- [ ] Create `docker-compose.yml` with all 6 services
- [ ] Write `schema.sql` with 3 tables + pgvector extension + index
- [ ] Create Dockerfiles for api, worker, ui
- [ ] Create `.env.example` with all required keys
- [ ] Confirm `docker-compose up` starts all containers healthy

**schema.sql:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_url TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  clone_path TEXT,
  webhook_id TEXT,
  status TEXT DEFAULT 'pending',  -- pending | indexing | ready | error
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id),
  issue_number INTEGER NOT NULL,
  issue_title TEXT,
  issue_body TEXT,
  status TEXT DEFAULT 'queued',   -- queued | running | done | failed
  pr_url TEXT,
  agent_logs JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repos(id),
  file_path TEXT NOT NULL,
  chunk_index INTEGER,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops);
```

**✅ Done when:** `docker-compose up` runs, schema tables exist, RedisInsight loads at localhost:8001

---

### Phase 2 — API Server + Queue Publisher
**Goal:** Register a repo via API. Webhook fires → job published to BullMQ.
**Time: ~4–5 hours**

- [ ] Setup Express + TypeScript + nodemon
- [ ] Setup BullMQ queue connection to Redis
- [ ] Setup Postgres client (pg / postgres.js)
- [ ] **POST /api/repos** — Register a repo
  - Validate GitHub URL
  - Clone repo locally using `simple-git`
  - Register GitHub webhook via Octokit
  - Save to `repos` table
  - Publish `index-repo` job to BullMQ
- [ ] **GET /api/repos** — List repos + status
- [ ] **POST /api/webhook/:repo_id** — GitHub webhook receiver
  - Validate HMAC-SHA256 signature
  - On `issues.opened` → publish `fix-issue` job
  - Return 200 immediately
- [ ] **GET /api/jobs** — List all jobs
- [ ] **GET /api/jobs/:id** — Job details + agent logs

**✅ Done when:** POST a GitHub URL → repo cloned → webhook registered on GitHub → opening issue → job visible in RedisInsight queue

---

### Phase 3 — RAG Indexer
**Goal:** Worker indexes a cloned repo. Natural language search over codebase works.
**Time: ~5–6 hours**

- [ ] Setup BullMQ worker process with `concurrency: 5`
- [ ] **index-repo job handler:**
  - Walk all files in cloned repo (skip `node_modules`, `.git`, `dist`, `build`)
  - Filter to code files: `.ts`, `.js`, `.py`, `.go`, `.java`, `.md`, `.json`
  - Chunk files: semantic chunking by function/class, fallback to 512-token fixed chunks with 50-token overlap
  - Embed chunks using `text-embedding-3-small` in batches of 100
  - Bulk insert into `embeddings` table
  - Update `repos.status = 'ready'`
- [ ] **retriever.ts** — RAG search:
  ```ts
  async function retrieveContext(query: string, repoId: string, topK = 5) {
    const queryEmbedding = await embed(query)
    return db.query(`
      SELECT file_path, chunk_text,
             1 - (embedding <=> $1) AS similarity
      FROM embeddings
      WHERE repo_id = $2
      ORDER BY embedding <=> $1
      LIMIT $3
    `, [queryEmbedding, repoId, topK])
  }
  ```

**✅ Done when:** Register a repo → all files indexed (check row count in embeddings table) → running `retrieveContext("where is auth handled?", repoId)` returns correct files

---

### Phase 4 — Agent Pipeline (LangGraph)
**Goal:** Full agent pipeline processes a real issue and opens a PR.
**Time: ~8–10 hours**

#### 4a — LangGraph State + Graph Definition

```ts
// Shared state across all agents
interface GraphState {
  repoId: string
  issueNumber: number
  issueTitle: string
  issueBody: string
  pastMemory: string           // from Redis Agent Memory
  retrievedContext: CodeChunk[]
  plan: string
  targetFiles: string[]
  codeDiffs: FileDiff[]
  reviewScore: number
  reviewFeedback: string
  iterationCount: number       // max 3 to prevent infinite loops
  prUrl: string
  agentLogs: LogEntry[]
}
```

Graph topology:
```
START
  → orchestratorAgent    (enriches query with memory)
  → ragAgent             (retrieves relevant code)
  → plannerAgent         (writes fix plan)
  → coderAgent           (writes code diff)
  → reviewerAgent        (scores + feedback)
       │
       ├── score >= 7  → createPR → postComment → saveMemory → END
       └── score < 7   → coderAgent (loop, max 3 times)
```

#### 4b — Individual Agents

- [ ] **Orchestrator** — check Redis memory, enrich context, finalize to memory
- [ ] **RAG Agent** — embed issue, cosine search, expand partial chunks
- [ ] **Planner Agent** — structured output: files + changes + reasoning
- [ ] **Coder Agent** — readFile via GitHub API, LLM patch, generate diff
- [ ] **Reviewer Agent** — score diff, provide feedback, conditional routing

#### 4c — Tools

- [ ] `readFileContent(owner, repo, path)` — GitHub API
- [ ] `createPullRequest(owner, repo, diff, issueNumber)` — GitHub API
- [ ] `postIssueComment(owner, repo, issueNumber, body)` — GitHub API
- [ ] `searchCodebase(query, repoId)` — wraps retriever.ts

#### 4d — Agent Memory

- [ ] On job start: `GET agent:memory:{repoId}:patterns` from Redis
- [ ] Inject as context: "Previously, similar auth issues were fixed by..."
- [ ] On job complete: `SET agent:memory:{repoId}:patterns` with new pattern

**✅ Done when:** Open a real GitHub issue → worker logs show all 5 agents running → PR opened with correct code change → comment on issue with PR link

---

### Phase 5 — Next.js Dashboard
**Goal:** Visual UI to manage everything.
**Time: ~5–6 hours**

- [ ] Setup Next.js 15 + App Router + TypeScript
- [ ] **`/` Dashboard** — stats cards (repos, active jobs, PRs created), recent activity
- [ ] **`/repos`** — list repos with status badges, "Add Repo" form
- [ ] **`/jobs`** — job table with status, issue title, PR link
- [ ] **Job detail** — click to expand, see each agent's log steps
- [ ] **SSE streaming** — live agent logs as job runs
  - API exposes `GET /api/jobs/:id/stream` (SSE endpoint)
  - Worker appends to `jobs.agent_logs` in real-time
  - UI shows: `[RAG] Found 5 relevant chunks in auth.service.ts...`
- [ ] **Approve PR button** — opens GitHub PR URL in new tab

**✅ Done when:** Can do full flow from UI: register repo → watch indexing → see job appear when issue opened → watch live logs → click through to PR

---

### Phase 6 — Polish & Production
**Goal:** Harden the system. Make it deployable.
**Time: ~4–5 hours**

- [ ] Repo-level mutex (Redis `SET NX` lock) — prevent concurrent file edits
- [ ] Webhook signature validation (HMAC-SHA256)
- [ ] Rate limiting — max N issues/hour per repo
- [ ] Re-indexing on `push` events — only re-embed changed files
- [ ] Graceful error handling — job fails → error logged → issue commented
- [ ] ngrok → Railway/Render deployment
- [ ] README with setup guide, architecture diagram
- [ ] Environment configs for local vs production

---

## Build Timeline

```
Week 1:  Phase 1 + 2  →  Infrastructure + API + Queue working
Week 2:  Phase 3      →  RAG indexer working, codebase searchable
Week 3:  Phase 4      →  Agent pipeline running, real PRs created
Week 4:  Phase 5 + 6  →  Dashboard + polish + deploy
```

---

## Environment Variables

```env
# GitHub
GITHUB_TOKEN=ghp_...              # Personal access token (repo + webhook scope)
GITHUB_WEBHOOK_SECRET=...         # Random string, must match what you set on GitHub

# LLM + Embeddings
OPENAI_API_KEY=sk-...

# Database
DATABASE_URL=postgresql://admin:secret@localhost:5432/devmind

# Redis
REDIS_URL=redis://localhost:6379

# API Config
PORT=8080
REPOS_BASE_PATH=./repos           # Where cloned repos are stored

# Worker Config
WORKER_CONCURRENCY=5              # How many issues to process simultaneously
MAX_REVIEW_ITERATIONS=3           # Max Coder→Reviewer loops before forcing PR
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Monorepo | npm workspaces | Share types across api/worker/ui |
| API | Node.js + Express + TypeScript | Fast, familiar, lightweight |
| Worker | Node.js + BullMQ | Job queues, concurrency, retries built-in |
| Agent Framework | LangGraph.js | State machine for multi-agent pipelines |
| LLM | OpenAI GPT-4o | Best code understanding + generation |
| Embeddings | OpenAI text-embedding-3-small | Fast, cheap, 1536-dim vectors |
| Vector DB | Postgres + pgvector | Same DB as everything else, no new service |
| Queue backend | Redis (redis-stack) | BullMQ storage |
| Agent Memory | Redis (redis-stack JSON) | Fast key-value memory per repo |
| LLM Cache | Redis (semantic cache) | Dedup similar LLM calls → save tokens |
| Frontend | Next.js 15 + App Router | SSE support, React Server Components |
| Git Operations | simple-git (npm) | Clone repos, read file history |
| GitHub Integration | Octokit (GitHub SDK) | API calls, webhook registration |
| Containerization | Docker + docker-compose | One command local setup |
| Tunneling (dev) | ngrok | Expose localhost to GitHub webhooks |
| Deployment | Railway / Render | Free tier, GitHub integration |
