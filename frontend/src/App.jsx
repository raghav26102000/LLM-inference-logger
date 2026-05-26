import React from "react";
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { MessageSquare, List, BarChart2, Settings, Zap } from "lucide-react";
import ChatPage          from "./pages/ChatPage.jsx";
import ConversationsPage from "./pages/ConversationsPage.jsx";
import DashboardPage     from "./pages/DashboardPage.jsx";
import SettingsPage      from "./pages/SettingsPage.jsx";
import "./App.css";

export default function App() {
  return (
    <div className="layout">
      <Sidebar />
      <div className="app-main">
        <Routes>
          <Route path="/"              element={<ChatPage />} />
          <Route path="/chat/:id"      element={<ChatPage />} />
          <Route path="/conversations" element={<ConversationsPage />} />
          <Route path="/dashboard"     element={<DashboardPage />} />
          <Route path="/settings"      element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
}

function Sidebar() {
  const navigate = useNavigate();
  const nav = [
    { to: "/",              icon: MessageSquare, label: "Chat",          end: true  },
    { to: "/conversations", icon: List,          label: "Conversations", end: false },
    { to: "/dashboard",     icon: BarChart2,     label: "Dashboard",     end: false },
    { to: "/settings",      icon: Settings,      label: "Settings",      end: false },
  ];

  return (
    <aside className="sidebar">
      <div className="sb-logo" onClick={() => navigate("/")}>
        <div className="sb-icon"><Zap size={13} /></div>
        <span className="sb-name">InferLog</span>
      </div>

      <nav className="sb-nav">
        {nav.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `sb-item${isActive ? " active" : ""}`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sb-footer">
        <span className="dot green" />
        <span className="sb-status">All systems online</span>
      </div>
    </aside>
  );
}
