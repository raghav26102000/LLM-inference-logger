/**
 * sdk.js — LLM SDK wrapper (enhanced)
 *
 * KEY CHANGES vs original:
 *  1. All LLM calls go through the backend proxy (/api/proxy/chat).
 *     No provider API keys are ever stored in the browser.
 *  2. Provider list is fetched from the backend (/api/proxy/providers)
 *     so the UI reflects which keys are actually configured server-side.
 *  3. ttft_ms (time-to-first-token) is measured and logged.
 *  4. fullOutput accumulation lives only in streamChat — inner helpers
 *     yield chunks and have zero side effects (clean closure pattern).
 */

const INGESTION_URL = import.meta.env.VITE_INGESTION_URL || "http://localhost:4000";

// ── Static fallback used when /api/proxy/providers is unreachable ─────────────
export const PROVIDERS_FALLBACK = {
  anthropic: { name: "Anthropic",      badge: null,    models: ["claude-sonnet-4-20250514","claude-haiku-4-5-20251001"], defaultModel: "claude-sonnet-4-20250514", freeUrl: null,                                      configured: false },
  openai:    { name: "OpenAI",         badge: null,    models: ["gpt-4o-mini","gpt-4o","gpt-4.1"],                       defaultModel: "gpt-4o-mini",              freeUrl: null,                                      configured: false },
  groq:      { name: "Groq",           badge: "FREE",  models: ["llama-3.3-70b-versatile","llama-3.1-8b-instant","mixtral-8x7b-32768"], defaultModel: "llama-3.3-70b-versatile", freeUrl: "https://console.groq.com/keys",          configured: false },
  deepseek:  { name: "DeepSeek",       badge: "CHEAP", models: ["deepseek-chat","deepseek-reasoner"],                    defaultModel: "deepseek-chat",            freeUrl: "https://platform.deepseek.com/api_keys",  configured: false },
  gemini:    { name: "Google Gemini",  badge: "FREE",  models: ["gemini-2.0-flash","gemini-1.5-flash","gemini-1.5-pro"], defaultModel: "gemini-2.0-flash",         freeUrl: "https://aistudio.google.com/apikey",      configured: false },
};

let _providersCache = null;

/** Fetch which providers are configured on the server. Cached after first call. */
export async function fetchProviders() {
  if (_providersCache) return _providersCache;
  try {
    const resp = await fetch(`${INGESTION_URL}/api/proxy/providers`);
    if (!resp.ok) throw new Error("non-ok");
    const list = await resp.json(); // [{ id, name, models, defaultModel, badge, freeUrl, configured }]
    const map = {};
    for (const p of list) {
      map[p.id] = {
        name: p.name, badge: p.badge, models: p.models,
        defaultModel: p.defaultModel, freeUrl: p.freeUrl, configured: p.configured,
      };
    }
    _providersCache = map;
    return map;
  } catch {
    return PROVIDERS_FALLBACK;
  }
}

// ── Ingestion helpers ─────────────────────────────────────────────────────────

function sendToIngestion({ logs = [], messages = [], conversations = [] }) {
  // Fire-and-forget — a logging failure must never interrupt the chat UX
  fetch(`${INGESTION_URL}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logs, messages, conversations }),
  }).catch(() => {});
}

export function ensureConversation({ id, title, provider, model }) {
  sendToIngestion({ conversations: [{ id, title, provider, model, status: "active" }] });
}

export async function cancelConversation(conversationId) {
  try {
    await fetch(`${INGESTION_URL}/api/conversations/${conversationId}/cancel`, { method: "PATCH" });
  } catch {}
}

// ── Main streaming entry point ────────────────────────────────────────────────
/**
 * streamChat — streams tokens from the backend proxy.
 * Yields string chunks. Logs full metadata on completion / error / cancel.
 */
export async function* streamChat({ provider, model, messages, conversationId, signal }) {
  const requestTs = new Date().toISOString();
  const startMs   = Date.now();

  // State — accumulated only here, never inside inner helpers
  let ttftMs           = null;
  let fullOutput       = "";
  let promptTokens     = null;
  let completionTokens = null;
  let totalTokens      = null;
  let status           = "success";
  let errorMessage     = null;
  const userMsg        = messages[messages.length - 1];

  // Log the outgoing user message immediately (non-blocking)
  sendToIngestion({
    messages: [{ conversation_id: conversationId, role: userMsg.role, content: userMsg.content }],
  });

  try {
    const resp = await fetch(`${INGESTION_URL}/api/proxy/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, messages }),
      signal,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Proxy error ${resp.status}`);
    }

    // Parse named-event SSE from the proxy
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer       = "";
    let currentEvent = "message";
    let firstChunk   = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete trailing line

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) continue;

        let data;
        try { data = JSON.parse(line.slice(5).trim()); }
        catch { continue; }

        if (currentEvent === "chunk" && data.text) {
          // Capture TTFT on the very first token
          if (firstChunk) { ttftMs = Date.now() - startMs; firstChunk = false; }
          fullOutput += data.text;
          yield data.text;

        } else if (currentEvent === "usage") {
  promptTokens     = data.prompt_tokens     ?? data.promptTokenCount     ?? null;
  completionTokens = data.completion_tokens ?? data.candidatesTokenCount ?? null;
  const summed     = (promptTokens ?? 0) + (completionTokens ?? 0);
  totalTokens      = data.total_tokens ?? data.totalTokenCount ?? (summed > 0 ? summed : null);

        } else if (currentEvent === "error") {
          throw new Error(data.message || "Upstream error from proxy");
        }

        currentEvent = "message"; // reset after each data line
      }
    }

  } catch (err) {
    if (err.name === "AbortError") { status = "cancelled"; }
    else { status = "error"; errorMessage = err.message; throw err; }
  } finally {
    const latencyMs = Date.now() - startMs;

    // Log assistant reply + full inference metadata in one batch call
    sendToIngestion({
      messages: fullOutput
        ? [{ conversation_id: conversationId, role: "assistant", content: fullOutput }]
        : [],
      logs: [{
        conversation_id:   conversationId,
        provider,
        model,
        latency_ms:        latencyMs,
        ttft_ms:           ttftMs,
        prompt_tokens:     promptTokens,
        completion_tokens: completionTokens,
        total_tokens:      totalTokens,
        status,
        error_message:     errorMessage,
        request_ts:        requestTs,
        response_ts:       new Date().toISOString(),
        input_preview:     userMsg.content.slice(0, 200),
        output_preview:    fullOutput.slice(0, 200),
        metadata:          { messageCount: messages.length },
      }],
    });
  }
}
