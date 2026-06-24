import "dotenv/config";
import dns from "node:dns";
import express from "express";
import cors from "cors";
import { Client as NotionClient } from "@notionhq/client";
import OpenAI from "openai";

import { fillResearchPrompt, fillDraftingPrompt } from "./prompts.js";

// Prefer IPv4. Some hosts (e.g. Render) have flaky IPv6 egress that surfaces as
// intermittent "Premature close" / "fetch failed" when calling api.notion.com.
dns.setDefaultResultOrder("ipv4first");

// Retry transient network failures (dropped keep-alive sockets, premature close).
async function withRetry(fn, label, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err?.message || String(err);
      const retryable =
        /premature close|terminated|ECONNRESET|fetch failed|socket hang up|EAI_AGAIN|network|ETIMEDOUT/i.test(msg);
      if (!retryable || i === attempts) throw err;
      console.warn(`[retry] ${label} attempt ${i} failed: ${msg} — retrying`);
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw lastErr;
}

/* ============================================================
   Config
   ============================================================ */
const PORT = process.env.PORT || 8787;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";

// Lazy clients — construct on first use so the server boots even when keys
// are unset, and each endpoint returns a clear error instead of crashing.
let _notion;
function getNotion() {
  if (!_notion) {
    if (!process.env.NOTION_API_KEY) throw new Error("NOTION_API_KEY is not set");
    _notion = new NotionClient({
      auth: process.env.NOTION_API_KEY,
      // Use Node's native (undici) fetch instead of the SDK's bundled node-fetch,
      // which throws "Premature close" on Notion's gzipped responses on some
      // hosts (e.g. Render). undici decompresses/streams robustly.
      fetch: (url, init) => fetch(url, init),
    });
  }
  return _notion;
}

let _openai;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // Use Node's native (undici) fetch instead of the SDK's bundled node-fetch,
      // which throws "Premature close" on Render's egress (same fix as Notion).
      fetch: (url, init) => fetch(url, init),
      timeout: 180000, // long web-search research calls
      maxRetries: 4,
    });
  }
  return _openai;
}

/* Avatar palette — kept identical to the frontend so colors match. */
const palette = ["#e8472a", "#13294b", "#5b5bd6", "#b7791f", "#087f5b"];

/* ------------------------------------------------------------
   Notion property names this server expects in your CRM DB.
   Edit the right-hand strings to match your column names.
   Missing properties are handled gracefully (never crash).
   ------------------------------------------------------------ */
const PROPS = {
  company: "Company Name", // title column = company name
  contact: "Contact Name", // rich_text — person's name
  role: "Role",            // not in this CRM; stays empty/graceful
  channel: "Channel",      // select (values are outreach-type e.g. "Warm"); UI defaults to linkedin
  icp: "Fit",              // select: Strong | Moderate | Weak -> high/med/low
  warmTie: "Latest state ", // rich_text describing the intro (note trailing space)
  notes: "Notes",          // rich_text — extra context fed to research
  owner: "Owner",          // select — who the message is from / signs it
  draft: "Draft",          // editable working copy (required; written by research + approve)
  aiDraft: "AI Draft",     // untouched AI original (optional; written by research only)
  research: "Research",    // full research dossier (optional; written by research)
  status: "Status",        // status-type: write skipped unless the option exists
  code: "Code",            // optional short id; falls back to page id
  linkedin: "LinkedIn",    // optional url
  companyUrl: "Website",   // optional url
};

/* ============================================================
   Notion schema cache + type-aware read / write helpers
   ============================================================ */
let dbSchemaCache = null;
async function getDbSchema() {
  if (dbSchemaCache) return dbSchemaCache;
  const db = await withRetry(
    () => getNotion().databases.retrieve({ database_id: DATABASE_ID }),
    "databases.retrieve"
  );
  dbSchemaCache = db.properties || {};
  return dbSchemaCache;
}

/* Read a property's plain value regardless of its Notion type. */
function readProp(props, name) {
  const p = props?.[name];
  if (!p) return "";
  switch (p.type) {
    case "title":
      return (p.title || []).map((t) => t.plain_text).join("");
    case "rich_text":
      return (p.rich_text || []).map((t) => t.plain_text).join("");
    case "select":
      return p.select?.name || "";
    case "status":
      return p.status?.name || "";
    case "multi_select":
      return (p.multi_select || []).map((s) => s.name).join(", ");
    case "url":
      return p.url || "";
    case "email":
      return p.email || "";
    case "phone_number":
      return p.phone_number || "";
    case "people":
      return (p.people || []).map((x) => x.name).filter(Boolean).join(", ");
    case "number":
      return p.number != null ? String(p.number) : "";
    default:
      return "";
  }
}

/* Find the value of whichever property is the DB title. */
function titleValue(props) {
  for (const name of Object.keys(props || {})) {
    if (props[name]?.type === "title") {
      return (props[name].title || []).map((t) => t.plain_text).join("");
    }
  }
  return "";
}

/* Build a single update payload entry, matched to the DB column type.
   Returns null if the property doesn't exist (so we skip it gracefully). */
function buildWrite(schema, name, value) {
  const p = schema?.[name];
  if (!p) return null;
  switch (p.type) {
    case "title":
      return { title: [{ text: { content: String(value ?? "") } }] };
    case "rich_text":
      return { rich_text: [{ text: { content: String(value ?? "") } }] };
    case "select":
      // Select options are auto-created by Notion when written, so this is safe.
      return { select: value ? { name: String(value) } : null };
    case "status": {
      // Status options CANNOT be created via the API. Only write if the option
      // already exists in the column; otherwise skip (no crash, no API error).
      if (!value) return { status: null };
      const opts = p.status?.options || [];
      const match = opts.find((o) => o.name.toLowerCase() === String(value).toLowerCase());
      return match ? { status: { name: match.name } } : null;
    }
    case "url":
      return { url: value ? String(value) : null };
    default:
      return null;
  }
}

/* Assemble a Notion `properties` object, skipping unknown columns. */
function writeProps(schema, entries) {
  const out = {};
  for (const [key, value] of Object.entries(entries)) {
    const name = PROPS[key];
    const payload = buildWrite(schema, name, value);
    if (payload) out[name] = payload;
  }
  return out;
}

/* ============================================================
   Normalizers
   ============================================================ */
function normChannel(raw) {
  const v = (raw || "").toLowerCase();
  if (v.includes("inmail")) return "inmail";
  if (v.includes("email")) return "email";
  if (v.includes("linkedin")) return "linkedin";
  return "linkedin"; // default
}

function normIcp(raw) {
  const v = (raw || "").toLowerCase();
  if (v.startsWith("high") || v.startsWith("strong")) return "high";
  if (v.startsWith("low") || v.startsWith("weak")) return "low";
  if (v.startsWith("med") || v.startsWith("moderate")) return "med";
  return "med"; // default
}

const STATUSES = ["new", "researching", "drafted", "approved"];
function normStatus(raw) {
  const v = (raw || "").toLowerCase().trim();
  return STATUSES.includes(v) ? v : "new";
}

function initialsFrom(name, fallback) {
  const source = (name || fallback || "").trim();
  if (!source) return "??";
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

/* ============================================================
   Map one Notion page -> the exact frontend lead shape
   ============================================================ */
function mapLead(page, index, schema) {
  const props = page.properties || {};
  const titleVal = titleValue(props);

  const company = readProp(props, PROPS.company) || titleVal || "Untitled";
  const contact = readProp(props, PROPS.contact) || "";
  const role = readProp(props, PROPS.role) || "";
  const code = readProp(props, PROPS.code);

  return {
    id: code || page.id, // short code if present, else page id
    notionPageId: page.id, // join key — always the page id
    company,
    contact,
    role,
    hook: readProp(props, PROPS.warmTie) || "", // list subtitle = relationship note
    draft: readProp(props, PROPS.draft) || "",
    research: readProp(props, PROPS.research) || "", // dossier shown in the UI disclosure
    channel: normChannel(readProp(props, PROPS.channel)),
    icp: normIcp(readProp(props, PROPS.icp)),
    status: normStatus(readProp(props, PROPS.status)),
    initials: initialsFrom(contact, company),
    color: palette[index % palette.length],
  };
}

/* Pull the fields the research prompt needs from a single page. */
function readResearchInputs(page) {
  const props = page.properties || {};
  const titleVal = titleValue(props);
  // This CRM has no Role column; useful context lives in Latest state + Notes.
  const latest = readProp(props, PROPS.warmTie); // "Latest state " column
  const notes = readProp(props, PROPS.notes);
  const warmTie = [latest, notes ? `Notes: ${notes}` : ""].filter(Boolean).join(" | ");

  return {
    leadName: readProp(props, PROPS.contact) || "",
    leadTitle: readProp(props, PROPS.role) || "",
    company: readProp(props, PROPS.company) || titleVal || "",
    linkedinUrl: readProp(props, PROPS.linkedin) || "",
    companyUrl: readProp(props, PROPS.companyUrl) || "",
    warmTie: warmTie || "",
    owner: readProp(props, PROPS.owner) || "",
  };
}

/* The Draft column must already exist — we never create columns. Returns the
   schema, or throws a clear error if the write-back column is missing. */
async function requireDraftColumn() {
  const schema = await getDbSchema();
  if (!schema[PROPS.draft]) {
    throw new Error(
      `Notion database is missing a "${PROPS.draft}" text column. Add it to enable write-back.`
    );
  }
  return schema;
}

/* ============================================================
   Edit-learning loop (in-context retrieval — NO training).
   Find leads where the human edited the AI draft, and feed those
   before/after pairs back into the drafting prompt as examples.
   ============================================================ */
const normalizeText = (s) => (s || "").replace(/\s+/g, " ").trim();

let editExamplesCache = { at: 0, value: null };
async function getEditExamples() {
  const now = Date.now();
  if (editExamplesCache.value && now - editExamplesCache.at < 60_000) {
    return editExamplesCache.value;
  }
  let examples = [];
  try {
    const schema = await getDbSchema();
    // Both columns must exist for there to be an edit signal to learn from.
    if (schema[PROPS.aiDraft] && schema[PROPS.draft]) {
      const query = await withRetry(
        () =>
          getNotion().databases.query({
            database_id: DATABASE_ID,
            page_size: 50,
            sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
          }),
        "databases.query (edit examples)"
      );
      for (const page of query.results) {
        const props = page.properties || {};
        const aiDraft = readProp(props, PROPS.aiDraft);
        const humanEdited = readProp(props, PROPS.draft);
        // Both present AND meaningfully different (human actually revised it).
        if (aiDraft && humanEdited && normalizeText(aiDraft) !== normalizeText(humanEdited)) {
          examples.push({ aiDraft, humanEdited });
          if (examples.length >= 3) break;
        }
      }
    }
  } catch (err) {
    console.warn("getEditExamples failed (continuing without):", err?.message || err);
    examples = [];
  }
  editExamplesCache = { at: now, value: examples };
  return examples;
}

function buildEditExamplesBlock(examples) {
  if (!examples || examples.length === 0) return "";
  const parts = examples.map(
    (ex, i) => `Example ${i + 1}:\nAI WROTE: ${ex.aiDraft}\nHUMAN CHANGED IT TO: ${ex.humanEdited}`
  );
  return (
    "Here are recent examples of how the human revised earlier drafts. " +
    "Learn their preferences and apply the same style:\n\n" +
    parts.join("\n\n")
  );
}

/* ============================================================
   OpenAI: research (web search) -> dossier -> draft message
   ============================================================ */
/* Stream a Responses API call and accumulate the text. Streaming keeps the
   connection active during long web-search calls so intermediaries (e.g.
   Render) don't drop the idle socket with "Premature close". Retried on
   transient network errors. */
async function streamResponseText(params, label) {
  return withRetry(async () => {
    const stream = await getOpenAI().responses.create({ ...params, stream: true });
    let text = "";
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        text += event.delta || "";
      } else if (event.type === "response.error" || event.type === "error") {
        throw new Error(event.error?.message || "OpenAI stream error");
      }
    }
    return text.trim();
  }, label);
}

async function researchDossier(inputs) {
  const system = fillResearchPrompt(inputs);
  return streamResponseText(
    {
      model: OPENAI_MODEL,
      temperature: 0.2,
      tools: [{ type: "web_search" }],
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            "Research this lead now using web search and return the dossier in exactly the required output structure.",
        },
      ],
    },
    "openai.research"
  );
}

/* Returns the plain-text outreach message (the draft only). */
async function draftMessage({ dossier, warmTie, ownerName, editExamples }) {
  const system = fillDraftingPrompt({ ownerName, editExamples });
  return streamResponseText(
    {
      model: OPENAI_MODEL,
      temperature: 0.3,
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            `RELATIONSHIP NOTES (how ${ownerName || "Shiv"} / the team knows them, and prior contact):\n` +
            `${warmTie || "No prior relationship on record."}\n\n` +
            `RESEARCH DOSSIER:\n${dossier}\n\n` +
            `Write the message now. Return ONLY the message text.`,
        },
      ],
    },
    "openai.draft"
  );
}

/* ============================================================
   Express app
   ============================================================ */
const app = express();
// CORS: set CORS_ORIGIN to your Vercel URL(s) in production (comma-separated).
// Unset = allow all origins (fine for local dev). Trailing slashes are
// normalized on both sides so "https://x.vercel.app/" matches "https://x.vercel.app".
const stripSlash = (s) => s.trim().replace(/\/+$/, "");
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(stripSlash).filter(Boolean)
  : null;
app.use(
  cors({
    origin: allowedOrigins
      ? (origin, cb) => cb(null, !origin || allowedOrigins.includes(stripSlash(origin)))
      : true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* Lightweight keep-alive ping. Logs each hit, does no work. */
app.get("/api/ping", (_req, res) => {
  console.log(`[ping] ${new Date().toISOString()}`);
  res.json({ pong: true, time: new Date().toISOString() });
});

/* 1) GET /api/leads — Notion DB -> frontend lead[] */
app.get("/api/leads", async (_req, res) => {
  try {
    if (!DATABASE_ID) throw new Error("NOTION_DATABASE_ID is not set");
    const schema = await getDbSchema();
    const query = await withRetry(
      () => getNotion().databases.query({ database_id: DATABASE_ID, page_size: 100 }),
      "databases.query"
    );
    const leads = query.results.map((page, i) => mapLead(page, i, schema));
    res.json(leads);
  } catch (err) {
    console.error("GET /api/leads failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to load leads from Notion" });
  }
});

/* 2) POST /api/research { notionPageId } -> { draft, research } (+ writes Notion) */
app.post("/api/research", async (req, res) => {
  const { notionPageId } = req.body || {};
  try {
    if (!notionPageId) throw new Error("notionPageId is required");
    const schema = await requireDraftColumn();

    const page = await withRetry(
      () => getNotion().pages.retrieve({ page_id: notionPageId }),
      "pages.retrieve"
    );
    const inputs = readResearchInputs(page);
    const ownerName = inputs.owner || "Shiv";

    const dossier = await researchDossier(inputs);

    // Edit-learning: inject how the human revised earlier drafts (if any).
    const editExamples = buildEditExamplesBlock(await getEditExamples());
    const draft = await draftMessage({ dossier, warmTie: inputs.warmTie, ownerName, editExamples });

    if (!draft) throw new Error("Drafting returned an empty message");

    // AI Draft = untouched original, Draft = editable working copy, Research = dossier.
    // AI Draft / Research write is skipped automatically if those columns are absent.
    await withRetry(
      () =>
        getNotion().pages.update({
          page_id: notionPageId,
          properties: writeProps(schema, {
            draft,
            aiDraft: draft,
            research: dossier,
            status: "drafted",
          }),
        }),
      "pages.update (research)"
    );

    res.json({ draft, research: dossier });
  } catch (err) {
    console.error("POST /api/research failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Research failed" });
  }
});

/* 3) POST /api/approve { notionPageId, draft } -> saves + marks approved (NEVER sends) */
app.post("/api/approve", async (req, res) => {
  const { notionPageId, draft } = req.body || {};
  try {
    if (!notionPageId) throw new Error("notionPageId is required");
    if (typeof draft !== "string") throw new Error("draft (string) is required");
    const schema = await requireDraftColumn();

    await withRetry(
      () =>
        getNotion().pages.update({
          page_id: notionPageId,
          properties: writeProps(schema, { draft, status: "approved" }),
        }),
      "pages.update (approve)"
    );

    res.json({ ok: true, status: "approved" });
  } catch (err) {
    console.error("POST /api/approve failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Approve failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Agilow Hub server listening on http://localhost:${PORT}`);
});
