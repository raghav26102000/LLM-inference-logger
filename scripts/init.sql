-- ============================================================
-- LLM Inference Logger — Schema (enhanced)
-- Changes vs original:
--   1. ttft_ms column on inference_logs (time-to-first-token)
--   2. token_costs lookup table with pricing seeds
--   3. inference_logs_with_cost view (join + estimated cost calc)
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT,
  provider   TEXT NOT NULL DEFAULT 'unknown',
  model      TEXT NOT NULL DEFAULT 'unknown',
  status     TEXT NOT NULL DEFAULT 'active',   -- active | cancelled | archived
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,       -- PII-redacted
  raw_content     TEXT,                -- original, only stored when PII was found
  pii_redacted    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inference_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id        UUID REFERENCES messages(id) ON DELETE SET NULL,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  latency_ms        INTEGER,     -- total wall-clock ms (request → last token)
  ttft_ms           INTEGER,     -- time-to-first-token (ms)  ← NEW
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,
  status            TEXT NOT NULL DEFAULT 'success',  -- success | error | cancelled
  error_message     TEXT,
  request_ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_ts       TIMESTAMPTZ,
  input_preview     TEXT,        -- first 200 chars of user message
  output_preview    TEXT,        -- first 200 chars of assistant reply
  metadata          JSONB NOT NULL DEFAULT '{}'
);

-- Migration safety: add ttft_ms to existing tables if this script is re-run
ALTER TABLE inference_logs ADD COLUMN IF NOT EXISTS ttft_ms INTEGER;

-- ── Token cost lookup ─────────────────────────────────────────────────────────
-- Prices per 1,000,000 tokens (USD). Update when provider pricing changes.
CREATE TABLE IF NOT EXISTS token_costs (
  id                     SERIAL PRIMARY KEY,
  provider               TEXT NOT NULL,
  model                  TEXT NOT NULL,
  cost_usd_per_1m_input  NUMERIC(10,4) NOT NULL DEFAULT 0,
  cost_usd_per_1m_output NUMERIC(10,4) NOT NULL DEFAULT 0,
  effective_from         DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (provider, model, effective_from)
);

-- Seed pricing (USD, May 2025 — update as needed)
INSERT INTO token_costs (provider, model, cost_usd_per_1m_input, cost_usd_per_1m_output) VALUES
  ('anthropic', 'claude-sonnet-4-20250514',  3.0000, 15.0000),
  ('anthropic', 'claude-haiku-4-5-20251001', 0.8000,  4.0000),
  ('openai',    'gpt-4o',                    2.5000, 10.0000),
  ('openai',    'gpt-4o-mini',               0.1500,  0.6000),
  ('openai',    'gpt-4.1',                   2.0000,  8.0000),
  ('groq',      'llama-3.3-70b-versatile',   0.0590,  0.0790),
  ('groq',      'llama-3.1-8b-instant',      0.0500,  0.0800),
  ('groq',      'mixtral-8x7b-32768',        0.2700,  0.2700),
  ('deepseek',  'deepseek-chat',             0.1400,  0.2800),
  ('deepseek',  'deepseek-reasoner',         0.5500,  2.1900),
  ('gemini',    'gemini-2.0-flash',          0.1000,  0.4000),
  ('gemini',    'gemini-1.5-flash',          0.0750,  0.3000),
  ('gemini',    'gemini-1.5-pro',            1.2500,  5.0000)
ON CONFLICT DO NOTHING;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inference_logs_conversation ON inference_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_inference_logs_request_ts   ON inference_logs(request_ts DESC);
CREATE INDEX IF NOT EXISTS idx_inference_logs_provider     ON inference_logs(provider);
CREATE INDEX IF NOT EXISTS idx_inference_logs_status       ON inference_logs(status);
CREATE INDEX IF NOT EXISTS idx_inference_logs_model        ON inference_logs(model);
CREATE INDEX IF NOT EXISTS idx_messages_conversation       ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status        ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_updated       ON conversations(updated_at DESC);

-- ── View: logs enriched with estimated cost ───────────────────────────────────
-- Used by dashboard.js GET /api/dashboard/logs and /stats
CREATE OR REPLACE VIEW inference_logs_with_cost AS
SELECT
  il.*,
  tc.cost_usd_per_1m_input,
  tc.cost_usd_per_1m_output,
  ROUND(
    COALESCE(il.prompt_tokens,     0) * COALESCE(tc.cost_usd_per_1m_input,  0) / 1000000.0
  + COALESCE(il.completion_tokens, 0) * COALESCE(tc.cost_usd_per_1m_output, 0) / 1000000.0,
    8
  ) AS estimated_cost_usd
FROM inference_logs il
LEFT JOIN token_costs tc
  ON  tc.provider = il.provider
  AND tc.model    = il.model
  AND tc.effective_from = (
        SELECT MAX(effective_from)
        FROM token_costs
        WHERE provider       = il.provider
          AND model          = il.model
          AND effective_from <= il.request_ts::date
      );
