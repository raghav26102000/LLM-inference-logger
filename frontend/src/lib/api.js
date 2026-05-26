const BASE = import.meta.env.VITE_INGESTION_URL || "http://localhost:4000";

async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

export const api = {
  getConversations: (status) =>
    req(`/api/conversations${status ? `?status=${status}` : ""}`),
  getConversation: (id) => req(`/api/conversations/${id}`),
  cancelConversation: (id) =>
    req(`/api/conversations/${id}/cancel`, { method: "PATCH" }),
  deleteConversation: (id) =>
    req(`/api/conversations/${id}`, { method: "DELETE" }),
  getDashboardStats: () => req("/api/dashboard/stats"),
  getThroughput: (hours = 24) => req(`/api/dashboard/throughput?hours=${hours}`),
  getRecentLogs: (limit = 20) => req(`/api/dashboard/logs?limit=${limit}`),
};
