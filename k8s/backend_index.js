import express from "express";
import cors from "cors";
import { createClient } from "redis";
import { pool } from "./db.js";
import { ingestRouter } from "./routes/ingest.js";
import { conversationsRouter } from "./routes/conversations.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { proxyRouter } from "./routes/proxy.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ── In-process rate limiter (no extra dependency) ─────────────────────────────
// Sliding window per IP. Limits: 60/min on /api/ingest, 120/min on /api/proxy
const _rlWindows = new Map();

function rateLimit(maxPerMinute) {
  return (req, res, next) => {
    const ip  = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const win = 60_000;
    const ts  = (_rlWindows.get(key) || []).filter((t) => now - t < win);

    if (ts.length >= maxPerMinute) {
      return res.status(429).json({
        error: "Too many requests — slow down.",
        retryAfterMs: win - (now - ts[0]),
      });
    }
    ts.push(now);
    _rlWindows.set(key, ts);

    // Periodic cleanup to avoid unbounded map growth
    if (Math.random() < 0.01) {
      for (const [k, v] of _rlWindows.entries()) {
        if (v.every((t) => now - t > win)) _rlWindows.delete(k);
      }
    }
    next();
  };
}

// ── Redis — optional, silently disabled if unavailable ────────────────────────
export let redisClient = null;
try {
  const client = createClient({
    // Reads REDIS_URL from environment (set in docker-compose / k8s ConfigMap).
    // Falls back to localhost for plain `npm start` development.
    url: process.env.REDIS_URL || "redis://localhost:6379",
    socket: { reconnectStrategy: false, connectTimeout: 2000 },
  });
  client.on("error", () => {});
  await client.connect();
  redisClient = client;
  console.log("✅ Redis connected");
} catch {
  console.log("⚠️  Redis not available — running without real-time events");
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      db: "connected",
      redis: redisClient?.isReady ? "connected" : "unavailable",
    });
  } catch {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/ingest",        rateLimit(60),  ingestRouter);
app.use("/api/proxy",         rateLimit(120), proxyRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/dashboard",     dashboardRouter);

// ── SSE endpoint — live dashboard updates via Redis pub/sub ───────────────────
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!redisClient?.isReady) {
    res.write('data: {"type":"no_redis"}\n\n');
    return;
  }

  let subscriber = null;
  const setup = async () => {
    subscriber = redisClient.duplicate();
    await subscriber.connect();
    await subscriber.subscribe("inference_events", (message) => {
      res.write(`data: ${message}\n\n`);
    });
  };
  setup().catch(console.error);

  req.on("close", async () => {
    if (subscriber?.isReady) {
      await subscriber.unsubscribe("inference_events").catch(() => {});
      await subscriber.disconnect().catch(() => {});
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Ingestion service running on http://localhost:${PORT}`);
  const configured = ["ANTHROPIC", "OPENAI", "GROQ", "GEMINI", "DEEPSEEK"]
    .filter((k) => process.env[`${k}_API_KEY`]);
  console.log(
    configured.length
      ? `   Providers configured: ${configured.join(", ")}`
      : "   ⚠️  No provider API keys found — add them to .env"
  );
});
