import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { redisClient } from "../index.js";
import { redactPii } from "../pii.js";

export const ingestRouter = Router();

const InferenceLogSchema = z.object({
  conversation_id:  z.string().uuid().optional().nullable(),
  message_id:       z.string().uuid().optional().nullable(),
  provider:         z.string().min(1),
  model:            z.string().min(1),
  latency_ms:       z.number().nonnegative().optional().nullable(),
  ttft_ms:          z.number().nonnegative().optional().nullable(),  // NEW: time-to-first-token
  prompt_tokens:    z.number().nonnegative().optional().nullable(),
  completion_tokens: z.number().nonnegative().optional().nullable(),
  total_tokens:     z.number().nonnegative().optional().nullable(),
  status:           z.enum(["success", "error", "cancelled"]).default("success"),
  error_message:    z.string().optional().nullable(),
  request_ts:       z.string().optional().nullable(),
  response_ts:      z.string().optional().nullable(),
  input_preview:    z.string().max(500).optional().nullable(),
  output_preview:   z.string().max(500).optional().nullable(),
  metadata:         z.record(z.unknown()).optional().default({}),
});

const MessageSchema = z.object({
  conversation_id: z.string().uuid(),
  role:            z.enum(["user", "assistant", "system"]),
  content:         z.string().min(1),
});

const ConversationSchema = z.object({
  id:       z.string().uuid().optional().nullable(),
  title:    z.string().optional().nullable(),
  provider: z.string().default("unknown"),
  model:    z.string().default("unknown"),
  status:   z.enum(["active", "cancelled", "archived"]).default("active"),
});

ingestRouter.post("/", async (req, res) => {
  const { logs = [], messages = [], conversations = [] } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const raw of conversations) {
      const conv = ConversationSchema.parse(raw);
      await client.query(
        `INSERT INTO conversations (id, title, provider, model, status)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET title = EXCLUDED.title,
               provider = EXCLUDED.provider,
               model = EXCLUDED.model,
               status = EXCLUDED.status,
               updated_at = NOW()`,
        [conv.id || null, conv.title || null, conv.provider, conv.model, conv.status]
      );
    }

    // Ensure ghost conversations exist for any conversation_id referenced in
    // messages or logs that wasn't explicitly sent in the conversations array.
    const referencedConvIds = [...new Set([
      ...messages.map((m) => m.conversation_id),
      ...logs.map((l) => l.conversation_id),
    ].filter(Boolean))];

    for (const cid of referencedConvIds) {
      await client.query(
        `INSERT INTO conversations (id, provider, model, status)
         VALUES ($1, 'unknown', 'unknown', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [cid]
      );
    }

    const insertedMessages = [];
    for (const raw of messages) {
      const msg = MessageSchema.parse(raw);
      const { redacted, hadPii } = redactPii(msg.content);
      const result = await client.query(
        `INSERT INTO messages (conversation_id, role, content, raw_content, pii_redacted)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [msg.conversation_id, msg.role, redacted, hadPii ? msg.content : null, hadPii]
      );
      insertedMessages.push(result.rows[0].id);
      await client.query(
        "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
        [msg.conversation_id]
      );
    }

    const insertedLogs = [];
    for (const raw of logs) {
      const parsed = InferenceLogSchema.parse(raw);
      const result = await client.query(
        `INSERT INTO inference_logs
           (conversation_id, message_id, provider, model, latency_ms, ttft_ms,
            prompt_tokens, completion_tokens, total_tokens, status,
            error_message, request_ts, response_ts, input_preview, output_preview, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          parsed.conversation_id   || null,
          parsed.message_id        || null,
          parsed.provider,
          parsed.model,
          parsed.latency_ms        != null ? Math.round(parsed.latency_ms)        : null,
          parsed.ttft_ms           != null ? Math.round(parsed.ttft_ms)           : null,
          parsed.prompt_tokens     != null ? Math.round(parsed.prompt_tokens)     : null,
          parsed.completion_tokens != null ? Math.round(parsed.completion_tokens) : null,
          parsed.total_tokens      != null ? Math.round(parsed.total_tokens)      : null,
          parsed.status,
          parsed.error_message     || null,
          parsed.request_ts        || null,
          parsed.response_ts       || null,
          parsed.input_preview     ? parsed.input_preview.slice(0, 200)  : null,
          parsed.output_preview    ? parsed.output_preview.slice(0, 200) : null,
          JSON.stringify(parsed.metadata),
        ]
      );
      insertedLogs.push(result.rows[0].id);
    }

    await client.query("COMMIT");

    if (redisClient?.isReady && insertedLogs.length > 0) {
      redisClient.publish(
        "inference_events",
        JSON.stringify({ type: "new_logs", count: insertedLogs.length, ts: new Date().toISOString() })
      ).catch(() => {});
    }

    res.json({ ok: true, inserted: { logs: insertedLogs.length, messages: insertedMessages.length } });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof z.ZodError) {
      console.error("Validation error:", JSON.stringify(err.errors, null, 2));
      return res.status(400).json({ ok: false, error: "Validation failed", details: err.errors });
    }
    console.error("Ingest error:", err.message);
    res.status(500).json({ ok: false, error: "Internal error", detail: err.message });
  } finally {
    client.release();
  }
});
