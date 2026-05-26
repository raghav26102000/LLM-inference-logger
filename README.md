# LLM Inference Logger

A production-grade inference logging and ingestion system for LLM applications — built as a full-stack assignment for Ollive.

## Demo

[![Watch Demo Video](https://img.shields.io/badge/▶%20Watch%20Demo-Google%20Drive-blue?style=for-the-badge&logo=google-drive)](https://drive.google.com/file/d/1Pcn_rA0dwNGah-FA-9Q7gUcLZ3inMmKd/view?usp=drive_link)

> Multi-provider streaming chat, real-time inference dashboard, conversation history, resume/cancel flows, and Kubernetes deployment walkthrough.

---

## Quick Start (Docker — one command)

```bash
cp .env.example .env
# Fill in at least one provider API key in .env
docker-compose up --build
```

| Service | URL |
|---|---|
| Chatbot UI | http://localhost:3000 |
| Ingestion API | http://localhost:4000 |
| Health check | http://localhost:4000/health |

---

## Manual Setup (Development)

**Requirements:** Node.js 20+, PostgreSQL 16, Redis 7

### Backend

```bash
cd backend/ingestion
npm install

export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inference_logs
export REDIS_URL=redis://localhost:6379
export GROQ_API_KEY=gsk_...        # add whichever keys you have

psql -U postgres -d inference_logs -f ../../scripts/init.sql
npm start
```

### Frontend

```bash
cd frontend
npm install
npm run dev    # http://localhost:3000
```

---

## Architecture Overview

```
Browser (React + Vite + Framer Motion)
  └── SDK wrapper (frontend/src/lib/sdk.js)
        ├── Calls /api/proxy/chat  →  backend streams LLM response back
        └── Fires logs to /api/ingest (async, non-blocking, fire-and-forget)

Ingestion / Proxy Service (Express.js — port 4000)
  ├── GET  /api/proxy/providers     — which providers are configured
  ├── POST /api/proxy/chat          — server-side LLM proxy (keys never in browser)
  ├── POST /api/ingest              — receives SDK logs (rate limited: 60 req/min)
  ├── GET  /api/conversations       — list / get / cancel / delete
  ├── GET  /api/dashboard/stats     — aggregated metrics with cost estimates
  ├── GET  /api/dashboard/throughput— hourly bucketed request data
  ├── GET  /api/dashboard/logs      — recent inference logs with cost
  └── GET  /api/events              — SSE stream (Redis pub/sub → live dashboard)

PostgreSQL 16
  ├── conversations
  ├── messages           (PII-redacted, raw_content stored only when PII found)
  ├── inference_logs     (latency_ms, ttft_ms, tokens, status, previews)
  ├── token_costs        (pricing lookup per provider/model)
  └── inference_logs_with_cost  (view — joins logs + costs for estimated USD)

Redis 7
  └── inference_events channel  (pub/sub → SSE → live dashboard updates)
```

### Ingestion Flow

```
User message
  → SDK calls /api/proxy/chat (POST)
  → Express proxy forwards to provider (Anthropic / OpenAI / Groq / DeepSeek / Gemini)
  → Provider streams tokens back via SSE
  → SDK yields chunks to React UI in real time
  → TTFT captured on first chunk arrival
  → On stream end: SDK POSTs { logs, messages, conversations } to /api/ingest
  → Ingest: Zod validation → PII redaction → Postgres transaction
  → Redis publish → SSE clients (Dashboard) receive live update
```

### Logging Strategy

- **Non-blocking** — all log writes are fire-and-forget; a logging failure never interrupts chat
- **Batch writes** — one DB transaction per LLM call (conversation upsert + message insert + log insert)
- **TTFT captured** — time-to-first-token measured in the SDK on the first streamed chunk
- **Preview only** — `input_preview` / `output_preview` store max 200 chars; full text lives in `messages`
- **Cost estimation** — `token_costs` table seeded with per-model pricing; `inference_logs_with_cost` view computes estimated USD per request

---

## Schema Design Decisions

| Decision | Rationale |
|---|---|
| UUID PKs | Safe for distributed generation with no coordination |
| Separate `messages` table | Clean separation of chat history vs inference metadata |
| `pii_redacted` flag + nullable `raw_content` | Audit trail; original stored only when PII found — saves space |
| `ttft_ms` column | Most meaningful latency metric for streaming UX |
| `token_costs` lookup table | Decouples pricing from code; update via SQL when providers change rates |
| `inference_logs_with_cost` view | Cost calculation in the DB layer — no application logic needed |
| JSONB `metadata` on logs | Flexible bag for future provider-specific fields |
| Indexes on `request_ts`, `provider`, `status`, `model` | Dashboard queries filter/sort by all four |

### PII Redaction

Applied at ingest time before any DB write. Patterns: emails, phone numbers, credit cards, SSNs, IPv4 addresses, and API keys/tokens matched by known prefixes (`sk-`, `sk-ant-`, `gsk_`, `AIzaSy`, `ghp_`, `xoxb-`, `Bearer`). Prefix matching avoids false positives on UUIDs and normal long strings — a bug in the original implementation that was fixed.

---

## Bonus Features

| Feature | Status |
|---|---|
| Multi-provider support (5 providers) | ✅ Anthropic, OpenAI, Groq, DeepSeek, Gemini |
| Streaming responses | ✅ True token-by-token SSE streaming |
| Latency + Throughput + Errors dashboards | ✅ Live charts, p50/p95/p99, TTFT, error rate |
| Docker Compose one-command setup | ✅ `docker-compose up --build` |
| Event-based architecture | ✅ Redis pub/sub → SSE live dashboard |
| PII redaction | ✅ Prefix-aware regex at ingest time |
| Cancel a conversation | ✅ UI button + `PATCH /api/conversations/:id/cancel` |
| List conversations | ✅ Filterable by status (active / cancelled) |
| Resume a conversation | ✅ Click any conversation to reload history and continue |
| Backend proxy (no browser key exposure) | ✅ All LLM calls go through `/api/proxy/chat` |
| Token cost tracking | ✅ Per-provider/model pricing table + cost view |
| TTFT measurement | ✅ Logged per inference call |
| Rate limiting | ✅ In-process sliding window (60/min ingest, 120/min proxy) |
| Self-hosted Kubernetes | ✅ Raw manifests (kustomize) + Helm chart + HPA + deploy script |

---

## Kubernetes Deployment

Full self-hosted k8s setup in `k8s/`:

```bash
# Raw manifests (kustomize)
kubectl apply -k k8s/overlays/prod

# Or Helm
helm install llm-logger ./k8s/helm/llm-logger \
  --namespace llm-logger --create-namespace \
  --set secrets.groqKey=gsk_... \
  --set ingestion.image.repository=your-registry/llm-ingestion \
  --set frontend.image.repository=your-registry/llm-frontend
```

Includes: Namespace, Deployments, Services, StatefulSet (Postgres), PVCs, Ingress (nginx), HPA (2–8 ingestion replicas), Secrets template.

---

## Scaling Considerations

- **Ingestion service** is fully stateless — scale horizontally behind a load balancer; Redis pub/sub keeps SSE consistent across replicas
- **HPA** configured for ingestion: scales 2→8 replicas at 70% CPU
- **Postgres** is single-replica with PVC; replace with CloudNativePG operator for HA
- **Redis** is single-replica; replace with Redis Sentinel or Redis Operator for HA
- **Rate limiting** is in-process (per replica); replace with Redis-backed rate limiter for consistent limits across replicas
- **Log retention** — add a cron job or pg_partman to archive/delete old `inference_logs` rows

## Tradeoffs Made

- **In-process rate limiting** — simple and dependency-free, but per-replica; a Redis-backed solution (e.g. `ioredis` + sliding window) would give consistent limits across all replicas
- **Regex PII redaction** — fast and zero-dependency, but not comprehensive; production would use Microsoft Presidio or AWS Comprehend
- **No auth** — out of scope for this assignment; add JWT middleware to the ingestion service for production
- **Single Postgres replica** — fine for this scale; CloudNativePG or Zalando Postgres Operator for HA

## What I'd Improve With More Time

- Microsoft Presidio for comprehensive, ML-backed PII detection
- BullMQ async write queue to fully decouple DB write latency from LLM latency
- Full-text search on messages (`tsvector` + `tsquery`)
- Conversation export as CSV / JSON
- E2E tests with Playwright
- CI/CD pipeline (GitHub Actions → build → push → `helm upgrade`)
- WebSocket support as an alternative to SSE for bi-directional use cases
