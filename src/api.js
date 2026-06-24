// Base URL for the backend API.
// - Local dev: leave VITE_API_URL unset -> calls "/api/*", which the Vite dev
//   server proxies to http://localhost:8787 (see vite.config.js).
// - Production (Vercel): set VITE_API_URL to the Render backend origin, e.g.
//   https://agilow-hub-api.onrender.com  (no trailing slash).
export const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

// apiUrl("/api/leads") -> "/api/leads" in dev, or full Render URL in prod.
export const apiUrl = (path) => `${API_BASE}${path}`;
