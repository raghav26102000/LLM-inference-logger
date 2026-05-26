# LLM Inference Logger

A full-stack inference logging and ingestion system for LLM applications.

## Quick Start (Docker — one command)

```bash
cp .env.example .env
# Fill in your API keys in .env
docker-compose up --build
```

- **Frontend / Chatbot**: http://localhost:3000
- **Ingestion API**: http://localhost:4000
- **Health check**: http://localhost:4000/health

## Manual Setup (Development)

### Requirements
- Node.js 20+
- PostgreSQL 16
- Redis 7

### Ingestion Service

```bash
cd backend/ingestion
npm install

# Set env vars
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inference_logs
export REDIS_URL=redis://localhost:6379

# Init DB
psql -U postgres -d inference_logs -f ../../scripts/init.sql

npm start          # production
npm run dev        # watch mode
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Add API keys under **Settings** in the UI (stored in localStorage only).

---

## Architecture Overview

```
Browser (React + Vite)
  ├── SDK wrapper (src/lib/sdk.js)
  │     ├── Calls Anthropic / OpenAI streaming APIs directly
  │     └── Fires logs to Ingestion service (async, non-blocking)
  │
  └── UI pages
        ├── Chat      — streaming multi-turn chatbot
        ├── Conversations — list / resume / cancel
        ├── Dashboard — latency, throughput, error charts (SSE live)
        └── Settings  — API key management

Ingestion Service (Express.js — port 4000)
  ├── POST /api/ingest        — receives SDK logs
  ├── GET  /api/conversations — list / get / cancel / delete
  ├── GET  /api/dashboard/*   — analytics queries
  └── GET  /api/events        — SSE stream (Redis pub/sub)

PostgreSQL 16
  ├── conversations
  ├── messages (PII-redacted)
  └── inference_logs

Redis 7
  └── inference_events channel (pub/sub for SSE)
```

### Ingestion Flow

1. User sends a message → SDK calls LLM API with streaming
2. SDK yields token chunks to the UI in real time
3. On completion (or error), SDK POSTs a batch payload `{ logs, messages, conversations }` to `/api/ingest`
4. Ingestion service validates (Zod), runs PII redaction, writes to Postgres in a single transaction
5. Publishes an event to Redis → SSE clients (Dashboard) get a live update

### Logging Strategy

- **Non-blocking**: All log writes are fire-and-forget. A logging failure never interrupts the chat.
- **Batch writes**: Each LLM call produces one DB transaction (conversation upsert + message insert + log insert).
- **Preview only**: `input_preview` and `output_preview` store max 200 chars — avoids bloating the logs table with full conversation text (full text lives in `messages`).

### Schema Design Decisions

| Decision | Rationale |
|---|---|
| UUID PKs | Safe for distributed generation; no coordination needed |
| Separate `messages` table | Clean separation of chat history vs inference metadata |
| `pii_redacted` flag | Audit trail — know which messages were touched |
| `raw_content` nullable | Store original only when PII was found, saves space |
| JSONB `metadata` on logs | Flexible bag for future provider-specific fields |
| Indexes on `request_ts`, `provider`, `status` | Dashboard queries filter/sort by all three |

### PII Redaction

Applied at ingest time before DB write. Patterns redacted: emails, phone numbers, credit cards, SSNs, IP addresses, API keys/tokens (long alphanumeric strings).

---

## Bonus Features Completed

- **Multi-provider support** — Anthropic and OpenAI, switchable per conversation
- **Streaming responses** — true token-by-token streaming via SSE/fetch
- **Latency + Throughput + Errors dashboards** — live charts, p50/p95/p99 latency
- **Docker Compose one-command setup** — `docker-compose up --build`
- **Event-based architecture** — Redis pub/sub → SSE for live dashboard updates
- **PII redaction** — regex-based, applied before DB storage
- **Cancel a conversation** — via UI and API (`PATCH /api/conversations/:id/cancel`)
- **List conversations** — filterable by status (active / cancelled)
- **Resume a conversation** — click any conversation to reload its history and continue

---

## Scaling Considerations

- **Ingestion service** is stateless — horizontally scalable behind a load balancer
- **Redis** can be replaced with Kafka/SQS for higher throughput event pipelines
- **Postgres** write bottleneck at scale → batch inserts or async write queues (BullMQ)
- **SSE** connections are per-server; at scale use a shared Redis channel with multiple ingestion replicas
- **Log retention** — add a cron job to archive/delete old `inference_logs` rows

## Tradeoffs Made

- **Browser-direct LLM calls** — simpler setup (no backend proxy needed), but exposes API keys to the browser. For production: proxy calls through the backend.
- **Regex PII redaction** — fast and dependency-free, but not comprehensive. Production would use a dedicated PII service (e.g. AWS Comprehend, Microsoft Presidio).
- **SQLite not used** — Postgres chosen for JSONB, window functions, and production readiness.
- **No auth** — out of scope; add JWT middleware to the ingestion service for production.

## What I'd Improve With More Time

- Backend proxy for LLM calls (remove browser API key exposure)
- Microsoft Presidio for comprehensive PII detection
- BullMQ async write queue to decouple ingestion latency from LLM latency
- Token cost tracking per provider (price per 1K tokens)
- Conversation search / full-text
- Export logs as CSV
- Kubernetes manifests (Helm chart)
- E2E tests with Playwright

---

## Submission

Send to: work@ollive.ai
