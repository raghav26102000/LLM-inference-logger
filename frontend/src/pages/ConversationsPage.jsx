import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Trash2, XCircle, RefreshCw, ExternalLink, Clock } from "lucide-react";
import { api } from "../lib/api.js";
import "./ConversationsPage.css";

function timeAgo(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ConversationsPage() {
  const [convos,   setConvos]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState("all");
  const [deleting, setDeleting] = useState(null);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try { setConvos(await api.getConversations(filter === "all" ? undefined : filter)); }
    catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, [filter]); // eslint-disable-line

  const cancel = async (e, id) => {
    e.stopPropagation();
    await api.cancelConversation(id);
    load();
  };

  const del = async (e, id) => {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    setDeleting(id);
    await api.deleteConversation(id);
    setConvos(p => p.filter(c => c.id !== id));
    setDeleting(null);
  };

  return (
    <div className="cv-page">
      <div className="ph">
        <div>
          <h1>Conversations</h1>
          <p className="ph-sub">{convos.length} total</p>
        </div>
        <div className="ph-right">
          <div className="filter-tabs">
            {["all", "active", "cancelled"].map(f => (
              <button key={f} className={`ft${filter === f ? " on" : ""}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <button className="ibtn" onClick={load}>
            <RefreshCw size={12} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="cv-body">
        {loading ? (
          <div className="cv-grid">
            {[...Array(6)].map((_, i) => <div key={i} className="cv-skel shimmer" />)}
          </div>
        ) : convos.length === 0 ? (
          <div className="cv-empty">
            <div className="cv-empty-icon"><MessageSquare size={22} /></div>
            <h3>No {filter !== "all" ? filter : ""} conversations</h3>
            <p>Start a new chat to see conversations here.</p>
          </div>
        ) : (
          <div className="cv-grid">
            {convos.map(c => (
              <div
                key={c.id}
                className={`cv-card card-3d${deleting === c.id ? " del" : ""}`}
                onClick={() => navigate(`/chat/${c.id}`)}
              >
                <div className="cv-card-top">
                  <span className={`pill ${c.status}`}>{c.status}</span>
                  <button
                    className="cv-open"
                    onClick={e => { e.stopPropagation(); navigate(`/chat/${c.id}`); }}
                  >
                    <ExternalLink size={11} />
                  </button>
                </div>

                <h3 className="cv-title">{c.title || "Untitled conversation"}</h3>

                <div className="cv-meta">
                  <span className="cv-provider mono">{c.provider} · {c.model?.split("-").slice(0, 2).join("-")}</span>
                  <span className="cv-msgs"><MessageSquare size={9} />{c.message_count ?? 0}</span>
                </div>

                <div className="cv-foot">
                  <span className="cv-time"><Clock size={9} />{c.updated_at ? timeAgo(c.updated_at) : "—"}</span>
                  <div className="cv-acts" onClick={e => e.stopPropagation()}>
                    {c.status === "active" && (
                      <button className="cva warn" onClick={e => cancel(e, c.id)}>
                        <XCircle size={11} /> Cancel
                      </button>
                    )}
                    <button className="cva danger" onClick={e => del(e, c.id)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
