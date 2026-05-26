/**
 * proxy.js — Server-side proxy for all LLM provider calls.
 *
 * WHY: API keys must never live in the browser. This route accepts
 * chat requests from the frontend and forwards them to the real provider,
 * streaming the response back via named SSE events. The frontend only
 * needs to know the backend URL — no provider key ever touches the browser.
 *
 * ENDPOINTS
 *   GET  /api/proxy/providers   — which providers are configured
 *   POST /api/proxy/chat        — stream a chat completion
 */

import { Router } from "express";
import { z } from "zod";

export const proxyRouter = Router();

// ── Provider registry ─────────────────────────────────────────────────────────
const PROVIDERS = {
  anthropic: {
    name: "Anthropic",
    models: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
    defaultModel: "claude-sonnet-4-20250514",
    badge: null,
    freeUrl: null,
    key: () => process.env.ANTHROPIC_API_KEY,
  },
  openai: {
    name: "OpenAI",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1"],
    defaultModel: "gpt-4o-mini",
    badge: null,
    freeUrl: null,
    key: () => process.env.OPENAI_API_KEY,
  },
  groq: {
    name: "Groq",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    defaultModel: "llama-3.3-70b-versatile",
    badge: "FREE",
    freeUrl: "https://console.groq.com/keys",
    key: () => process.env.GROQ_API_KEY,
  },
  deepseek: {
    name: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    badge: "CHEAP",
    freeUrl: "https://platform.deepseek.com/api_keys",
    key: () => process.env.DEEPSEEK_API_KEY,
  },
  gemini: {
    name: "Google Gemini",
    models: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
    defaultModel: "gemini-2.0-flash",
    badge: "FREE",
    freeUrl: "https://aistudio.google.com/apikey",
    key: () => process.env.GEMINI_API_KEY,
  },
};

// ── GET /api/proxy/providers ──────────────────────────────────────────────────
proxyRouter.get("/providers", (_req, res) => {
  const list = Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name,
    models: p.models,
    defaultModel: p.defaultModel,
    badge: p.badge,
    freeUrl: p.freeUrl,
    configured: Boolean(p.key()),
  }));
  res.json(list);
});

// ── POST /api/proxy/chat ──────────────────────────────────────────────────────
const ChatSchema = z.object({
  provider: z.enum(["anthropic", "openai", "groq", "deepseek", "gemini"]),
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
});

proxyRouter.post("/chat", async (req, res) => {
  let parsed;
  try {
    parsed = ChatSchema.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: "Invalid request", details: err.errors });
  }

  const { provider, model, messages } = parsed;
  const cfg = PROVIDERS[provider];
  const apiKey = cfg.key();

  if (!apiKey) {
    return res.status(503).json({
      error: `${cfg.name} is not configured. Add ${provider.toUpperCase()}_API_KEY to the server .env file.`,
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    if (provider === "anthropic") {
      await streamAnthropic({ model, messages, apiKey, send, signal: req.signal });
    } else if (provider === "gemini") {
      await streamGemini({ model, messages, apiKey, send, signal: req.signal });
    } else {
      const urls = {
        openai:   "https://api.openai.com/v1/chat/completions",
        groq:     "https://api.groq.com/openai/v1/chat/completions",
        deepseek: "https://api.deepseek.com/chat/completions",
      };
      await streamOpenAICompat({ url: urls[provider], model, messages, apiKey, send, signal: req.signal });
    }
  } catch (err) {
    if (!res.writableEnded) send("error", { message: err.message || "Upstream error" });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// ── OpenAI-compatible (OpenAI / Groq / DeepSeek) ─────────────────────────────
async function streamOpenAICompat({ url, model, messages, apiKey, send, signal }) {
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, messages }),
    signal,
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    throw new Error(err.error?.message || `${url} returned ${upstream.status}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") { send("done", {}); continue; }
      try {
        const evt = JSON.parse(data);
        const chunk = evt.choices?.[0]?.delta?.content;
        if (chunk) send("chunk", { text: chunk });
        if (evt.usage) send("usage", {
          prompt_tokens:     evt.usage.prompt_tokens,
          completion_tokens: evt.usage.completion_tokens,
          total_tokens:      evt.usage.total_tokens,
        });
      } catch { /* skip malformed lines */ }
    }
  }
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
async function streamAnthropic({ model, messages, apiKey, send, signal }) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 1024, stream: true, messages }),
    signal,
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic returned ${upstream.status}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim());
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          send("chunk", { text: evt.delta.text });
        }
        if (evt.type === "message_start" && evt.message?.usage) {
          send("usage", {
            prompt_tokens:     evt.message.usage.input_tokens,
            completion_tokens: evt.message.usage.output_tokens,
          });
        }
        if (evt.type === "message_stop") send("done", {});
      } catch { /* skip */ }
    }
  }
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function streamGemini({ model, messages, apiKey, send, signal }) {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
    signal,
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini returned ${upstream.status}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim());
        const chunk = evt.candidates?.[0]?.content?.parts?.[0]?.text;
        if (chunk) send("chunk", { text: chunk });
        if (evt.usageMetadata) {
          send("usage", {
            prompt_tokens:     evt.usageMetadata.promptTokenCount,
            completion_tokens: evt.usageMetadata.candidatesTokenCount,
            total_tokens:      evt.usageMetadata.totalTokenCount,
          });
        }
        if (evt.candidates?.[0]?.finishReason) send("done", {});
      } catch { /* skip */ }
    }
  }
}
