import React, { useState, useEffect } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.js";
import { WechatAccounts } from "./pages/WechatAccounts.js";
import { AgentManager } from "./pages/AgentManager.js";
import { AccessControl } from "./pages/AccessControl.js";
import { Settings } from "./pages/Settings.js";
import { subscribeEvents } from "./api.js";

const navItems = [
  { to: "/", label: "📊 Dashboard" },
  { to: "/wechat", label: "💬 WeChat" },
  { to: "/agents", label: "🤖 Agents" },
  { to: "/access", label: "🔐 Access" },
  { to: "/settings", label: "⚙️ Settings" },
];

const navStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: 200,
  minHeight: "100vh",
  background: "var(--bg-card)",
  borderRight: "1px solid var(--border)",
  padding: "16px 0",
};

const linkStyle: React.CSSProperties = {
  display: "block",
  padding: "10px 20px",
  color: "var(--text-dim)",
  fontSize: 14,
  transition: "all 0.15s",
};

const activeLinkStyle: React.CSSProperties = {
  ...linkStyle,
  color: "var(--text)",
  background: "var(--bg-hover)",
  borderRight: "3px solid var(--accent)",
};

export function App() {
  const [events, setEvents] = useState<unknown[]>([]);

  useEffect(() => {
    return subscribeEvents((data) => {
      setEvents((prev) => [...prev.slice(-100), data]);
    });
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={navStyle}>
        <div style={{ padding: "0 20px 20px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>🐾 ClawCenter</h1>
        </div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
        <Routes>
          <Route path="/" element={<Dashboard events={events} />} />
          <Route path="/wechat" element={<WechatAccounts />} />
          <Route path="/agents" element={<AgentManager />} />
          <Route path="/access" element={<AccessControl />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
