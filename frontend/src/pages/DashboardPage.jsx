import React, { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Hash, Zap, AlertTriangle, Clock, DollarSign,
  RefreshCw, CheckCircle, XCircle, Activity,
} from "lucide-react";
import { api } from "../lib/api.js";
import "./DashboardPage.css";

const INGESTION = import.meta.env.VITE_INGESTION_URL || "http://localhost:4000";

const TT = {
  contentStyle: {
    background: "#0c0c18",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10, fontSize: 12, color: "#f1f1ff",
    boxShadow: "0 8px 32px rgba(0,0,0,0.7)", padding: "8px 12px",
  },
  labelStyle: { color: "#50507a", marginBottom: 4, fontSize: 10 },
  cursor: { stroke: "rgba(124,106,255,0.25)", strokeWidth: 1 },
};

export default function DashboardPage() {
  const [stats,     setStats]     = useState(null);
  const [throughput,setThroughput]= useState([]);
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [hours,     setHours]     = useState(24);
  const [liveCount, setLiveCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, l] = await Promise.all([
        api.getDashboardStats(),
        api.getThroughput(hours),
        api.getRecentLogs(20),
      ]);
      setStats(s);
      setThroughput(t.map(r => ({
        ...r,
        bucket: new Date(r.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })));
      setLogs(l);
    } catch {}
    setLoading(false);
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const es = new EventSource(`${INGESTION}/api/events`);
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "new_logs") { setLiveCount(c => c + d.count); load(); }
      } catch {}
    };
    return () => es.close();
  }, [load]);

  const T = stats?.totals  || {};
  const L = stats?.latency || {};

  const cards = [
    { icon: Hash,          label: "Requests",    value: T.total_requests != null ? Number(T.total_requests).toLocaleString() : "—",  sub: `${T.successful ?? 0} successful`,  color: "#7c6aff" },
    { icon: Zap,           label: "Avg Latency", value: L.avg_latency ? `${L.avg_latency}ms` : "—",  sub: L.p95 ? `p95: ${L.p95}ms` : "—", color: "#38bdf8" },
    { icon: Clock,         label: "Avg TTFT",    value: L.avg_ttft    ? `${L.avg_ttft}ms`    : "—",  sub: "time to first token",            color: "#fbbf24" },
    { icon: AlertTriangle, label: "Error Rate",  value: stats ? `${stats.error_rate}%` : "—",        sub: `${T.failed ?? 0} failed`,        color: parseFloat(stats?.error_rate) > 5 ? "#ff4d6d" : "#10e09a" },
    { icon: DollarSign,    label: "Est. Cost",
      value: stats?.tokens?.estimated_cost_usd ? `$${Number(stats.tokens.estimated_cost_usd).toFixed(4)}` : "—",
      sub: stats?.tokens?.total_tokens ? `${Number(stats.tokens.total_tokens).toLocaleString()} tokens` : "—",
      color: "#a48fff" },
  ];

  return (
    <div className="dash-page">
      {/* Fixed header */}
      <div className="ph">
        <div>
          <h1>Dashboard</h1>
          <p className="ph-sub">Real-time inference observability</p>
        </div>
        <div className="ph-right">
          {liveCount > 0 && (
            <span className="live-pill"><span className="dot green" />{liveCount} new</span>
          )}
          <select className="time-sel" value={hours} onChange={e => setHours(Number(e.target.value))}>
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={48}>Last 48h</option>
            <option value={168}>Last 7d</option>
          </select>
          <button className="ibtn" onClick={load}>
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="dash-body">

        {/* Stat cards */}
        <div className="stat-row">
          {cards.map((c, i) => (
            <div key={c.label} className="stat-card card-3d" style={{ "--c": c.color }}>
              <div className="sc-top">
                <span className="sc-icon" style={{ color: c.color }}><c.icon size={14} /></span>
                <span className="sc-label">{c.label}</span>
              </div>
              {loading && !stats
                ? <div className="shimmer" style={{ height: 26, width: "60%", marginTop: 8 }} />
                : <div className="sc-val" style={{ color: c.color }}>{c.value}</div>
              }
              <div className="sc-sub">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Throughput chart */}
        <div className="ch-card">
          <div className="ch-head">
            <div>
              <p className="ch-title">Request Throughput</p>
              <p className="ch-sub">success vs errors per hour</p>
            </div>
          </div>
          {loading && !throughput.length ? (
            <div className="shimmer ch-skel" />
          ) : throughput.length === 0 ? (
            <div className="ch-empty"><Activity size={18} /><span>No data yet for this time range</span></div>
          ) : (
            /* chart-wrap has a fixed pixel height so ResponsiveContainer works */
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={throughput} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#10e09a" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10e09a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#ff4d6d" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#ff4d6d" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill:"#50507a", fontSize:10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill:"#50507a", fontSize:10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...TT} />
                  <Legend wrapperStyle={{ fontSize:11, color:"#9898c0", paddingTop:6 }} />
                  <Area type="monotone" dataKey="success" stroke="#10e09a" strokeWidth={2} fill="url(#gs)" name="Success" dot={false} activeDot={{ r:3 }} />
                  <Area type="monotone" dataKey="error"   stroke="#ff4d6d" strokeWidth={2} fill="url(#ge)" name="Error"   dot={false} activeDot={{ r:3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Latency chart */}
        <div className="ch-card">
          <div className="ch-head">
            <div>
              <p className="ch-title">Latency over Time</p>
              <p className="ch-sub">avg latency vs time-to-first-token (ms)</p>
            </div>
          </div>
          {loading && !throughput.length ? (
            <div className="shimmer ch-skel" />
          ) : throughput.length === 0 ? (
            <div className="ch-empty"><Activity size={18} /><span>No data yet for this time range</span></div>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={throughput} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill:"#50507a", fontSize:10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill:"#50507a", fontSize:10 }} axisLine={false} tickLine={false} unit="ms" />
                  <Tooltip {...TT} formatter={v => [`${v ?? "—"}ms`]} />
                  <Legend wrapperStyle={{ fontSize:11, color:"#9898c0", paddingTop:6 }} />
                  <Line type="monotone" dataKey="avg_latency" stroke="#7c6aff" strokeWidth={2.5} dot={false} name="Avg Latency" activeDot={{ r:3 }} />
                  <Line type="monotone" dataKey="avg_ttft"    stroke="#fbbf24" strokeWidth={2}   dot={false} name="Avg TTFT" strokeDasharray="5 3" activeDot={{ r:3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Provider breakdown */}
        {stats?.by_provider?.length > 0 && (
          <div className="ch-card">
            <div className="ch-head"><p className="ch-title">By Provider &amp; Model</p></div>
            <div className="tbl-wrap">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th>Provider</th><th>Model</th><th>Requests</th>
                    <th>Avg Latency</th><th>Avg TTFT</th>
                    <th>Tokens</th><th>Est. Cost</th><th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_provider.map((r, i) => (
                    <tr key={i}>
                      <td><span className="p-chip">{r.provider}</span></td>
                      <td className="mono" style={{ fontSize:11 }}>{r.model}</td>
                      <td className="mono">{Number(r.requests).toLocaleString()}</td>
                      <td className="mono">{r.avg_latency ? `${r.avg_latency}ms` : "—"}</td>
                      <td className="mono">{r.avg_ttft    ? `${r.avg_ttft}ms`    : "—"}</td>
                      <td className="mono">{r.total_tokens ? Number(r.total_tokens).toLocaleString() : "—"}</td>
                      <td className="mono">{r.estimated_cost_usd ? `$${Number(r.estimated_cost_usd).toFixed(4)}` : "—"}</td>
                      <td>
                        <span className={r.errors > 0 ? "ev-bad" : "ev-ok"}>
                          {r.errors > 0 ? <><XCircle size={10}/> {r.errors}</> : <><CheckCircle size={10}/> 0</>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent logs */}
        <div className="ch-card">
          <div className="ch-head">
            <p className="ch-title">Recent Inference Logs</p>
            <p className="ch-sub">{logs.length} entries</p>
          </div>
          <div className="tbl-wrap">
            <table className="dtbl">
              <thead>
                <tr>
                  <th>Time</th><th>Provider</th><th>Model</th><th>Status</th>
                  <th>Latency</th><th>TTFT</th><th>Tokens</th><th>Cost</th><th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {loading && !logs.length
                  ? [...Array(4)].map((_,i) => (
                    <tr key={i}>{[...Array(9)].map((_,j) => <td key={j}><div className="shimmer" style={{height:10,width:"80%",borderRadius:3}}/></td>)}</tr>
                  ))
                  : logs.length === 0
                  ? <tr><td colSpan={9} className="tbl-empty">No logs yet — send a chat message first.</td></tr>
                  : logs.map(log => (
                    <tr key={log.id}>
                      <td className="mono">{new Date(log.request_ts).toLocaleTimeString()}</td>
                      <td><span className="p-chip">{log.provider}</span></td>
                      <td className="mono" style={{fontSize:10}}>{log.model?.split("-").slice(0,3).join("-")}</td>
                      <td><span className={`pill ${log.status}`}>{log.status}</span></td>
                      <td className="mono">{log.latency_ms != null ? `${log.latency_ms}ms` : "—"}</td>
                      <td className="mono">{log.ttft_ms    != null ? `${log.ttft_ms}ms`    : "—"}</td>
                      <td className="mono">{log.total_tokens ?? "—"}</td>
                      <td className="mono">{log.estimated_cost_usd ? `$${Number(log.estimated_cost_usd).toFixed(5)}` : "—"}</td>
                      <td className="log-prev">{log.input_preview?.slice(0,32) || "—"}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
