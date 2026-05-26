import React, { useState, useEffect } from "react";
import { CheckCircle, XCircle, ExternalLink, Server, Shield, Cpu, Activity } from "lucide-react";
import { fetchProviders } from "../lib/sdk.js";
import "./SettingsPage.css";

export default function SettingsPage() {
  const [providers, setProviders] = useState({});
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    fetchProviders().then(p => { setProviders(p); setLoading(false); });
  }, []);

  const configured = Object.values(providers).filter(p => p.configured).length;
  const total      = Object.keys(providers).length;

  const arch = [
    { icon: <Cpu size={13} />,      label: "Frontend",      value: "React 18 + Vite + Framer Motion" },
    { icon: <Server size={13} />,   label: "Proxy / API",   value: "Express.js — server-side LLM calls, keys never in browser" },
    { icon: <Shield size={13} />,   label: "PII Redaction", value: "Prefix-aware regex at ingest time (sk-, gsk_, AIzaSy…)" },
    { icon: <Activity size={13} />, label: "Event Bus",     value: "Redis pub/sub → SSE for live dashboard updates" },
    { icon: <Server size={13} />,   label: "Database",      value: "PostgreSQL 16 — inference_logs_with_cost view" },
    { icon: <Shield size={13} />,   label: "Rate Limiting", value: "In-process sliding window (60/120 req/min)" },
  ];

  const free = [
    { name: "Groq",     badge: "FREE",  desc: "Fastest free tier — Llama 3.3 70B",      url: "https://console.groq.com/keys" },
    { name: "Gemini",   badge: "FREE",  desc: "Google free tier — Gemini 2.0 Flash",    url: "https://aistudio.google.com/apikey" },
    { name: "DeepSeek", badge: "CHEAP", desc: "$0.14 / 1M tokens — free signup credits", url: "https://platform.deepseek.com/api_keys" },
  ];

  return (
    <div className="set-page">
      {/* Fixed header */}
      <div className="ph">
        <div>
          <h1>Settings</h1>
          <p className="ph-sub">Configure providers and view system info</p>
        </div>
        <span className={`pill ${configured > 0 ? "success" : "error"}`}>
          {configured > 0 ? <CheckCircle size={10} /> : <XCircle size={10} />}
          {configured}/{total} ready
        </span>
      </div>

      {/* Scrollable body — all cards are flex-shrink:0 so nothing gets squished */}
      <div className="set-body">

        {/* ── Provider Status ─────────────────────────────────────── */}
        <div className="set-card">
          <div className="set-card-head">
            <h2>Provider Status</h2>
            <p>
              API keys are server-side only — never exposed to the browser.
              Add to <code>.env</code> and restart.
            </p>
          </div>

          {loading ? (
            <div className="prov-grid">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="prov-card">
                  <div className="shimmer" style={{ height: 13, width: "55%", marginBottom: 8 }} />
                  <div className="shimmer" style={{ height: 10, width: "70%" }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="prov-grid">
              {Object.entries(providers).map(([id, p]) => (
                <div key={id} className={`prov-card${p.configured ? " ok" : ""}`}>
                  <div className="prov-head">
                    <span className="prov-name">{p.name}</span>
                    <div className="prov-badges">
                      {p.badge && (
                        <span className={`bdg ${p.badge === "FREE" ? "bdg-v" : "bdg-y"}`}>
                          {p.badge}
                        </span>
                      )}
                      {p.configured
                        ? <span className="bdg bdg-v"><CheckCircle size={9} /> Ready</span>
                        : <span className="bdg bdg-d"><XCircle size={9} /> No key</span>
                      }
                    </div>
                  </div>
                  <code className="prov-env">{id.toUpperCase()}_API_KEY</code>
                  <div className="prov-models">
                    {p.models.slice(0, 2).map(m => (
                      <span key={m} className="prov-model">{m.split("-").slice(0, 3).join("-")}</span>
                    ))}
                    {p.models.length > 2 && (
                      <span className="prov-model">+{p.models.length - 2}</span>
                    )}
                  </div>
                  {p.freeUrl && !p.configured && (
                    <a href={p.freeUrl} target="_blank" rel="noreferrer" className="prov-link">
                      Get free key <ExternalLink size={9} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="env-box">
            <div className="env-box-top">
              <span>How to configure</span>
              <span className="env-file">backend/ingestion/.env</span>
            </div>
            <pre className="env-pre">{`ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIzaSy...
DEEPSEEK_API_KEY=sk-...`}</pre>
            <p className="env-note">
              Restart after changes:{" "}
              <code>docker-compose restart ingestion</code>
            </p>
          </div>
        </div>

        {/* ── Free & Cheap Providers ───────────────────────────────── */}
        <div className="set-card">
          <div className="set-card-head">
            <h2>Free &amp; Cheap Providers</h2>
            <p>Get started without spending anything.</p>
          </div>
          <div className="free-list">
            {free.map(p => (
              <a key={p.name} href={p.url} target="_blank" rel="noreferrer" className="free-row">
                <div className="free-row-l">
                  <span className="free-name">{p.name}</span>
                  <span className={`bdg ${p.badge === "FREE" ? "bdg-v" : "bdg-y"}`}>{p.badge}</span>
                  <span className="free-desc">{p.desc}</span>
                </div>
                <ExternalLink size={12} style={{ color: "var(--t3)", flexShrink: 0 }} />
              </a>
            ))}
          </div>
        </div>

        {/* ── System Architecture ──────────────────────────────────── */}
        <div className="set-card">
          <div className="set-card-head">
            <h2>System Architecture</h2>
            <p>How InferLog is built.</p>
          </div>
          <div className="arch-list">
            {arch.map(item => (
              <div key={item.label} className="arch-row">
                <span className="arch-icon">{item.icon}</span>
                <div>
                  <span className="arch-label">{item.label}</span>
                  <span className="arch-val">{item.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
