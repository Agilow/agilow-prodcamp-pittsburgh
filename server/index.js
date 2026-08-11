import "dotenv/config";
import dns from "node:dns";
import express from "express";
import cors from "cors";
import { Client as NotionClient } from "@notionhq/client";
import OpenAI from "openai";

import {
  fillPrompt,
  fillDraftingPrompt,
  RESEARCH_COMPANY,
  RESEARCH_FUNDING,
  RESEARCH_TEAM,
  RESEARCH_HIRING,
  RESEARCH_PERSON,
  RESEARCH_RECENT,
  RESEARCH_VERIFY,
  EXPLAIN_EDIT_PROMPT,
} from "./prompts.js";

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
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";

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
  editReason: "Edit Reason", // why the human changed the draft (optional; written by approve)
  research: "Research",    // full research dossier (optional; written by research)
  status: "Status",        // status-type: write skipped unless the option exists
  code: "Code",            // optional short id; falls back to page id
  linkedin: "LinkedIn",    // optional url
  companyUrl: "Website",   // optional url
};

/* ============================================================
   Notion schema cache + type-aware read / write helpers
   ============================================================ */
let dbSchemaCache = { at: 0, value: null };
async function getDbSchema() {
  // Short TTL so column renames/additions are picked up without a restart.
  if (dbSchemaCache.value && Date.now() - dbSchemaCache.at < 60_000) {
    return dbSchemaCache.value;
  }
  const db = await withRetry(
    () => getNotion().databases.retrieve({ database_id: DATABASE_ID }),
    "databases.retrieve"
  );
  dbSchemaCache = { at: Date.now(), value: db.properties || {} };
  return dbSchemaCache.value;
}

/* Resolve a PROPS column name to the ACTUAL column in this DB, tolerating
   parenthetical annotations the user may add (e.g. PROPS "Draft" matches a
   real column "Draft(final and approved)"). Exact match wins; then a match on
   the base name (text before any "(...)"); else the original (graceful skip). */
const colBaseName = (s) =>
  String(s || "")
    .replace(/\s*\(.*?\)\s*$/, "")
    .trim()
    .toLowerCase();

function resolveColName(schema, wanted) {
  if (!schema || !wanted) return wanted;
  if (schema[wanted]) return wanted;
  const wb = colBaseName(wanted);
  for (const name of Object.keys(schema)) {
    if (colBaseName(name) === wb) return name;
  }
  return wanted;
}

/* Canonical key -> actual column name, resolved against the live schema. */
function resolvePropMap(schema) {
  const out = {};
  for (const [key, name] of Object.entries(PROPS)) out[key] = resolveColName(schema, name);
  return out;
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

/* Notion caps a single rich_text/title item at 2000 chars; split long strings
   into multiple items so large dossiers don't get rejected. */
function richChunks(value) {
  const s = String(value ?? "");
  if (s.length <= 2000) return [{ text: { content: s } }];
  const out = [];
  for (let i = 0; i < s.length; i += 2000) out.push({ text: { content: s.slice(i, i + 2000) } });
  return out;
}

/* Build a single update payload entry, matched to the DB column type.
   Returns null if the property doesn't exist (so we skip it gracefully). */
function buildWrite(schema, name, value) {
  const p = schema?.[name];
  if (!p) return null;
  switch (p.type) {
    case "title":
      return { title: richChunks(value) };
    case "rich_text":
      return { rich_text: richChunks(value) };
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

/* Assemble a Notion `properties` object, skipping unknown columns. Column
   names are resolved against the live schema (tolerates "(...)" renames). */
function writeProps(schema, entries) {
  const out = {};
  for (const [key, value] of Object.entries(entries)) {
    const name = resolveColName(schema, PROPS[key]);
    const payload = buildWrite(schema, name, value);
    if (payload) out[name] = payload;
  }
  return out;
}

/* ============================================================
   Dossier -> Notion page BODY (block content, below Comments).
   The whole dossier lives inside ONE collapsible toggle titled
   "Agilow Research Dossier", so re-running research can replace it
   with a single delete (which removes all nested blocks) without
   disturbing anything else the user put on the page.
   ============================================================ */
const DOSSIER_TITLE_PREFIX = "Agilow Research Dossier";
const URL_RE = /(https?:\/\/[^\s)]+)/g;

/* Build a Notion rich_text array from a line: linkifies URLs, optionally
   bolds a leading "Label:" prefix, and chunks at Notion's 2000-char limit. */
function richTextSegments(text, { boldPrefix = false } = {}) {
  const out = [];
  let s = String(text ?? "");
  let prefix = null;
  if (boldPrefix) {
    const m = s.match(/^([^:]{1,60}:)\s*([\s\S]*)$/);
    if (m) {
      prefix = m[1];
      s = m[2];
    }
  }
  const push = (content, { bold = false, link = null } = {}) => {
    for (let i = 0; i < content.length; i += 2000) {
      out.push({
        type: "text",
        text: { content: content.slice(i, i + 2000), link: link ? { url: link } : null },
        annotations: bold ? { bold: true } : undefined,
      });
    }
  };
  if (prefix) push(prefix + " ", { bold: true });
  let last = 0;
  let mm;
  URL_RE.lastIndex = 0;
  while ((mm = URL_RE.exec(s))) {
    if (mm.index > last) push(s.slice(last, mm.index));
    const url = mm[0].replace(/[.,);]+$/, ""); // trim trailing punctuation
    push(url, { link: url });
    last = mm.index + mm[0].length;
  }
  if (last < s.length) push(s.slice(last));
  if (out.length === 0) push(s);
  return out.slice(0, 100); // Notion caps rich_text at 100 items per block
}

/* Convert the dossier text into Notion blocks: section headers (lines ending
   in ":") -> heading_3, "- "/"A." lines -> bullets, everything else ->
   paragraphs with a bold "Label:" lead-in. */
function dossierToBlocks(dossier) {
  const blocks = [];
  for (const raw of String(dossier || "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const t = line.trim();
    if (!t) continue; // collapse blank lines
    if (t.endsWith(":") && t.length <= 60 && !/https?:/i.test(t)) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: richTextSegments(t.replace(/:$/, "")) },
      });
    } else if (/^[-*•]\s+/.test(t)) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richTextSegments(t.replace(/^[-*•]\s+/, ""), { boldPrefix: true }) },
      });
    } else if (/^[A-E]\.\s+/.test(t)) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richTextSegments(t, { boldPrefix: true }) },
      });
    } else {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richTextSegments(t, { boldPrefix: true }) },
      });
    }
  }
  return blocks.slice(0, 2000);
}

/* Replace any prior dossier toggle on the page with a fresh one. Best-effort:
   callers wrap this so a body-write failure never fails the main request. */
async function writeDossierToBody(pageId, dossier) {
  if (!dossier || !dossier.trim()) return;

  // 1) Delete (archive) any existing "Agilow Research Dossier" toggle(s).
  const existing = await withRetry(
    () => getNotion().blocks.children.list({ block_id: pageId, page_size: 100 }),
    "blocks.children.list (dossier)"
  );
  for (const b of existing.results || []) {
    if (b.type !== "toggle") continue;
    const txt = (b.toggle?.rich_text || []).map((r) => r.plain_text || "").join("");
    if (txt.startsWith(DOSSIER_TITLE_PREFIX)) {
      await withRetry(() => getNotion().blocks.delete({ block_id: b.id }), "blocks.delete (old dossier)");
    }
  }

  // 2) Create a fresh, empty toggle to hold the dossier.
  const today = new Date().toISOString().slice(0, 10);
  const created = await withRetry(
    () =>
      getNotion().blocks.children.append({
        block_id: pageId,
        children: [
          {
            object: "block",
            type: "toggle",
            toggle: { rich_text: richTextSegments(`${DOSSIER_TITLE_PREFIX} · updated ${today}`) },
          },
        ],
      }),
    "blocks.children.append (dossier toggle)"
  );
  const toggleId = created.results?.[0]?.id;
  if (!toggleId) return;

  // 3) Append the dossier blocks INTO the toggle, in batches (100-block limit).
  const blocks = dossierToBlocks(dossier);
  for (let i = 0; i < blocks.length; i += 90) {
    const chunk = blocks.slice(i, i + 90);
    await withRetry(
      () => getNotion().blocks.children.append({ block_id: toggleId, children: chunk }),
      "blocks.children.append (dossier body)"
    );
  }
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
  const P = resolvePropMap(schema);

  const company = readProp(props, P.company) || titleVal || "Untitled";
  const contact = readProp(props, P.contact) || "";
  const role = readProp(props, P.role) || "";
  const code = readProp(props, P.code);

  return {
    id: code || page.id, // short code if present, else page id
    notionPageId: page.id, // join key — always the page id
    company,
    contact,
    role,
    hook: readProp(props, P.warmTie) || "", // list subtitle = relationship note
    draft: readProp(props, P.draft) || "",
    aiDraft: readProp(props, P.aiDraft) || "", // AI original, for edit-diff detection
    research: readProp(props, P.research) || "", // dossier shown in the UI disclosure
    linkedin: readProp(props, P.linkedin) || "", // used for best-effort preview photo
    companyUrl: readProp(props, P.companyUrl) || "",
    channel: normChannel(readProp(props, P.channel)),
    icp: normIcp(readProp(props, P.icp)),
    status: normStatus(readProp(props, P.status)),
    initials: initialsFrom(contact, company),
    color: palette[index % palette.length],
  };
}

/* Pull the fields the research prompt needs from a single page. */
function readResearchInputs(page, schema) {
  const props = page.properties || {};
  const titleVal = titleValue(props);
  const P = resolvePropMap(schema);
  // This CRM has no Role column; useful context lives in Latest state + Notes.
  const latest = readProp(props, P.warmTie); // "Latest state " column
  const notes = readProp(props, P.notes);
  const warmTie = [latest, notes ? `Notes: ${notes}` : ""].filter(Boolean).join(" | ");

  return {
    leadName: readProp(props, P.contact) || "",
    leadTitle: readProp(props, P.role) || "",
    company: readProp(props, P.company) || titleVal || "",
    linkedinUrl: readProp(props, P.linkedin) || "",
    companyUrl: readProp(props, P.companyUrl) || "",
    warmTie: warmTie || "",
    owner: readProp(props, P.owner) || "",
  };
}

/* The Draft column must already exist — we never create columns. Returns the
   schema, or throws a clear error if the write-back column is missing.
   Resolves the Draft name so "(...)" renames still count. */
async function requireDraftColumn() {
  const schema = await getDbSchema();
  const draftName = resolveColName(schema, PROPS.draft);
  if (!schema[draftName]) {
    throw new Error(
      `Notion database is missing a "${PROPS.draft}" text column. Add it to enable write-back.`
    );
  }
  return schema;
}

/* ============================================================
   Edit-learning loop (in-context retrieval — NO training).
   Find leads where the human edited the AI draft, and feed those
   before/after pairs (with WHY) back into the drafting prompt.
   Per-owner: a draft only learns from THAT owner's own edits.
   ============================================================ */
const normalizeText = (s) => (s || "").replace(/\s+/g, " ").trim();

// Cache ALL edited pairs (with owner) once; filter per-owner in memory.
let editPairsCache = { at: 0, value: null };
async function getAllEditPairs() {
  const now = Date.now();
  if (editPairsCache.value && now - editPairsCache.at < 60_000) {
    return editPairsCache.value;
  }
  let pairs = [];
  try {
    const schema = await getDbSchema();
    const P = resolvePropMap(schema);
    // Both columns must exist for there to be an edit signal to learn from.
    if (schema[P.aiDraft] && schema[P.draft]) {
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
        const aiDraft = readProp(props, P.aiDraft);
        const humanEdited = readProp(props, P.draft);
        const reason = readProp(props, P.editReason); // why the human changed it (may be "")
        const owner = readProp(props, P.owner); // whose edit this is
        // Both present AND meaningfully different (human actually revised it).
        if (aiDraft && humanEdited && normalizeText(aiDraft) !== normalizeText(humanEdited)) {
          pairs.push({ aiDraft, humanEdited, reason, owner });
        }
      }
    }
  } catch (err) {
    console.warn("getEditExamples failed (continuing without):", err?.message || err);
    pairs = [];
  }
  editPairsCache = { at: now, value: pairs };
  return pairs;
}

/* Up to 3 most-recent edit examples for the given owner. Falls back to all
   owners only when no owner is known. */
async function getEditExamples(owner) {
  const pairs = await getAllEditPairs(); // already sorted most-recent-first
  const want = (owner || "").trim().toLowerCase();
  const scoped = want
    ? pairs.filter((p) => (p.owner || "").trim().toLowerCase() === want)
    : pairs;
  return scoped.slice(0, 3);
}

function buildEditExamplesBlock(examples) {
  if (!examples || examples.length === 0) return "";
  const parts = examples.map((ex, i) => {
    let s = `Example ${i + 1}:\nAI WROTE: ${ex.aiDraft}\nHUMAN CHANGED IT TO: ${ex.humanEdited}`;
    if (ex.reason && ex.reason.trim()) s += `\nWHY: ${ex.reason.trim()}`;
    return s;
  });
  return (
    "Here are recent examples of how the human revised earlier drafts. " +
    "Learn their preferences and apply the same style. " +
    "Apply the WHY principles to new drafts — these are the human's standing preferences, not one-offs:\n\n" +
    parts.join("\n\n")
  );
}

/* ============================================================
   OpenAI: research (web search) -> dossier -> draft message
   ============================================================ */
/* Run a Responses API call and return the accumulated text. Uses the native
   (undici) fetch configured on the client; retried on transient network errors. */
async function createResponseText(params, label) {
  return withRetry(async () => {
    const resp = await getOpenAI().responses.create(params);
    return (resp.output_text || "").trim();
  }, label);
}

/* One targeted research pass: a web_search call driven by a system prompt. */
async function runSearchPass(systemPrompt, label) {
  return createResponseText(
    {
      model: OPENAI_MODEL,
      temperature: 0.2,
      tools: [{ type: "web_search" }],
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Run this research pass now using web search. Return only the specified structured output, with a source URL on every fact line.",
        },
      ],
    },
    label
  );
}

/* ============================================================
   Firecrawl: render JS-heavy pages (e.g. careers pages whose job
   boards load client-side) so the hiring pass can actually see them.
   All best-effort — any failure or missing key yields "".
   ============================================================ */
async function firecrawlPost(path, body, ms = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${FIRECRAWL_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false) {
      throw new Error(data?.error || `Firecrawl ${path} HTTP ${r.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* Normalize the various shapes Firecrawl /search can return into a flat list. */
function firecrawlResults(data) {
  const d = data?.data;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.web)) return d.web;
  return [];
}

const urlHost = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/* Discover the company's careers/jobs page, then scrape it WITH JavaScript
   rendered (onlyMainContent:false + waitFor, since job boards often live
   outside "main" and load via AJAX). Returns sourced markdown or "". */
async function fetchCareersContent(company, companyUrl) {
  if (!FIRECRAWL_API_KEY || !company) return "";
  try {
    const search = await firecrawlPost("/search", {
      query: `${company} careers jobs open positions`,
      limit: 6,
    });
    const results = firecrawlResults(search)
      .map((r) => r.url)
      .filter(Boolean);
    if (results.length === 0) return "";

    // Prefer a URL on the company's own domain, then anything careers-shaped.
    const companyHost = companyUrl ? urlHost(companyUrl) : "";
    const score = (u) => {
      let s = 0;
      if (companyHost && urlHost(u) === companyHost) s += 3;
      if (/career|job|join|position/i.test(u)) s += 2;
      return s;
    };
    const best = [...results].sort((a, b) => score(b) - score(a))[0];
    if (!best || score(best) === 0) return ""; // nothing careers-like found

    const scrape = await firecrawlPost("/scrape", {
      url: best,
      formats: ["markdown"],
      onlyMainContent: false,
      waitFor: 5000,
    });
    const md = (scrape?.data?.markdown || "").trim();
    if (!md) return "";
    const clipped = md.length > 8000 ? md.slice(0, 8000) + "\n…(truncated)" : md;
    return `SOURCE: ${best}\n\n${clipped}`;
  } catch (e) {
    console.warn("fetchCareersContent failed (continuing):", e?.message || e);
    return "";
  }
}

/* Multi-step research: six targeted, source-tiered passes gathered in
   parallel, then a verification + reconciliation + ICP-gate synthesis pass.
   Returns the final dossier string (consumed by the drafting step). */
async function researchDossier(inputs) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  // Firecrawl: rendered careers page so the hiring pass sees client-side
  // job boards search engines miss. Best-effort; "" when unavailable.
  const careersContent = await fetchCareersContent(inputs.company, inputs.companyUrl);
  const ctx = { ...inputs, today, careersContent };

  const passes = [
    ["company", RESEARCH_COMPANY],
    ["funding", RESEARCH_FUNDING],
    ["team", RESEARCH_TEAM],
    ["hiring", RESEARCH_HIRING],
    ["person", RESEARCH_PERSON],
    ["recent", RESEARCH_RECENT],
  ];

  // Passes are independent -> run concurrently for depth without serial latency.
  const results = await Promise.all(
    passes.map(async ([key, template]) => {
      const text = await runSearchPass(fillPrompt(template, ctx), `openai.research.${key}`);
      return [key, text];
    })
  );
  const gathered = Object.fromEntries(results);

  const rawResearch = passes
    .map(([key]) => `### ${key.toUpperCase()} PASS\n${gathered[key] || "(no output)"}`)
    .join("\n\n");

  // warmTie already = "Latest state | Notes: ..." (the human's claims).
  const verifySystem = fillPrompt(RESEARCH_VERIFY, {
    ...ctx,
    notesBlock: inputs.warmTie || "(none provided)",
    rawResearch,
  });

  return runSearchPass(verifySystem, "openai.research.verify");
}

/* ============================================================
   ICP qualification (score-only): reuse the research engine,
   skip drafting, extract a structured verdict from the dossier.
   ============================================================ */

/* Extract structured ICP fields from the verify-pass dossier text. */
async function extractVerdict(dossier) {
  const resp = await withRetry(
    () =>
      getOpenAI().responses.create({
        model: OPENAI_MODEL,
        temperature: 0,
        input: [
          {
            role: "system",
            content:
              "Extract structured fields from this Agilow person-fit research dossier. Use ONLY what the dossier states — do not add, infer, or change any fact. Copy the ICP FIT verdict, CONTACT TYPE, SUGGESTED INTENT, and the A-E checks exactly as written.",
          },
          { role: "user", content: `DOSSIER:\n${dossier}\n\nReturn the structured JSON.` },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "icp_qualification",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                verdict: {
                  type: "string",
                  enum: ["Strong", "Moderate", "Moderate (unverified)", "Weak"],
                },
                // Must stay in lockstep with the CONTACT TYPE list in
                // RESEARCH_VERIFY and with contactTypeClass() in src/Hub.jsx.
                contactType: {
                  type: "string",
                  enum: [
                    "Ceremony owner",
                    "Eng leader",
                    "Connector",
                    "IC",
                    "Not relevant",
                    "Unknown",
                  ],
                },
                suggestedIntent: { type: "string" },
                reasoning: { type: "string" },
                checks: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      criterion: { type: "string" },
                      value: { type: "string", enum: ["true", "false", "unknown"] },
                      evidence: { type: "string" },
                    },
                    required: ["criterion", "value", "evidence"],
                  },
                },
                // Mirrored by KEY_FACT_LABELS in src/Hub.jsx. Every field is
                // `required` under strict mode, so the model emits "" when a
                // fact is absent rather than omitting the key.
                keyFacts: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    role: { type: "string" },
                    company: { type: "string" },
                    teamSize: { type: "string" },
                    tooling: { type: "string" },
                    painSignal: { type: "string" },
                    recentActivity: { type: "string" },
                  },
                  required: ["role", "company", "teamSize", "tooling", "painSignal", "recentActivity"],
                },
              },
              required: ["verdict", "contactType", "suggestedIntent", "reasoning", "checks", "keyFacts"],
            },
          },
        },
      }),
    "openai.qualify.extract"
  );
  return JSON.parse((resp.output_text || "{}").trim());
}

/* Qualify one pasted lead end-to-end (research -> verdict), no drafting. */
async function qualifyOne(lead = {}) {
  const inputs = {
    leadName: lead.name || "",
    leadTitle: "",
    company: lead.company || "",
    linkedinUrl: lead.linkedinUrl || "",
    companyUrl: lead.companyUrl || "",
    warmTie: "", // no CRM notes for a pasted lead
  };
  const dossier = await researchDossier(inputs);
  const structured = await extractVerdict(dossier);
  return {
    name: lead.name || "",
    company: lead.company || "",
    linkedinUrl: lead.linkedinUrl || "",
    verdict: structured.verdict,
    contactType: structured.contactType || "Unknown",
    suggestedIntent: structured.suggestedIntent || "",
    checks: structured.checks || [],
    reasoning: structured.reasoning || "",
    keyFacts: structured.keyFacts || {},
    dossier,
  };
}

/* Run an array of async tasks with bounded concurrency. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/* Returns the plain-text outreach message (the draft only). */
async function draftMessage({ dossier, warmTie, ownerName, editExamples }) {
  const system = fillDraftingPrompt({ ownerName, editExamples });
  return createResponseText(
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

/* 1b) GET /api/owners — distinct owner names for the UI selector.
   Pulls the Owner select column's options (so the picker matches the CRM),
   plus any owner values already present on rows. Falls back to ["Shiv"]. */
app.get("/api/owners", async (_req, res) => {
  try {
    if (!DATABASE_ID) throw new Error("NOTION_DATABASE_ID is not set");
    const schema = await getDbSchema();
    const ownerCol = resolveColName(schema, PROPS.owner);
    const set = new Set();
    const def = schema?.[ownerCol];
    // Select / status / multi_select options defined on the column.
    for (const o of def?.select?.options || []) if (o.name) set.add(o.name);
    for (const o of def?.multi_select?.options || []) if (o.name) set.add(o.name);
    const owners = Array.from(set);
    if (owners.length === 0) owners.push("Shiv");
    res.json({ owners });
  } catch (err) {
    console.error("GET /api/owners failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to load owners" });
  }
});

/* 2) POST /api/research { notionPageId, owner? } -> { draft, research } (+ writes Notion)
   `owner` (when set in the UI) overrides the page's Owner column: it controls
   the signing voice, which owner's edit examples are learned from, AND is
   written back to the Owner column so future edit-learning attributes correctly. */
app.post("/api/research", async (req, res) => {
  const { notionPageId, owner } = req.body || {};
  try {
    if (!notionPageId) throw new Error("notionPageId is required");
    const schema = await requireDraftColumn();

    const page = await withRetry(
      () => getNotion().pages.retrieve({ page_id: notionPageId }),
      "pages.retrieve"
    );
    const inputs = readResearchInputs(page, schema);
    const selectedOwner = typeof owner === "string" ? owner.trim() : "";
    const ownerName = selectedOwner || inputs.owner || "Shiv";

    const dossier = await researchDossier(inputs);

    // Edit-learning: inject how THIS owner revised earlier drafts (if any).
    const editExamples = buildEditExamplesBlock(await getEditExamples(ownerName));
    const draft = await draftMessage({ dossier, warmTie: inputs.warmTie, ownerName, editExamples });

    if (!draft) throw new Error("Drafting returned an empty message");

    // AI Draft = untouched original, Draft = editable working copy, Research = dossier.
    // AI Draft / Research write is skipped automatically if those columns are absent.
    // Persist the chosen owner so the row reflects who this draft is from.
    const entries = { draft, aiDraft: draft, research: dossier, status: "drafted" };
    if (selectedOwner) entries.owner = selectedOwner;
    await withRetry(
      () =>
        getNotion().pages.update({
          page_id: notionPageId,
          properties: writeProps(schema, entries),
        }),
      "pages.update (research)"
    );

    // Write the dossier into the page BODY (collapsible toggle), replacing any
    // previous one. Best-effort: never fail the draft if the body write hiccups.
    try {
      await writeDossierToBody(notionPageId, dossier);
    } catch (e) {
      console.warn("dossier body write failed (continuing):", e?.message || e);
    }

    res.json({ draft, research: dossier });
  } catch (err) {
    console.error("POST /api/research failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Research failed" });
  }
});

/* 3) POST /api/approve { notionPageId, draft, editReason? } -> saves + marks
   approved (NEVER sends). editReason (if present) is written to the Edit Reason
   column; skipped gracefully if that column is absent. */
app.post("/api/approve", async (req, res) => {
  const { notionPageId, draft, editReason } = req.body || {};
  try {
    if (!notionPageId) throw new Error("notionPageId is required");
    if (typeof draft !== "string") throw new Error("draft (string) is required");
    const schema = await requireDraftColumn();

    const entries = { draft, status: "approved" };
    if (typeof editReason === "string" && editReason.trim()) {
      entries.editReason = editReason.trim();
    }

    await withRetry(
      () =>
        getNotion().pages.update({
          page_id: notionPageId,
          properties: writeProps(schema, entries),
        }),
      "pages.update (approve)"
    );

    res.json({ ok: true, status: "approved" });
  } catch (err) {
    console.error("POST /api/approve failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Approve failed" });
  }
});

/* 3b) POST /api/explain-edit { aiDraft, humanEdited } -> { reason }
   Asks the AI to propose, in one line, WHY the human changed the draft.
   The human confirms/edits this before it is saved (see /api/approve). */
app.post("/api/explain-edit", async (req, res) => {
  const { aiDraft, humanEdited } = req.body || {};
  try {
    if (typeof aiDraft !== "string" || typeof humanEdited !== "string") {
      throw new Error("aiDraft and humanEdited (strings) are required");
    }
    const reason = await createResponseText(
      {
        model: OPENAI_MODEL,
        temperature: 0.2,
        input: [
          { role: "system", content: EXPLAIN_EDIT_PROMPT },
          {
            role: "user",
            content:
              `AI DRAFT:\n${aiDraft}\n\nHUMAN EDITED VERSION:\n${humanEdited}\n\n` +
              `Why did the human change it? Answer in ONE short sentence.`,
          },
        ],
      },
      "openai.explain-edit"
    );
    res.json({ reason: (reason || "").trim() });
  } catch (err) {
    console.error("POST /api/explain-edit failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Explain-edit failed" });
  }
});

/* 4) POST /api/qualify
   Single: { name, company, linkedinUrl?, companyUrl? } -> one result.
   Batch:  { leads: [ {name, company, ...}, ... ] }       -> { results: [...] }.
   Score-only: runs the research engine, returns the verdict, NO drafting,
   NO Notion writes. */
const QUALIFY_BATCH_MAX = 20;
const QUALIFY_CONCURRENCY = 3;

app.post("/api/qualify", async (req, res) => {
  const body = req.body || {};
  try {
    if (Array.isArray(body.leads)) {
      const leads = body.leads.slice(0, QUALIFY_BATCH_MAX);
      if (leads.length === 0) throw new Error("leads array is empty");
      const results = await mapLimit(leads, QUALIFY_CONCURRENCY, async (lead) => {
        try {
          return await qualifyOne(lead);
        } catch (err) {
          return {
            name: lead?.name || "",
            company: lead?.company || "",
            error: err?.message || "Qualify failed",
          };
        }
      });
      return res.json({ results });
    }

    if (!body.name && !body.company) throw new Error("name or company is required");
    const result = await qualifyOne(body);
    return res.json(result);
  } catch (err) {
    console.error("POST /api/qualify failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Qualify failed" });
  }
});

/* 5) POST /api/add-to-crm { name, company, linkedinUrl?, companyUrl?, verdict?, dossier?, owner? }
   Creates a new page in the Notion CRM. Never auto-creates columns. */
/* Verdict -> the CRM's "Fit" select.
   The verdict vocabulary is Strong / Moderate / Moderate (unverified) / Weak,
   but the live Notion "Fit" column is a select with exactly three options:
   Strong | Medium | Weak. Notion auto-creates select options on write, so
   returning "Moderate" here would silently add a FOURTH option and split the
   same leads across two values in every existing view and filter.
   So the mapping stays Medium, deliberately: this is the one place the two
   vocabularies meet, and the CRM's wins. Rename the Notion option to Moderate
   and this line follows — not before. */
function fitFromVerdict(verdict) {
  if (!verdict) return null;
  if (/strong/i.test(verdict)) return "Strong";
  if (/weak/i.test(verdict)) return "Weak";
  return "Medium"; // Moderate / Moderate (unverified) -> the CRM's "Medium"
}

app.post("/api/add-to-crm", async (req, res) => {
  const { name, company, linkedinUrl, companyUrl, verdict, dossier, owner } = req.body || {};
  try {
    if (!name && !company) throw new Error("name or company is required");
    const schema = await getDbSchema();

    const noteParts = [];
    if (verdict) noteParts.push(`ICP verdict: ${verdict}`);
    if (linkedinUrl) noteParts.push(`LinkedIn: ${linkedinUrl}`);
    noteParts.push("Added from the Qualify screen.");

    const entries = {
      company: company || name,
      contact: name || "",
      notes: noteParts.join(" | "),
    };
    const fit = fitFromVerdict(verdict);
    if (fit) entries.icp = fit;
    if (dossier) entries.research = dossier;
    if (linkedinUrl) entries.linkedin = linkedinUrl;
    if (companyUrl) entries.companyUrl = companyUrl;

    // If the Qualify screen was "sending as" a specific owner, persist that so
    // the new CRM row immediately reflects who this lead is owned by.
    if (typeof owner === "string" && owner.trim()) {
      entries.owner = owner.trim();
    }

    // Mark freshly-qualified leads as "Currently researching" in the Status
    // column when they are first added from the Qualify screen, so Notion
    // views can filter on that tag. (Write is best-effort: if the Status
    // column doesn't have an option with this exact name, buildWrite() will
    // skip it gracefully.)
    entries.status = "Currently researching";

    const properties = writeProps(schema, entries);

    const page = await withRetry(
      () => getNotion().pages.create({ parent: { database_id: DATABASE_ID }, properties }),
      "pages.create"
    );

    // If a dossier was passed (from Qualify), write it into the new page's body.
    if (dossier) {
      try {
        await writeDossierToBody(page.id, dossier);
      } catch (e) {
        console.warn("dossier body write failed (continuing):", e?.message || e);
      }
    }

    res.json({ ok: true, notionPageId: page.id });
  } catch (err) {
    console.error("POST /api/add-to-crm failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Add to CRM failed" });
  }
});

/* 6) POST /api/parse-leads { text } -> { leads: [{name, company, linkedinUrl, companyUrl}] }
   LLM-cleans messy pasted input: routes URLs to the right field (so a LinkedIn
   link never lands in the company name), extracts names/companies, and derives
   a name from a profile slug when no name is given. */
app.post("/api/parse-leads", async (req, res) => {
  const { text } = req.body || {};
  try {
    if (typeof text !== "string" || !text.trim()) throw new Error("text is required");
    const resp = await withRetry(
      () =>
        getOpenAI().responses.create({
          model: OPENAI_MODEL,
          temperature: 0,
          input: [
            {
              role: "system",
              content:
                "You clean up a pasted list of sales leads into structured rows. The input is messy: " +
                "each lead may be on one line as 'Name, Company', or may include a LinkedIn profile URL " +
                "(linkedin.com/in/...) and/or a company website URL anywhere in the line. " +
                "RULES: Put the person's full name in `name`, the company in `company`, a LinkedIn profile " +
                "URL in `linkedinUrl`, and a company website URL in `companyUrl`. NEVER put a URL in `name` " +
                "or `company`. If a line is only a LinkedIn URL with no name, derive a plausible human name " +
                "from the profile slug (e.g. /in/jane-doe-123 -> 'Jane Doe'); leave company empty if unknown. " +
                "If a value is genuinely unknown, use an empty string. Return one row per distinct lead.",
            },
            { role: "user", content: `Parse these leads:\n\n${text.slice(0, 8000)}` },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "parsed_leads",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  leads: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        name: { type: "string" },
                        company: { type: "string" },
                        linkedinUrl: { type: "string" },
                        companyUrl: { type: "string" },
                      },
                      required: ["name", "company", "linkedinUrl", "companyUrl"],
                    },
                  },
                },
                required: ["leads"],
              },
            },
          },
        }),
      "openai.parse-leads"
    );
    const parsed = JSON.parse((resp.output_text || "{}").trim());
    res.json({ leads: Array.isArray(parsed.leads) ? parsed.leads : [] });
  } catch (err) {
    console.error("POST /api/parse-leads failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Parse failed" });
  }
});

/* 7) POST /api/photo { linkedinUrl } -> { photoUrl }
   Best-effort recipient photo for the preview. Tries to read the page's
   og:image via Firecrawl. LinkedIn usually serves a login wall, so this often
   returns null — the UI falls back to an initials avatar. Never throws. */
app.post("/api/photo", async (req, res) => {
  const { linkedinUrl } = req.body || {};
  try {
    if (!FIRECRAWL_API_KEY || !linkedinUrl || !/^https?:\/\//i.test(linkedinUrl)) {
      return res.json({ photoUrl: null });
    }
    const data = await firecrawlPost(
      "/scrape",
      { url: linkedinUrl, formats: ["markdown"], onlyMainContent: false, waitFor: 2000 },
      30000
    );
    const meta = data?.data?.metadata || {};
    let photo = meta.ogImage || meta["og:image"] || meta.image || null;
    if (Array.isArray(photo)) photo = photo[0] || null;
    // Only accept a real profile-media image; skip generic logos/login walls.
    const ok = typeof photo === "string" && /licdn\.com|cdn|profile|media/i.test(photo);
    res.json({ photoUrl: ok ? photo : null });
  } catch (err) {
    console.warn("POST /api/photo failed (returning null):", err?.message || err);
    res.json({ photoUrl: null });
  }
});

app.listen(PORT, () => {
  console.log(`Agilow Hub server listening on http://localhost:${PORT}`);
});
