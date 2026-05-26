import { Router } from "express";
import { pool } from "../db.js";

export const dashboardRouter = Router();

// ── GET /api/dashboard/stats ──────────────────────────────────────────────────
dashboardRouter.get("/stats", async (_req, res) => {
  try {
    const [totals, latency, errors, tokens, byProvider] = await Promise.all([

      pool.query(`
        SELECT
          COUNT(*)::int                                                  AS total_requests,
          COUNT(*) FILTER (WHERE status = 'success')::int               AS successful,
          COUNT(*) FILTER (WHERE status = 'error')::int                 AS failed,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int             AS cancelled
        FROM inference_logs
      `),

      pool.query(`
        SELECT
          ROUND(AVG(latency_ms)::numeric, 2)                                                        AS avg_latency,
          PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY latency_ms)                                 AS p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)                                 AS p95,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)                                 AS p99,
          MAX(latency_ms)                                                                            AS max_latency,
          ROUND(AVG(ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL)::numeric, 2)                       AS avg_ttft,
          PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL) AS ttft_p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL) AS ttft_p95
        FROM inference_logs
        WHERE status = 'success' AND latency_ms IS NOT NULL
      `),

      pool.query(`
        SELECT
          ROUND(
            COUNT(*) FILTER (WHERE status = 'error')::numeric
            / NULLIF(COUNT(*), 0) * 100, 2
          ) AS error_rate
        FROM inference_logs
      `),

      // Token totals + estimated cost via the view added in init.sql
      pool.query(`
        SELECT
          SUM(total_tokens)::int                         AS total_tokens,
          ROUND(AVG(total_tokens)::numeric, 2)           AS avg_tokens_per_request,
          ROUND(SUM(estimated_cost_usd)::numeric, 6)     AS estimated_cost_usd
        FROM inference_logs_with_cost
        WHERE status = 'success'
      `),

      // Per-provider/model breakdown
      pool.query(`
        SELECT
          il.provider,
          il.model,
          COUNT(*)::int                                                         AS requests,
          ROUND(AVG(il.latency_ms)::numeric, 2)                                AS avg_latency,
          ROUND(AVG(il.ttft_ms) FILTER (WHERE il.ttft_ms IS NOT NULL)::numeric, 2) AS avg_ttft,
          SUM(il.total_tokens)::int                                             AS total_tokens,
          COUNT(*) FILTER (WHERE il.status = 'error')::int                     AS errors,
          ROUND(SUM(ilc.estimated_cost_usd)::numeric, 6)                       AS estimated_cost_usd
        FROM inference_logs il
        LEFT JOIN inference_logs_with_cost ilc ON ilc.id = il.id
        GROUP BY il.provider, il.model
        ORDER BY requests DESC
      `),
    ]);

    res.json({
      totals:      totals.rows[0],
      latency:     latency.rows[0],
      error_rate:  errors.rows[0].error_rate ?? "0.00",
      tokens:      tokens.rows[0],
      by_provider: byProvider.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/dashboard/throughput ─────────────────────────────────────────────
// Hourly buckets with success/error counts + latency + TTFT
dashboardRouter.get("/throughput", async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours || "24"), 168);
    const result = await pool.query(
      `SELECT
         date_trunc('hour', request_ts)                                           AS bucket,
         COUNT(*)::int                                                             AS total,
         COUNT(*) FILTER (WHERE status = 'success')::int                          AS success,
         COUNT(*) FILTER (WHERE status = 'error')::int                            AS error,
         ROUND(AVG(latency_ms)::numeric, 2)                                       AS avg_latency,
         ROUND(AVG(ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL)::numeric, 2)       AS avg_ttft
       FROM inference_logs
       WHERE request_ts >= NOW() - INTERVAL '1 hour' * $1
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [hours]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/dashboard/logs ───────────────────────────────────────────────────
// Recent logs enriched with estimated cost from the view
dashboardRouter.get("/logs", async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const result = await pool.query(
      `SELECT ilc.*, c.title AS conversation_title
       FROM inference_logs_with_cost ilc
       LEFT JOIN conversations c ON c.id = ilc.conversation_id
       ORDER BY ilc.request_ts DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});
