import React, { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { Send, Square, Plus, ChevronDown, Copy, Check, RotateCcw, Zap, Clock } from "lucide-react";
import {
  streamChat, ensureConversation, cancelConversation,
  fetchProviders, PROVIDERS_FALLBACK,
} from "../lib/sdk.js";
import { api } from "../lib/api.js";
import "./ChatPage.css";

export default function ChatPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();

  const [conversationId, setConversationId] = useState(routeId || null);
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error,     setError]     = useState(null);
  const [providers, setProviders] = useState(PROVIDERS_FALLBACK);
  const [provider,  setProvider]  = useState("groq");
  const [model,     setModel]     = useState(PROVIDERS_FALLBACK.groq.defaultModel);
  const [lastMeta,  setLastMeta]  = useState(null);

  const abortRef  = useRef(null);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    fetchProviders().then(p => {
      setProviders(p);
      const first = Object.entries(p).find(([, v]) => v.configured);
      if (first) { setProvider(first[0]); setModel(first[1].defaultModel); }
    });
  }, []);

  useEffect(() => {
    if (!routeId) return;
    setConversationId(routeId);
    api.getConversation(routeId).then(conv => {
      setMessages(conv.messages.map(m => ({ id: m.id, role: m.role, content: m.content, ts: m.created_at })));
      if (conv.provider && providers[conv.provider]) {
        setProvider(conv.provider);
        setModel(conv.model || providers[conv.provider].defaultModel);
      }
    }).catch(() => {});
  }, [routeId]); // eslint-disable-line

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const startNew = () => {
    setConversationId(null); setMessages([]);
    setError(null); setLastMeta(null);
    navigate("/");
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const handleCancel = async () => {
    abortRef.current?.abort();
    if (conversationId) await cancelConversation(conversationId);
  };

  const send = useCallback(async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;

    if (!providers[provider]?.configured) {
      setError(`${providers[provider]?.name ?? provider} is not configured — add ${provider.toUpperCase()}_API_KEY to the backend .env`);
      return;
    }

    let convId = conversationId;
    if (!convId) {
      convId = uuidv4();
      setConversationId(convId);
      navigate(`/chat/${convId}`, { replace: true });
      ensureConversation({ id: convId, title: text.slice(0, 60), provider, model });
    }

    const userMsg = { id: uuidv4(), role: "user",      content: text, ts: new Date().toISOString() };
    const asstMsg = { id: uuidv4(), role: "assistant", content: "",   ts: new Date().toISOString() };

    setMessages(prev => [...prev, userMsg, asstMsg]);
    setInput("");
    setStreaming(true);
    setError(null);

    if (inputRef.current) inputRef.current.style.height = "auto";

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const ctx = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
    const start = Date.now();

    try {
      for await (const chunk of streamChat({ provider, model, messages: ctx, conversationId: convId, signal: ctrl.signal })) {
        asstMsg.content += chunk;
        setMessages(prev => prev.map(m => m.id === asstMsg.id ? { ...m, content: asstMsg.content } : m));
      }
      setLastMeta({ latency: Date.now() - start, provider, model });
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, conversationId, messages, provider, model, providers, navigate]);

  const onKey = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const regen = useCallback(() => {
    const last = [...messages].reverse().find(m => m.role === "user");
    if (!last) return;
    setMessages(prev => prev.slice(0, -1));
    send(last.content);
  }, [messages, send]);

  return (
    <div className="chat-page">
      <div className="chat-bar">
        <div className="chat-bar-l">
          <button className="ibtn" onClick={startNew} title="New chat"><Plus size={14} /></button>
          <span className="chat-bar-title trunc">{conversationId ? "Conversation" : "New Chat"}</span>
        </div>
        <div className="chat-bar-r">
          {lastMeta && (
            <div className="meta-row">
              <span className="meta-chip"><Clock size={9} />{lastMeta.latency}ms</span>
              <span className="meta-chip"><Zap size={9} />{lastMeta.provider}</span>
            </div>
          )}
          <ProviderPicker
            providers={providers} provider={provider} model={model}
            onProvider={p => { setProvider(p); setModel(providers[p].defaultModel); }}
            onModel={setModel}
            disabled={streaming || messages.length > 0}
          />
        </div>
      </div>

      {/* THE scroll container */}
      <div className="chat-msgs">
        {messages.length === 0 && <EmptyState />}
        {messages.map((msg, i) => (
          <Bubble
            key={msg.id} msg={msg}
            isLive={streaming && msg.role === "assistant" && i === messages.length - 1}
            canRegen={!streaming && msg.role === "assistant" && i === messages.length - 1}
            onRegen={regen}
          />
        ))}
        {error && (
          <div className="chat-err">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-box">
          <textarea
            ref={inputRef}
            className="chat-ta"
            value={input}
            disabled={streaming}
            placeholder="Message InferLog… (Enter to send)"
            rows={1}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
            }}
            onKeyDown={onKey}
          />
          <div className="chat-input-btn-row">
            <span className="input-kbd">⏎ send · ⇧⏎ newline</span>
            {streaming
              ? <button className="send-btn stop" onClick={handleCancel}><Square size={13} /> Stop</button>
              : <button className="send-btn" onClick={() => send()} disabled={!input.trim()}><Send size={13} /></button>
            }
          </div>
        </div>
        <p className="chat-disc">Responses are logged for observability.</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="chat-empty">
      <div className="empty-orb" />
      <div className="empty-icon-wrap">
        <Zap size={26} className="empty-zap" />
      </div>
      <h2>InferLog Chat</h2>
      <p>Multi-provider AI with real-time inference logging</p>
      <div className="empty-tags">
        {["Streaming", "5 providers", "Auto-logged", "Cost tracked"].map(t => (
          <span key={t} className="empty-tag">{t}</span>
        ))}
      </div>
    </div>
  );
}

function Bubble({ msg, isLive, canRegen, onRegen }) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === "user";

  const copy = async () => {
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`bubble-row ${isUser ? "u" : "a"}`}>
      <div className={`avatar ${isUser ? "u-av" : "a-av"}`}>
        {isUser ? "U" : <Zap size={11} />}
      </div>
      <div className="bubble-body">
        <div className={`bubble ${isUser ? "u-bubble" : "a-bubble"}`}>
          {msg.content
            ? <span className="bubble-text">{msg.content}</span>
            : isLive ? <span className="cursor" /> : null
          }
        </div>
        {!isUser && msg.content && (
          <div className="bubble-actions">
            <button className="ba-btn" onClick={copy}>
              {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
            {canRegen && (
              <button className="ba-btn" onClick={onRegen}>
                <RotateCcw size={11} /> Retry
              </button>
            )}
            {msg.ts && (
              <span className="ba-ts">
                {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderPicker({ providers, provider, model, onProvider, onModel, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const fn = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const cur = providers[provider];

  return (
    <div className="pp" ref={ref}>
      <button className="pp-trigger" onClick={() => !disabled && setOpen(v => !v)} disabled={disabled}>
        <span className="pp-dot" style={{ background: cur?.configured ? "var(--green)" : "var(--red)" }} />
        <span className="pp-name">{cur?.name ?? provider}</span>
        <span className="pp-model mono">{model.split("-").slice(0, 3).join("-")}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="pp-drop">
          {Object.entries(providers).map(([key, info]) => (
            <div key={key} className="pp-group">
              <div className="pp-group-label">
                {info.name}
                {info.badge && <span className={`bdg ${info.badge === "FREE" ? "bdg-v" : "bdg-y"}`}>{info.badge}</span>}
                {!info.configured && <span className="bdg bdg-d">no key</span>}
              </div>
              {info.models.map(m => (
                <button
                  key={m}
                  className={`pp-opt${provider === key && model === m ? " sel" : ""}${!info.configured ? " off" : ""}`}
                  disabled={!info.configured}
                  onClick={() => { if (!info.configured) return; onProvider(key); onModel(m); setOpen(false); }}
                >
                  <span className="mono" style={{ fontSize: 11 }}>{m}</span>
                  {provider === key && model === m && <Check size={10} />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
