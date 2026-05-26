# Architecture Notes

## Ingestion Flow
Browser → SDK (proxy call) → Express proxy route → LLM provider
                           → /api/ingest → Zod validation → PostgreSQL
                           → Redis pub/sub → SSE → Live dashboard

## Logging Strategy
- Fire-and-forget from SDK — never blocks chat UX
- PII redacted at ingest time before DB write
- Batch insert: conversations + messages + inference_logs in one transaction
- ttft_ms (time-to-first-token) captured on first streamed chunk

## Scaling Considerations
- Ingestion service is stateless — scale horizontally freely
- Redis pub/sub keeps SSE consistent across replicas
- PostgreSQL is single-replica with PVC; replace with CloudNativePG for HA
- HPA configured for ingestion (2–8 replicas based on CPU)
- Rate limiting: 60 req/min ingest, 120 req/min proxy (in-process)

## Failure Handling
- SDK uses fire-and-forget for logging — LLM failure ≠ log failure
- initContainers on k8s wait for Postgres/Redis before app starts
- Redis is optional — app degrades gracefully without it
- All DB writes wrapped in transactions with ROLLBACK on error
- Cancelled streams still log with status="cancelled" in finally block