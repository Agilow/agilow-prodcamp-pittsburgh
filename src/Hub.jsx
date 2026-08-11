import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Inbox,
  FileText,
  Send,
  MessageSquareText,
  Settings as SettingsIcon,
  Search,
  Sparkles,
  ChevronRight,
  RefreshCw,
  Target,
  Mail,
} from "lucide-react";
import "./hub.css";
import { apiUrl } from "./api.js";

/* ============================================================
   Avatar palette — rotates through orange / navy / purple /
   tan-brown / green per the design system.
   ============================================================ */
const palette = ["#e8472a", "#13294b", "#5b5bd6", "#b7791f", "#087f5b"];

/* ============================================================
   Leads are loaded at runtime from the Notion CRM via
   GET /api/leads (see server/). Shape per lead:
   { id, notionPageId, company, contact, role, hook,
     draft, research, channel, icp, status, initials, color }
   replies/sent below remain mock (out of scope).
   ============================================================ */

const channelLabel = { inmail: "InMail", linkedin: "LinkedIn", email: "Email" };

/* Recent replies (overview + replies page source) */
const replies = [
  {
    id: "LD-014",
    contact: "Maya Chen",
    company: "Northwind Robotics",
    initials: "MC",
    color: palette[1],
    snippet: "Interesting — can you send a couple of times for next week?",
    channel: "inmail",
    status: "good",
    time: "2h",
  },
  {
    id: "LD-009",
    contact: "Tom Becker",
    company: "Vela Systems",
    initials: "TB",
    color: palette[1],
    snippet: "Yes, let's set up a call. I'll loop in our scrum lead.",
    channel: "inmail",
    status: "good",
    time: "5h",
  },
  {
    id: "LD-010",
    contact: "Sofia Romero",
    company: "Tideline",
    initials: "SR",
    color: palette[3],
    snippet: "What does pricing look like for a team our size?",
    channel: "email",
    status: "pending",
    time: "1d",
  },
  {
    id: "LD-013",
    contact: "Devin Park",
    company: "Brightloop AI",
    initials: "DP",
    color: palette[2],
    snippet: "Not the right moment — reach back out in Q3 though.",
    channel: "linkedin",
    status: "pending",
    time: "2d",
  },
];

/* Sent log */
const sent = [
  { id: "LD-018", contact: "Elena Voss", company: "Sequora", initials: "EV", color: palette[2], channel: "linkedin", time: "Today 9:12", status: "replied" },
  { id: "LD-017", contact: "Jordan Hale", company: "Driftwood", initials: "JH", color: palette[4], channel: "email", time: "Today 8:40", status: "opened" },
  { id: "LD-016", contact: "Priya Nair", company: "Cadence Health", initials: "PN", color: palette[0], channel: "linkedin", time: "Yest 6:05", status: "opened" },
  { id: "LD-015", contact: "Marcus Webb", company: "Forge Labs", initials: "MW", color: palette[4], channel: "email", time: "Yest 5:21", status: "delivered" },
  { id: "LD-014", contact: "Maya Chen", company: "Northwind Robotics", initials: "MC", color: palette[1], channel: "inmail", time: "Yest 2:48", status: "replied" },
  { id: "LD-012", contact: "Aisha Khan", company: "Lumen Data", initials: "AK", color: palette[2], channel: "linkedin", time: "Mon 4:10", status: "opened" },
  { id: "LD-011", contact: "Sofia Romero", company: "Tideline", initials: "SR", color: palette[3], channel: "email", time: "Mon 11:32", status: "delivered" },
  { id: "LD-009", contact: "Tom Becker", company: "Vela Systems", initials: "TB", color: palette[1], channel: "inmail", time: "Mon 9:58", status: "replied" },
];

const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "qualify", label: "Qualify", icon: Target },
  { id: "queue", label: "Lead Queue", icon: Inbox, count: 10 },
  { id: "drafts", label: "Drafts", icon: FileText },
  { id: "sent", label: "Sent", icon: Send },
  { id: "replies", label: "Replies", icon: MessageSquareText, count: 4 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

/* First-two-initials for an avatar (mirrors the server's helper). */
function initialsFrom(name, fallback) {
  const source = (name || fallback || "").trim();
  if (!source) return "??";
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

function Avatar({ initials, color, size = "md" }) {
  return (
    <span className={cx("avatar", `avatar-${size}`)} style={{ background: color }}>
      {initials}
    </span>
  );
}

/* ============================================================
   Sidebar topographic contour texture — same animated canvas
   as the main dashboard so both products feel identical.
   ============================================================ */
let sharedT = 0;
const clockListeners = new Set();
let clockStarted = false;
function startSharedClock() {
  if (clockStarted) return;
  clockStarted = true;
  function tick() {
    sharedT += 0.012;
    clockListeners.forEach((fn) => fn(sharedT));
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function AnimatedBackground() {
  const canvasRef = useRef(null);
  useEffect(() => {
    startSharedClock();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    function drawFrame(t) {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const vw = 1400;
      ctx.clearRect(0, 0, w, h);

      function drawSet(count, direction, colorFn) {
        for (let i = 0; i < count; i++) {
          const frac = i / count;
          ctx.strokeStyle = colorFn(frac);
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          const baseY = frac * h;
          const amp = (65 * Math.sin(frac * Math.PI) + 20) * (h / 700);
          for (let x = 0; x <= w; x += 2) {
            const xp = x / vw;
            const y =
              baseY +
              amp * Math.sin(xp * Math.PI * 4 + direction * t * 0.45 + i * 0.28) +
              amp * 0.45 * Math.sin(xp * Math.PI * 7 + direction * t * 0.28 + i * 0.14);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      drawSet(38, 1, (frac) => `rgba(10,${Math.round(190 + frac * 35)},225,${0.10 + frac * 0.18})`);
      drawSet(28, -1, (frac) => `rgba(${Math.round(80 + frac * 60)},60,220,${0.08 + frac * 0.14})`);
    }

    clockListeners.add(drawFrame);
    drawFrame(sharedT);
    return () => {
      clockListeners.delete(drawFrame);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="animated-bg-canvas" />;
}

/* ============================================================
   Shell
   ============================================================ */
function Shell({ active, setActive, children, owner, setOwner, ownerOptions = [] }) {
  // The saved owner may not be in the fetched option list yet — include it so
  // the <select> always shows the current value.
  const ownerChoices = Array.from(new Set([...(owner ? [owner] : []), ...ownerOptions]));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <AnimatedBackground />
        <div className="sidebar-content">
          <div className="brand">
            <img src="/agi2-nobg.png" alt="Agilow" className="brand-logo" />
          </div>

          <div className="quick-search" style={{ cursor: "default" }}>
            <Search size={14} />
            <span>Search leads</span>
            <kbd>⌘K</kbd>
          </div>

          <nav className="nav-list">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={cx("nav-item", active === item.id && "active")}
                  onClick={() => setActive(item.id)}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                  {item.count ? <span className="nav-count">{item.count}</span> : null}
                </button>
              );
            })}
          </nav>

          <div className="sidebar-section">
            <div className="sidebar-label">Pipeline</div>
            <div className="sprint-card">
              <div className="sprint-row">
                <span>This week</span>
                <strong>32%</strong>
              </div>
              <div className="progress-line">
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: "32%" }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <div className="sprint-meta">
                <span>32 / 100 sent</span>
              </div>
              <div className="pipe-replies">8 replies</div>
            </div>
          </div>

          <div className="sidebar-footer">
            <Avatar initials={initialsFrom(owner, "Shiv")} color={palette[0]} />
            <div className="owner-picker">
              <label className="owner-picker-label" htmlFor="owner-select">
                Sending as
              </label>
              <select
                id="owner-select"
                className="owner-select"
                value={owner || ""}
                onChange={(e) => setOwner(e.target.value)}
              >
                {ownerChoices.length === 0 && <option value="">Shiv</option>}
                {ownerChoices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>

      <nav className="mobile-nav">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={cx("mobile-nav-item", active === item.id && "active")}
              onClick={() => setActive(item.id)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function PageFrame({ children, pageKey }) {
  return (
    <motion.section
      key={pageKey}
      className="page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.section>
  );
}

/* Wraps placeholder/mock UI: frosts it over and blocks interaction so demo
   data can't be clicked or mistaken for live data. */
function SampleLock({ children, label = "Sample data" }) {
  return (
    <div className="sample-lock">
      {children}
      <div className="sample-lock-veil">
        <span className="sample-lock-tag">
          <Sparkles size={12} /> {label}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   1) Overview
   ============================================================ */
function Overview({ leads = [], loading = false }) {
  const queue = leads.slice(0, 6);
  return (
    <PageFrame pageKey="overview">
      <div className="hub-page-wrap">
        <div className="page-header hero-header">
          <div className="hero-copy">
            <h1>Outreach</h1>
            <p className="lede">
              May 19–25 · 52 messages out, 5 replies in. Reply rate is holding at 9% — Northwind
              and Vela are warm and need same-day follow-up.
            </p>
          </div>
        </div>

        <SampleLock>
          <div className="decision-strip hub-strip">
            {[
              ["Leads sourced", "287", "All-time, Apollo"],
              ["Messages sent", "52", "This week"],
              ["Reply rate", "9%", "5 of 52"],
              ["Meetings booked", "2", "This sprint"],
            ].map(([label, value, note], index) => (
              <motion.div
                className="signal-cell"
                key={label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.28 }}
              >
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{note}</small>
              </motion.div>
            ))}
          </div>
        </SampleLock>

        <section className="panel priority-panel hub-section">
          <div className="panel-title queue-title">
            <div>
              <h2>Today Queue</h2>
              <p>Leads with approved drafts, ready to send.</p>
            </div>
            <span className="pill queue-count">{loading ? "…" : `${queue.length} ready`}</span>
          </div>
          <div className="decision-list">
            {loading && (
              <div className="decision-row" style={{ cursor: "default" }}>
                <span className="decision-id">—</span>
                <div className="decision-copy">
                  <span>Loading leads…</span>
                  <small>Fetching from Notion</small>
                </div>
              </div>
            )}
            {!loading && queue.length === 0 && (
              <div className="decision-row" style={{ cursor: "default" }}>
                <span className="decision-id">—</span>
                <div className="decision-copy">
                  <span>No leads yet</span>
                  <small>Add leads to your Notion database</small>
                </div>
              </div>
            )}
            {queue.map((lead) => (
              <button className="decision-row" key={lead.id}>
                <span className="decision-id">{lead.id}</span>
                <div className="decision-copy">
                  <span>
                    {lead.company} · {lead.contact}
                  </span>
                  <small>{lead.hook}</small>
                </div>
                <div className="decision-meta">
                  <span className="channel-tag">{channelLabel[lead.channel]}</span>
                  <Avatar initials={lead.initials} color={lead.color} size="sm" />
                </div>
              </button>
            ))}
          </div>
        </section>

        <SampleLock>
          <section className="panel priority-panel hub-section">
            <div className="panel-title queue-title">
              <div>
                <h2>Recent Replies</h2>
                <p>Inbound responses from the last 48 hours.</p>
              </div>
              <span className="pill queue-count">{replies.length} new</span>
            </div>
            <div className="decision-list">
              {replies.map((r) => (
                <button className="decision-row" key={r.id}>
                  <span className="decision-id">
                    <span className={cx("status-dot", r.status === "good" ? "done" : "active")} />
                  </span>
                  <div className="decision-copy">
                    <span>{r.contact}</span>
                    <small>{r.snippet}</small>
                  </div>
                  <div className="decision-meta">
                    <span className="channel-tag">{r.time}</span>
                    <Avatar initials={r.initials} color={r.color} size="sm" />
                  </div>
                </button>
              ))}
            </div>
          </section>
        </SampleLock>
      </div>
    </PageFrame>
  );
}

/* ============================================================
   2) Lead Queue
   ============================================================ */
const filters = ["All", "InMail", "LinkedIn", "Email"];

function LeadQueue({ leads = [], loading = false, error = null, onDraft }) {
  const [filter, setFilter] = useState("All");
  const [checked, setChecked] = useState({});
  const visible = leads.filter((l) =>
    filter === "All" ? true : channelLabel[l.channel] === filter
  );

  return (
    <PageFrame pageKey="queue">
      <div className="hub-page-wrap">
        <div className="page-header tight">
          <div>
            <p className="eyebrow">Apollo source · ICP scored</p>
            <h1>Lead Queue</h1>
          </div>
          <span className="pill queue-count" style={{ height: 22, fontSize: 12 }}>
            {loading ? "…" : `${visible.length} leads`}
          </span>
        </div>

        <div className="filter-bar">
          <div className="seg-group">
            {filters.map((f) => (
              <button
                key={f}
                className={cx("seg", filter === f && "active")}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="hub-search">
            <Search size={14} />
            <input placeholder="Search company or contact…" />
          </div>
        </div>

        <div className="lead-table">
          <div className="lead-head">
            <span />
            <span>ID</span>
            <span>Company</span>
            <span>Contact</span>
            <span>ICP fit</span>
            <span>Source</span>
            <span>Channel</span>
            <span />
          </div>
          {loading && <div className="lead-empty">Loading leads from Notion…</div>}
          {!loading && error && <div className="lead-empty error">{error}</div>}
          {!loading && !error && visible.length === 0 && (
            <div className="lead-empty">No leads match this filter.</div>
          )}
          {visible.map((lead) => (
            <div
              key={lead.id}
              className={cx("lead-row", checked[lead.id] && "selected")}
            >
              <input
                type="checkbox"
                checked={!!checked[lead.id]}
                onChange={() =>
                  setChecked((c) => ({ ...c, [lead.id]: !c[lead.id] }))
                }
              />
              <span className="lead-id">{lead.id}</span>
              <span className="lead-company">{lead.company}</span>
              <div className="lead-contact">
                <strong>{lead.contact}</strong>
                <small>{lead.role}</small>
              </div>
              <span className={cx("icp", lead.icp)}>
                {lead.icp === "high" ? "High" : lead.icp === "med" ? "Med" : "Low"}
              </span>
              <span className="source-tag">Apollo</span>
              <span className={cx("chip", lead.channel)}>{channelLabel[lead.channel]}</span>
              <button className="draft-btn" onClick={() => onDraft(lead.id)}>
                Draft
              </button>
            </div>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

/* Pull unique source domains out of the research dossier text so we can
   show favicon chips (like a research view). The dossier cites URLs inline. */
function extractSources(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s)\]}"'>]+/g) || [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:]+$/, ""); // trim trailing punctuation
    try {
      const host = new URL(cleaned).hostname.replace(/^www\./, "");
      if (host && !seen.has(host)) {
        seen.add(host);
        out.push({ host, url: cleaned });
      }
    } catch {
      /* ignore malformed URLs */
    }
  }
  return out.slice(0, 12);
}

/* Whitespace-insensitive comparison: did the human meaningfully edit the draft? */
function meaningfullyDiffers(a, b) {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  return norm(a) !== norm(b);
}

/* Pull a single "LABEL: value" line out of the dossier text. */
function parseDossierField(text, label) {
  if (!text) return "";
  const m = text.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : "";
}

/* CSS pill class for a CONTACT TYPE value. */
function contactTypeClass(type) {
  const t = (type || "").toLowerCase();
  if (t.includes("founder") || t.includes("exec")) return "high";
  if (t.includes("connector")) return "med";
  return "low";
}

/* ============================================================
   3) Drafts — split review screen
   ============================================================ */
/* Split a message into paragraph nodes for the preview. */
function MessageParas({ text, emptyHint }) {
  const paras = (text || "")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (paras.length === 0) return <p className="rp-empty">{emptyHint}</p>;
  return paras.map((p, i) => <p key={i}>{p}</p>);
}

/* Recipient avatar: real photo when we have one, else colored initials. */
function PhotoAvatar({ photoUrl, initials, color, size = 44 }) {
  if (photoUrl) {
    return (
      <img
        className="rp-photo"
        src={photoUrl}
        alt=""
        style={{ width: size, height: size }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }
  return (
    <span
      className="rp-photo rp-photo-initials"
      style={{ width: size, height: size, background: color }}
    >
      {initials}
    </span>
  );
}

/* "How it lands in their inbox" — a recipient-styled preview of the message.
   LinkedIn/InMail render as a DM thread; email renders as a mail client. */
function RecipientPreview({ lead, text, owner, photoUrl }) {
  const ownerName = owner || "Shiv";
  const ownerInitials = initialsFrom(ownerName, "Shiv");
  const emptyHint = "No message yet — generate or write one to preview it.";

  if (lead.channel === "email") {
    const domain = (() => {
      try {
        return lead.companyUrl ? new URL(lead.companyUrl).hostname.replace(/^www\./, "") : "";
      } catch {
        return "";
      }
    })();
    const toAddr = domain
      ? `${(lead.contact || "there").split(/\s+/)[0].toLowerCase()}@${domain}`
      : lead.contact || "recipient";
    return (
      <div className="rp-card rp-email">
        <div className="rp-email-chrome">
          <span className="rp-dots"><i /><i /><i /></span>
          <span className="rp-email-chrome-subject">Outreach from {ownerName}</span>
          <Mail size={13} style={{ marginLeft: "auto", opacity: 0.5 }} />
        </div>
        <div className="rp-email-meta">
          <div><span>From</span> {ownerName}</div>
          <div><span>To</span> {lead.contact || "Recipient"} &lt;{toAddr}&gt;</div>
        </div>
        <div className="rp-email-body">
          <MessageParas text={text} emptyHint={emptyHint} />
        </div>
        <div className="rp-email-foot">Sent via Agilow</div>
      </div>
    );
  }

  // LinkedIn / InMail thread
  const channelTag = lead.channel === "inmail" ? "InMail" : "LinkedIn";
  return (
    <div className="rp-card rp-linkedin">
      <div className="rp-li-head">
        <PhotoAvatar
          photoUrl={photoUrl}
          initials={lead.initials}
          color={lead.color}
          size={44}
        />
        <div className="rp-li-id">
          <strong>{lead.contact || lead.company}</strong>
          <small>{lead.role || lead.company}</small>
        </div>
        <span className="rp-li-badge">in</span>
      </div>
      <div className="rp-li-thread">
        <div className="rp-li-day">{channelTag} · Today</div>
        <div className="rp-li-msg">
          <Avatar initials={ownerInitials} color={palette[0]} size="sm" />
          <div className="rp-li-bubble-wrap">
            <div className="rp-li-byline">
              <strong>{ownerName}</strong>
              <span>now</span>
            </div>
            <div className="rp-li-bubble">
              <MessageParas text={text} emptyHint={emptyHint} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Drafts({
  leads = [],
  loading = false,
  selectedId,
  setSelectedId,
  updateLead,
  owner,
  autoDraftIds,
  onAutoDraftDone,
}) {
  const selected = leads.find((l) => l.id === selectedId) ?? leads[0] ?? null;

  const [text, setText] = useState(selected?.draft ?? "");
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState(null);
  const [showResearch, setShowResearch] = useState(false);
  // Edit-reason confirmation step.
  const [explaining, setExplaining] = useState(false);
  const [showReasonPanel, setShowReasonPanel] = useState(false);
  const [reasonText, setReasonText] = useState("");

  // Best-effort recipient photo for the preview (LinkedIn usually fails -> null).
  const [photoUrl, setPhotoUrl] = useState(null);

  // Reset the textarea (and clear transient errors) when switching leads.
  // Approve & Send persists first, so switching no longer loses saved edits.
  useEffect(() => {
    setText(selected?.draft ?? "");
    setResearchError(null);
    setApproveError(null);
    setShowResearch(false);
    setShowReasonPanel(false);
    setReasonText("");
  }, [selected?.id]);

  // Fetch the recipient's photo when the selection changes; null on any miss.
  useEffect(() => {
    setPhotoUrl(null);
    if (!selected?.linkedin) return;
    let alive = true;
    fetch(apiUrl("/api/photo"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedinUrl: selected.linkedin }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setPhotoUrl(d?.photoUrl || null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selected?.id, selected?.linkedin]);

  // Bulk "Draft all" queue state — drafts every lead that has no draft yet,
  // one at a time (research is heavy: ~7 web-search calls per lead), mirroring
  // the sequential queue on the Qualify screen.
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  // Research + draft a single lead and persist to Notion. Shared by the single
  // and bulk paths. Returns the { draft, research } payload or throws.
  async function researchLead(lead) {
    const res = await fetch(apiUrl("/api/research"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notionPageId: lead.notionPageId, owner: owner || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Research failed");
    updateLead(lead.id, {
      draft: data.draft,
      aiDraft: data.draft, // the freshly generated text is the AI original
      research: data.research ?? "",
      status: "drafted",
    });
    return data;
  }

  async function runResearch() {
    if (!selected) return;
    const prevStatus = selected.status; // restore this if it fails (regenerate case)
    setResearching(true);
    setResearchError(null);
    updateLead(selected.id, { status: "researching" }); // optimistic
    try {
      const data = await researchLead(selected);
      setText(data.draft);
    } catch (e) {
      setResearchError(e.message);
      updateLead(selected.id, { status: prevStatus });
    } finally {
      setResearching(false);
    }
  }

  // Draft a set of leads sequentially (research is heavy: ~7 web-search calls
  // each), so we don't hammer the API. Per-lead failures are skipped (status
  // reset to "new") so one bad lead doesn't stop the run.
  async function runBulk(targets) {
    if (bulkRunning || !targets || targets.length === 0) return;
    setBulkRunning(true);
    setResearchError(null);
    setBulkProgress({ done: 0, total: targets.length });
    for (const lead of targets) {
      updateLead(lead.id, { status: "researching" });
      try {
        const data = await researchLead(lead);
        if (lead.id === selected?.id) setText(data.draft); // sync open textarea
      } catch {
        updateLead(lead.id, { status: "new" });
      }
      setBulkProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setBulkRunning(false);
  }

  // "Draft all" on this screen: every lead with no draft yet.
  function runResearchAll() {
    return runBulk(leads.filter((l) => !l.draft && l.status !== "approved"));
  }

  // Auto-generate when arriving from Qualify "Draft all": draft exactly the
  // leads whose page ids were handed over, once, then clear the trigger.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (!autoDraftIds || autoDraftIds.length === 0) {
      autoRanRef.current = false;
      return;
    }
    if (autoRanRef.current || bulkRunning || loading) return;
    autoRanRef.current = true;
    const targets = leads.filter(
      (l) => autoDraftIds.includes(l.notionPageId) && !l.draft && l.status !== "approved"
    );
    (async () => {
      if (targets.length) await runBulk(targets);
      onAutoDraftDone && onAutoDraftDone();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDraftIds, loading]);

  // "Approve & Send": if the human meaningfully edited the AI original, ask the
  // AI to propose a reason and surface the confirm panel first; otherwise approve
  // straight away.
  async function startApprove() {
    if (!selected) return;
    setApproveError(null);
    const aiOriginal = selected.aiDraft || selected.draft || "";
    if (!meaningfullyDiffers(text, aiOriginal)) {
      await doApprove(null);
      return;
    }
    setExplaining(true);
    let proposed = "";
    try {
      const res = await fetch(apiUrl("/api/explain-edit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiDraft: aiOriginal, humanEdited: text }),
      });
      const data = await res.json();
      if (res.ok) proposed = data.reason || "";
    } catch {
      /* fall through: panel still opens so the human can write the reason */
    } finally {
      setExplaining(false);
    }
    setReasonText(proposed);
    setShowReasonPanel(true);
  }

  // The actual write. editReason is null when the human skipped the reason step.
  async function doApprove(editReason) {
    if (!selected) return;
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(apiUrl("/api/approve"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notionPageId: selected.notionPageId,
          draft: text,
          ...(editReason && editReason.trim() ? { editReason: editReason.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approve failed");
      updateLead(selected.id, { draft: text, status: "approved" });
      setShowReasonPanel(false);
    } catch (e) {
      setApproveError(e.message);
    } finally {
      setApproving(false);
    }
  }

  const needsResearch = selected && !selected.draft;
  const draftableCount = leads.filter((l) => !l.draft && l.status !== "approved").length;
  const approved = selected?.status === "approved";
  const sources = selected ? extractSources(selected.research) : [];
  const contactType = selected ? parseDossierField(selected.research, "CONTACT TYPE") : "";
  const contactTypeShort = contactType.split(/—|\s-\s/)[0].trim();
  const suggestedIntent = selected ? parseDossierField(selected.research, "SUGGESTED INTENT") : "";

  return (
    <PageFrame pageKey="drafts">
      <div className="page-header tight" style={{ marginBottom: 16 }}>
        <div>
          <p className="eyebrow">{loading ? "Loading…" : `${leads.length} drafts pending review`}</p>
          <h1>Drafts</h1>
        </div>
        {draftableCount > 0 && (
          <button
            className="btn-secondary"
            style={{ marginLeft: "auto" }}
            disabled={bulkRunning || loading}
            onClick={runResearchAll}
          >
            {bulkRunning ? (
              <>
                <RefreshCw size={13} className="spin" style={{ marginRight: 5 }} />
                Drafting {bulkProgress.done}/{bulkProgress.total}…
              </>
            ) : (
              `Draft all (${draftableCount})`
            )}
          </button>
        )}
      </div>

      <div className="draft-split">
        <div className="draft-list">
          <div className="draft-list-head">
            {loading ? "Loading…" : `Pending review · ${leads.length}`}
          </div>
          {leads.map((lead) => (
            <button
              key={lead.id}
              className={cx("draft-item", lead.id === selected?.id && "active")}
              onClick={() => setSelectedId(lead.id)}
            >
              <Avatar initials={lead.initials} color={lead.color} size="sm" />
              <div className="draft-item-copy">
                <strong>{lead.contact || lead.company}</strong>
                <small>{lead.company} · {lead.hook || "Not researched yet"}</small>
              </div>
              <span className={cx("chip", lead.channel)}>{channelLabel[lead.channel]}</span>
            </button>
          ))}
        </div>

        {!selected ? (
          <div className="draft-panel">
            <div className="draft-empty">
              {loading ? "Loading leads from Notion…" : "No leads in the queue."}
            </div>
          </div>
        ) : (
          <div className="draft-panel">
            <div className="draft-panel-head">
              <Avatar initials={selected.initials} color={selected.color} />
              <div className="dp-main">
                <strong>
                  {selected.contact || selected.company}
                  {selected.role ? ` · ${selected.role}` : ""}
                </strong>
                <small>{selected.company}</small>
              </div>
              <span className={cx("chip", selected.channel)} style={{ marginLeft: "auto" }}>
                {channelLabel[selected.channel]}
              </span>
            </div>

            <div className="draft-body">
              {(contactTypeShort || suggestedIntent) && (
                <div className="intent-strip">
                  {contactTypeShort && (
                    <span className={cx("icp", contactTypeClass(contactType))} title={contactType}>
                      {contactTypeShort}
                    </span>
                  )}
                  {suggestedIntent && <span className="intent-line">{suggestedIntent}</span>}
                </div>
              )}

              <div className="draft-compose">
                <div className="compose-editor">
              <div className="field-label">
                <span>Message</span>
                <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--quiet)" }}>
                  {text.length} chars
                </span>
              </div>
              <textarea
                className="draft-textarea"
                value={text}
                placeholder={
                  needsResearch
                    ? "No draft yet — run Research & draft to generate a personalized message."
                    : ""
                }
                onChange={(e) => setText(e.target.value)}
              />

              {selected.channel === "inmail" && (
                <div className="sales-nav-note">Sends from Shiv&apos;s Sales Navigator</div>
              )}

              {needsResearch ? (
                <div className="draft-actions">
                  <button className="btn-secondary" disabled={researching || bulkRunning} onClick={runResearch}>
                    {researching ? "Researching…" : "Research & draft"}
                  </button>
                </div>
              ) : (
                <div className="draft-actions">
                  <button
                    className="btn-send"
                    disabled={approving || approved || researching || explaining || bulkRunning}
                    onClick={startApprove}
                  >
                    {approved
                      ? "Approved ✓"
                      : explaining
                      ? "Analyzing edit…"
                      : approving
                      ? "Saving…"
                      : "Approve & Send"}
                  </button>
                  <button className="btn-secondary" disabled={researching || bulkRunning} onClick={runResearch}>
                    <RefreshCw
                      size={13}
                      className={researching ? "spin" : undefined}
                      style={{ marginRight: 5 }}
                    />
                    {researching ? "Regenerating…" : "Regenerate"}
                  </button>
                  <button className="btn-ghost">Skip</button>
                </div>
              )}

              {showReasonPanel && (
                <div className="reason-panel">
                  <label className="reason-label" htmlFor="edit-reason">
                    Why did you change this? <span>helps the AI learn your preferences</span>
                  </label>
                  <input
                    id="edit-reason"
                    className="reason-input"
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    placeholder="e.g. Made it more formal and removed the assumed familiarity"
                    autoFocus
                  />
                  <div className="reason-actions">
                    <button
                      className="btn-send"
                      disabled={approving}
                      onClick={() => doApprove(reasonText)}
                    >
                      {approving ? "Saving…" : "Confirm & Approve"}
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={approving}
                      onClick={() => doApprove(null)}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )}

              {researchError && <div className="draft-error">{researchError}</div>}
              {approveError && <div className="draft-error">{approveError}</div>}

              {selected.research && (
                <div className="research-disclosure">
                  <button
                    type="button"
                    className="research-toggle"
                    onClick={() => setShowResearch((v) => !v)}
                  >
                    <ChevronRight
                      size={14}
                      style={{
                        transform: showResearch ? "rotate(90deg)" : "none",
                        transition: "transform 120ms var(--ease)",
                      }}
                    />
                    Research &amp; sources
                    {sources.length > 0 && (
                      <span className="research-count">{sources.length}</span>
                    )}
                  </button>

                  {sources.length > 0 && (
                    <div className="source-chips">
                      {sources.map((s) => (
                        <a
                          key={s.host}
                          className="source-chip"
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          title={s.host}
                        >
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${s.host}&sz=64`}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                          <span>{s.host}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  {showResearch && <div className="research-body">{selected.research}</div>}
                </div>
              )}
                </div>

                <div className="compose-preview">
                  <div className="field-label">
                    <span>Recipient preview</span>
                    <span
                      className={cx("chip", selected.channel)}
                      style={{ textTransform: "none", letterSpacing: 0 }}
                    >
                      {channelLabel[selected.channel]}
                    </span>
                  </div>
                  <RecipientPreview
                    lead={selected}
                    text={text}
                    owner={owner}
                    photoUrl={photoUrl}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageFrame>
  );
}

/* Parse pasted lines: "Name, Company" or "Name, Company, LinkedInURL". */
function parseLeadLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const parts = line.split(",").map((p) => p.trim());
      const name = parts[0] || "";
      const company = parts[1] || "";
      const third = parts[2] || "";
      const linkedinUrl = third.startsWith("http") ? third : "";
      return { id: `q-${i}-${name}-${company}`, name, company, linkedinUrl };
    })
    .filter((l) => l.name || l.company);
}

function verdictIcpClass(verdict) {
  if (!verdict) return "med";
  if (/strong/i.test(verdict)) return "high";
  if (/weak/i.test(verdict)) return "low";
  return "med";
}

function verdictRank(verdict) {
  if (!verdict) return 9;
  if (/strong/i.test(verdict)) return 0;
  if (/moderate/i.test(verdict)) return 1;
  return 2;
}

const KEY_FACT_LABELS = {
  company: "Company",
  funding: "Funding",
  headcount: "Headcount",
  stage: "Stage",
  hiring: "Hiring",
  recentActivity: "Recent activity",
};

/* ============================================================
   Qualify — paste leads, score-only ICP fit, optional CRM / draft
   ============================================================ */
function Qualify({ onOpenDraft, onRefreshLeads, onDraftAll, input, setInput, rows, setRows, owner }) {
  // `input` and `rows` are lifted into <Hub> (and persisted) so qualified leads
  // survive navigating to another tab and back. `running`/`batchError` are
  // transient per-mount UI state and stay local.
  const [running, setRunning] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [draftingAll, setDraftingAll] = useState(false);
  const [batchError, setBatchError] = useState(null);

  const patchRow = (id, patch) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Smart-parse the pasted text via the LLM so URLs land in the right field;
  // fall back to naive comma-splitting if the API call fails.
  async function parseInput() {
    try {
      const res = await fetch(apiUrl("/api/parse-leads"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.leads) && data.leads.length) {
        return data.leads.map((l, i) => ({
          id: `q-${i}-${(l.name || "").slice(0, 12)}-${(l.company || "").slice(0, 12)}`,
          name: l.name || "",
          company: l.company || "",
          linkedinUrl: l.linkedinUrl || "",
          companyUrl: l.companyUrl || "",
        }));
      }
    } catch {
      /* fall through to naive parser */
    }
    return parseLeadLines(input);
  }

  async function runQualify() {
    if (!input.trim()) return;

    setBatchError(null);
    setRunning(true);
    setParsing(true);
    const leads = await parseInput();
    setParsing(false);
    if (leads.length === 0) {
      setRunning(false);
      return;
    }
    setRows(
      leads.map((l) => ({
        ...l,
        status: "pending",
        result: null,
        error: null,
        expanded: false,
        notionPageId: null,
        crmAdded: false,
        crmLoading: false,
        draftLoading: false,
        crmMessage: null,
      }))
    );

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      patchRow(lead.id, { status: "qualifying" });
      try {
        const res = await fetch(apiUrl("/api/qualify"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: lead.name,
            company: lead.company,
            linkedinUrl: lead.linkedinUrl || undefined,
            companyUrl: lead.companyUrl || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Qualify failed");
        patchRow(lead.id, { status: "done", result: data });
      } catch (e) {
        patchRow(lead.id, { status: "error", error: e.message });
      }
    }

    setRunning(false);
  }

  async function addToCrm(row) {
    patchRow(row.id, { crmLoading: true, crmMessage: null });
    try {
      const res = await fetch(apiUrl("/api/add-to-crm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: row.name,
          company: row.company,
          linkedinUrl: row.linkedinUrl || undefined,
          companyUrl: row.companyUrl || undefined,
          verdict: row.result?.verdict,
          dossier: row.result?.dossier,
          owner: owner || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Add to CRM failed");
      patchRow(row.id, {
        crmLoading: false,
        crmAdded: true,
        notionPageId: data.notionPageId,
        crmMessage: "Added to CRM",
      });
      if (onRefreshLeads) await onRefreshLeads();
      return data.notionPageId;
    } catch (e) {
      patchRow(row.id, { crmLoading: false, crmMessage: e.message });
      throw e;
    }
  }

  async function handleAddToCrm(row) {
    if (row.crmAdded || row.crmLoading) return;
    try {
      await addToCrm(row);
    } catch {
      /* message shown on row */
    }
  }

  async function handleDraft(row) {
    if (row.draftLoading || row.status !== "done") return;
    patchRow(row.id, { draftLoading: true });
    try {
      let pageId = row.notionPageId;
      if (!pageId) {
        pageId = await addToCrm(row);
      }
      if (pageId && onOpenDraft) await onOpenDraft(pageId);
    } catch {
      /* crmMessage surfaces on row */
    } finally {
      patchRow(row.id, { draftLoading: false });
    }
  }

  // Draft for EVERY scored lead on this screen: add each to the CRM, then jump
  // to the Drafts window and auto-generate all of them there.
  const doneRows = rows.filter((r) => r.status === "done");
  async function draftAll() {
    if (draftingAll || doneRows.length === 0) return;
    setDraftingAll(true);
    const pageIds = [];
    for (const row of doneRows) {
      try {
        const pid = row.notionPageId || (await addToCrm(row));
        if (pid) pageIds.push(pid);
      } catch {
        /* per-row crmMessage already surfaced; keep going */
      }
    }
    setDraftingAll(false);
    if (pageIds.length && onDraftAll) onDraftAll(pageIds);
  }

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const ra = verdictRank(a.result?.verdict);
        const rb = verdictRank(b.result?.verdict);
        if (ra !== rb) return ra - rb;
        return (a.name || a.company).localeCompare(b.name || b.company);
      }),
    [rows]
  );

  const doneCount = rows.filter((r) => r.status === "done" || r.status === "error").length;

  return (
    <PageFrame pageKey="qualify">
      <div className="hub-page-wrap qualify-page">
        <div className="page-header tight">
          <div>
            <p className="eyebrow">ICP qualification</p>
            <h1>Qualify</h1>
          </div>
          {rows.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
              <span className="pill queue-count" style={{ height: 22, fontSize: 12 }}>
                {running ? `${doneCount} / ${rows.length}` : `${rows.filter((r) => r.status === "done").length} scored`}
              </span>
              {doneRows.length > 0 && (
                <button
                  className="btn-send"
                  style={{ height: 30 }}
                  disabled={draftingAll || running}
                  onClick={draftAll}
                >
                  {draftingAll ? (
                    <>
                      <RefreshCw size={13} className="spin" style={{ marginRight: 5 }} />
                      Preparing…
                    </>
                  ) : (
                    `Draft all (${doneRows.length})`
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="qualify-card">
          <div className="panel-title">
            <div>
              <h2>Paste leads</h2>
              <p>Anything goes — names, companies, or LinkedIn / website URLs. AI sorts it out.</p>
            </div>
          </div>
          <textarea
            className="qualify-textarea"
            placeholder={"Banks Hunter, Charge Robotics\nhttps://www.linkedin.com/in/jeffrey-martin\nEyal Cohen — Humble Robotics — humble.inc"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={running}
          />
          <div className="qualify-actions">
            <button
              className="btn-secondary"
              disabled={running || !input.trim()}
              onClick={runQualify}
            >
              {parsing ? (
                <>
                  <RefreshCw size={13} className="spin" style={{ marginRight: 5 }} />
                  Formatting…
                </>
              ) : running ? (
                <>
                  <RefreshCw size={13} className="spin" style={{ marginRight: 5 }} />
                  Qualifying…
                </>
              ) : (
                "Qualify"
              )}
            </button>
            {batchError && <span className="qualify-batch-error">{batchError}</span>}
          </div>
        </div>

        {sortedRows.length > 0 && (
          <div className="qualify-results">
            {sortedRows.map((row) => {
              const verdict = row.result?.verdict;
              const icpClass = verdictIcpClass(verdict);
              const sources = row.result?.dossier ? extractSources(row.result.dossier) : [];

              return (
                <div
                  key={row.id}
                  className={cx(
                    "qualify-row",
                    row.status === "qualifying" && "qualifying",
                    row.status === "error" && "errored"
                  )}
                >
                  <div className="qualify-row-head">
                    <div className="qualify-row-identity">
                      <strong>{row.name || "—"}</strong>
                      <small>{row.company || "—"}</small>
                    </div>

                    {row.status === "pending" && (
                      <span className="qualify-status-pill pending">Queued</span>
                    )}
                    {row.status === "qualifying" && (
                      <span className="qualify-status-pill running">
                        <RefreshCw size={11} className="spin" /> Researching…
                      </span>
                    )}
                    {row.status === "error" && (
                      <span className="qualify-status-pill error">Failed</span>
                    )}
                    {row.status === "done" && (
                      <span className={cx("icp", icpClass)}>{verdict}</span>
                    )}

                    {row.status === "done" && (
                      <div className="qualify-row-actions">
                        <button
                          className="draft-btn"
                          disabled={row.crmLoading || row.crmAdded}
                          onClick={() => handleAddToCrm(row)}
                        >
                          {row.crmLoading ? "Adding…" : row.crmAdded ? "In CRM ✓" : "Add to CRM"}
                        </button>
                        <button
                          className="draft-btn qualify-draft-btn"
                          disabled={row.draftLoading}
                          onClick={() => handleDraft(row)}
                        >
                          {row.draftLoading ? "Opening…" : "Draft"}
                        </button>
                      </div>
                    )}
                  </div>

                  {row.status === "error" && (
                    <div className="qualify-error">{row.error}</div>
                  )}

                  {row.status === "done" && row.result?.reasoning && (
                    <p className="qualify-reason">{row.result.reasoning}</p>
                  )}

                  {row.status === "done" &&
                    (row.result?.contactType || row.result?.suggestedIntent) && (
                      <div className="intent-strip qualify-intent">
                        {row.result?.contactType && (
                          <span className={cx("icp", contactTypeClass(row.result.contactType))}>
                            {row.result.contactType}
                          </span>
                        )}
                        {row.result?.suggestedIntent && (
                          <span className="intent-line">{row.result.suggestedIntent}</span>
                        )}
                      </div>
                    )}

                  {row.crmMessage && (
                    <div className={cx("qualify-crm-msg", row.crmAdded && "ok")}>
                      {row.crmMessage}
                    </div>
                  )}

                  {row.status === "done" && row.result && (
                    <div className="research-disclosure qualify-disclosure">
                      <button
                        type="button"
                        className="research-toggle"
                        onClick={() => patchRow(row.id, { expanded: !row.expanded })}
                      >
                        <ChevronRight
                          size={14}
                          style={{
                            transform: row.expanded ? "rotate(90deg)" : "none",
                            transition: "transform 120ms var(--ease)",
                          }}
                        />
                        ICP checks &amp; research
                        {(row.result.checks || []).length > 0 && (
                          <span className="research-count">{row.result.checks.length}</span>
                        )}
                      </button>

                      {row.expanded && (
                        <>
                          {(row.result.checks || []).length > 0 && (
                            <ul className="qualify-checks">
                              {(row.result.checks || []).map((c) => (
                                <li key={c.criterion} className={cx("qualify-check", c.value)}>
                                  <span className="qualify-check-val">
                                    {/* extractVerdict's schema types `value` as the
                                        STRINGS "true"/"false"/"unknown", not booleans. */}
                                    {c.value === "true"
                                      ? "Yes"
                                      : c.value === "false"
                                        ? "No"
                                        : "?"}
                                  </span>
                                  <div className="qualify-check-copy">
                                    <strong>{c.criterion}</strong>
                                    {c.evidence && <small>{c.evidence}</small>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}

                          {row.result.keyFacts && Object.keys(row.result.keyFacts).length > 0 && (
                            <dl className="qualify-facts">
                              {Object.entries(row.result.keyFacts).map(([key, val]) =>
                                val ? (
                                  <div key={key} className="qualify-fact">
                                    <dt>{KEY_FACT_LABELS[key] || key}</dt>
                                    <dd>{val}</dd>
                                  </div>
                                ) : null
                              )}
                            </dl>
                          )}

                          {sources.length > 0 && (
                            <div className="source-chips">
                              {sources.map((s) => (
                                <a
                                  key={s.host}
                                  className="source-chip"
                                  href={s.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={s.host}
                                >
                                  <img
                                    src={`https://www.google.com/s2/favicons?domain=${s.host}&sz=64`}
                                    alt=""
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                    }}
                                  />
                                  <span>{s.host}</span>
                                </a>
                              ))}
                            </div>
                          )}

                          {row.result.dossier && (
                            <div className="research-body">{row.result.dossier}</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageFrame>
  );
}

/* ============================================================
   4) Sent
   ============================================================ */
function Sent() {
  return (
    <PageFrame pageKey="sent">
      <div className="hub-page-wrap">
        <div className="page-header tight">
          <div>
            <p className="eyebrow">Last 7 days</p>
            <h1>Sent</h1>
          </div>
          <span className="pill queue-count" style={{ height: 22, fontSize: 12 }}>
            {sent.length} messages
          </span>
        </div>

        <SampleLock>
          <div className="list-card">
            {sent.map((m) => (
              <div className="sent-row" key={m.id + m.time}>
                <span className="lead-id">{m.id}</span>
                <div className="lead-contact">
                  <strong>{m.contact}</strong>
                  <small>{m.company}</small>
                </div>
                <span className={cx("chip", m.channel)}>{channelLabel[m.channel]}</span>
                <span className="sent-time">{m.time}</span>
                <span className={cx("dpill", m.status)}>
                  {m.status[0].toUpperCase() + m.status.slice(1)}
                </span>
              </div>
            ))}
          </div>
        </SampleLock>
      </div>
    </PageFrame>
  );
}

/* ============================================================
   5) Replies
   ============================================================ */
function Replies() {
  return (
    <PageFrame pageKey="replies">
      <div className="hub-page-wrap">
        <div className="page-header tight">
          <div>
            <p className="eyebrow">Needs action</p>
            <h1>Replies</h1>
          </div>
          <span className="pill queue-count" style={{ height: 22, fontSize: 12 }}>
            {replies.length} replies
          </span>
        </div>

        <SampleLock>
          <div className="list-card">
            {replies.map((r) => (
              <div className="reply-row" key={r.id}>
                <span className={cx("status-dot", r.status === "good" ? "done" : "active")} />
                <div className="reply-copy">
                  <strong>
                    {r.contact} · {r.company}
                  </strong>
                  <small>{r.snippet}</small>
                </div>
                <span className="channel-tag">{channelLabel[r.channel]}</span>
                <div className="reply-actions">
                  <button className="btn-pos">Book call</button>
                  <button className="btn-mark">Mark positive</button>
                </div>
              </div>
            ))}
          </div>
        </SampleLock>
      </div>
    </PageFrame>
  );
}

/* ============================================================
   6) Settings
   ============================================================ */
function Settings() {
  const [toggles, setToggles] = useState({
    salesNav: true,
    teamLinkedin: true,
    email: false,
    autoSignal: true,
  });
  const flip = (k) => setToggles((t) => ({ ...t, [k]: !t[k] }));

  return (
    <PageFrame pageKey="settings">
      <div className="page-header tight">
        <div>
          <p className="eyebrow">Outreach configuration</p>
          <h1>Settings</h1>
        </div>
      </div>

      <SampleLock>
        <div className="settings-wrap">
        <div className="settings-card">
          <div className="panel-title">
            <div>
              <h2>Sending accounts</h2>
              <p>Channels Agilow can send from on your behalf.</p>
            </div>
          </div>
          <div className="set-row">
            <Avatar initials="SP" color={palette[0]} size="sm" />
            <div className="set-copy">
              <strong>Shiv&apos;s Sales Navigator</strong>
              <small>InMail · connected</small>
            </div>
            <div className={cx("toggle", toggles.salesNav && "on")} onClick={() => flip("salesNav")} />
          </div>
          <div className="set-row">
            <Avatar initials="AG" color={palette[2]} size="sm" />
            <div className="set-copy">
              <strong>Agilow team LinkedIn</strong>
              <small>LinkedIn · connected</small>
            </div>
            <div className={cx("toggle", toggles.teamLinkedin && "on")} onClick={() => flip("teamLinkedin")} />
          </div>
          <div className="set-row">
            <Avatar initials="@" color={palette[3]} size="sm" />
            <div className="set-copy">
              <strong>outbound@agilow.ai</strong>
              <small>Email · domain not verified</small>
            </div>
            <div className={cx("toggle", toggles.email && "on")} onClick={() => flip("email")} />
          </div>
        </div>

        <div className="settings-card">
          <div className="panel-title">
            <div>
              <h2>Daily limits</h2>
              <p>Caps applied per channel to protect deliverability.</p>
            </div>
          </div>
          <div className="set-row">
            <span style={{ width: 21 }} />
            <div className="set-copy">
              <strong>InMail per day</strong>
              <small>Recommended max for Sales Navigator</small>
            </div>
            <input className="set-input" defaultValue="20" />
          </div>
          <div className="set-row">
            <span style={{ width: 21 }} />
            <div className="set-copy">
              <strong>LinkedIn connects per day</strong>
              <small>Connection requests across team accounts</small>
            </div>
            <input className="set-input" defaultValue="25" />
          </div>
        </div>

        <div className="settings-card">
          <div className="panel-title">
            <div>
              <h2>Signals</h2>
              <p>Sources Agilow uses to personalize each message.</p>
            </div>
          </div>
          <div className="set-row">
            <Sparkles size={18} color="var(--coral)" />
            <div className="set-copy">
              <strong>Auto-detect hiring &amp; funding signals</strong>
              <small>Pulls from Apollo + LinkedIn activity</small>
            </div>
            <div className={cx("toggle", toggles.autoSignal && "on")} onClick={() => flip("autoSignal")} />
          </div>
        </div>
        </div>
      </SampleLock>
    </PageFrame>
  );
}

/* ============================================================
   Splash — same loading screen as the main product.
   ============================================================ */
function SplashLoadingDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 500);
    return () => clearInterval(id);
  }, []);
  return <span>{dots}</span>;
}

function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setPhase(1), 2200);
    return () => clearTimeout(t);
  }, []);
  return (
    <motion.div
      className="splash"
      animate={phase === 2 ? { clipPath: "inset(0 calc(100% - 218px) 0 0)" } : { clipPath: "inset(0 0% 0 0)" }}
      transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={() => {
        if (phase === 2) onDone();
      }}
    >
      <AnimatedBackground />
      <motion.div
        className="splash-inner"
        animate={phase >= 1 ? { opacity: 0, y: -110 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => {
          if (phase === 1) setPhase(2);
        }}
      >
        <img src="/agi2-nobg.png" className="splash-logo" />
        <motion.p
          className="splash-loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          Loading Hub<SplashLoadingDots />
        </motion.p>
      </motion.div>
    </motion.div>
  );
}

/* ============================================================
   Root
   ============================================================ */
export default function Hub() {
  const [splash, setSplash] = useState(
    () => !(typeof window !== "undefined" && window.location.search.includes("nosplash"))
  );
  const [active, setActive] = useState(() => {
    const h = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    return nav.some((n) => n.id === h) ? h : "overview";
  });
  const [selectedDraftId, setSelectedDraftId] = useState(null);

  // ---- Qualify screen state, lifted here so it survives tab switches ----
  // The Qualify component unmounts when you leave its tab; keeping its pasted
  // input and qualified rows here (and mirrored to localStorage) means the
  // scored leads persist across navigation and page reloads.
  const [qualifyInput, setQualifyInput] = useState(() => {
    try {
      return localStorage.getItem("agilow.qualify.input") || "";
    } catch {
      return "";
    }
  });
  const [qualifyRows, setQualifyRows] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("agilow.qualify.rows") || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("agilow.qualify.input", qualifyInput);
    } catch {
      /* storage unavailable (private mode / quota) — persistence is best-effort */
    }
  }, [qualifyInput]);
  useEffect(() => {
    try {
      localStorage.setItem("agilow.qualify.rows", JSON.stringify(qualifyRows));
    } catch {
      /* storage unavailable or over quota — keep going with in-memory state */
    }
  }, [qualifyRows]);

  // ---- Owner: who outreach is sent/signed as. Drives the drafting voice and
  // the per-owner edit-learning. Persisted, and editable from the sidebar. ----
  const [owner, setOwner] = useState(() => {
    try {
      return localStorage.getItem("agilow.owner") || "";
    } catch {
      return "";
    }
  });
  const [ownerOptions, setOwnerOptions] = useState([]);
  useEffect(() => {
    try {
      if (owner) localStorage.setItem("agilow.owner", owner);
    } catch {
      /* best-effort */
    }
  }, [owner]);
  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/owners"))
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data?.owners) ? data.owners : [];
        setOwnerOptions(list);
        // Default the selection to the first known owner if none is saved.
        setOwner((prev) => prev || list[0] || "");
      })
      .catch(() => {
        /* selector falls back to whatever is saved / empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  // ---- Data layer: leads come from the Notion CRM via GET /api/leads ----
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState(null);

  // Fetch leads from the CRM; returns the fresh list (also used to refresh
  // after a Qualify -> Add-to-CRM so the new lead can flow into Drafts).
  async function loadLeads() {
    const r = await fetch(apiUrl("/api/leads"));
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || "Failed to load leads");
    const list = Array.isArray(data) ? data : [];
    setLeads(list);
    return list;
  }

  useEffect(() => {
    let alive = true;
    loadLeads()
      .then((list) => {
        if (!alive) return;
        setSelectedDraftId((prev) => prev ?? list[0]?.id ?? null);
        setLeadsLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setLeadsError(err?.message || "Failed to load leads");
        setLeadsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Merge a partial patch into a single lead in state.
  const updateLead = (id, patch) =>
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const openDraft = (id) => {
    setSelectedDraftId(id);
    setActive("drafts");
  };

  // Refetch leads, select the one matching a Notion page id, open Drafts.
  async function openDraftForPage(notionPageId) {
    setActive("drafts");
    try {
      const list = await loadLeads();
      const match = list.find((l) => l.notionPageId === notionPageId);
      setSelectedDraftId(match ? match.id : (prev) => prev ?? list[0]?.id ?? null);
    } catch {
      /* leads error surfaces on the Drafts screen */
    }
  }

  // Qualify "Draft all": leads were just added to the CRM; refresh, open Drafts
  // on the first one, and hand the page ids to Drafts to auto-generate them all.
  const [autoDraftIds, setAutoDraftIds] = useState(null);
  async function draftAllForPages(notionPageIds) {
    setActive("drafts");
    try {
      const list = await loadLeads();
      const first = list.find((l) => notionPageIds.includes(l.notionPageId));
      if (first) setSelectedDraftId(first.id);
      setAutoDraftIds(notionPageIds);
    } catch {
      /* leads error surfaces on the Drafts screen */
    }
  }

  const page = useMemo(() => {
    const pages = {
      overview: <Overview leads={leads} loading={leadsLoading} />,
      qualify: (
        <Qualify
          onOpenDraft={openDraftForPage}
          onRefreshLeads={loadLeads}
          onDraftAll={draftAllForPages}
          input={qualifyInput}
          setInput={setQualifyInput}
          rows={qualifyRows}
          setRows={setQualifyRows}
          owner={owner}
        />
      ),
      queue: <LeadQueue leads={leads} loading={leadsLoading} error={leadsError} onDraft={openDraft} />,
      drafts: (
        <Drafts
          leads={leads}
          loading={leadsLoading}
          selectedId={selectedDraftId}
          setSelectedId={setSelectedDraftId}
          updateLead={updateLead}
          owner={owner}
          autoDraftIds={autoDraftIds}
          onAutoDraftDone={() => setAutoDraftIds(null)}
        />
      ),
      sent: <Sent />,
      replies: <Replies />,
      settings: <Settings />,
    };
    return pages[active] ?? pages.overview;
  }, [active, selectedDraftId, leads, leadsLoading, leadsError, qualifyInput, qualifyRows, owner, autoDraftIds]);

  return (
    <>
      <Shell
        active={active}
        setActive={setActive}
        owner={owner}
        setOwner={setOwner}
        ownerOptions={ownerOptions}
      >
        <AnimatePresence mode="wait">{page}</AnimatePresence>
      </Shell>
      {splash && <SplashScreen onDone={() => setSplash(false)} />}
    </>
  );
}
