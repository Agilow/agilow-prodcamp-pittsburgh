# Agilow Hub

Finds people who run standups for software teams, scores how well they fit
app.agilow.ai, and writes the good ones to a Notion CRM. Leads arrive two ways:
you paste them into the Qualify screen, or the scout finds them on Reddit every
five hours.

## Quickstart

```bash
git clone https://github.com/Agilow/agilow-prodcamp-pittsburgh.git
cd agilow-prodcamp-pittsburgh
npm install
cd server && npm install && cp .env.example .env
```

Put your keys in `server/.env` (`OPENAI_API_KEY`, `NOTION_API_KEY`,
`NOTION_DATABASE_ID` are the three that matter), then run the two halves in
separate terminals:

```bash
cd server && npm run dev     # API on :8787
npm run dev                  # UI on :5173
```

## What you'll see when it works

Open **http://localhost:5173**. The Qualify screen is under the target icon in
the sidebar, or go straight to http://localhost:5173/#qualify.

Paste a couple of leads, one per line:

```
Priya Sharma, Scrum Master, Zeta Systems
Marcus Delgado — Engineering Manager — Fernwood Labs
```

Hit **Parse leads**, confirm the count, then **Score N leads**. Each row lands
with a verdict pill (Strong / Moderate / Moderate (unverified) / Weak), a
contact type, and an expandable panel of the A-E fit checks with evidence.
Scoring runs several web searches per lead, so budget about a minute each.

**Add to CRM** writes the lead to Notion with the full research dossier in the
page body.

To watch the scout instead:

```bash
curl -X POST http://localhost:8787/api/scout \
  -H "Authorization: Bearer $SCOUT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

`dryRun` does everything except the Notion write and returns what it *would*
have written. Takes 3-5 minutes.

## Requirements

- Node 18.18 or newer (`node -v`)
- An OpenAI API key
- A Notion integration token, and a database shared with that integration
- Optional: a Firecrawl key, which adds JS-rendered page scraping

The Notion database needs a **Draft** text column for write-back. Everything
else is optional and skipped gracefully if absent.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `OPENAI_API_KEY is not set` | `server/.env` missing or not loaded | `cp .env.example .env` inside `server/`, add the key, restart |
| `/api/leads` returns 500 | Database not shared with the integration | In Notion: database → ⋯ → Connections → add your integration |
| Qualify spins forever | Scoring genuinely takes ~1 min per lead | Watch the server log, each pass prints as it finishes |
| Scout returns 503 | `SCOUT_SECRET` not set | Set it in `server/.env`; unset disables the route rather than exposing it |
| Scout returns 401 | Token mismatch | The `Authorization: Bearer` value must equal `SCOUT_SECRET` exactly |
| Scout finds 4 of 20 feeds | Reddit rate-limiting your IP | Normal. It degrades to a smaller sweep and logs which feeds it skipped |
| UI loads, every API call fails | API not running, or wrong origin | Start `server/`, or set `VITE_API_URL` if the API is not on :8787 |

## Project structure

```
src/Hub.jsx              every UI screen: Qualify, Lead Queue, Drafts, Sent, Replies
src/hub.css              outreach-specific styles (design tokens live in styles.css)
src/api.js               API base URL, proxied to :8787 in dev

server/index.js          Express app: all routes, the Notion type-layer, qualifyOne
server/prompts.js        every system prompt, including the fit gate in RESEARCH_VERIFY
server/scout-config.js   what the scout looks at and how much it may spend
server/scout-sources.js  Reddit fetch plus the cheap relevance pre-filter

.github/workflows/scout.yml   the 5-hourly cron that calls /api/scout
render.yaml                   backend deploy blueprint
REPURPOSE-NOTES.md            why the scorer scores people and not companies
```

### The two flows

**Qualify** (`Hub.jsx` → `/api/parse-leads` → `/api/qualify` → `/api/add-to-crm`)
parses pasted text or a LinkedIn CSV export, scores each person, and writes the
ones you pick.

**Scout** (`/api/scout`) sweeps Reddit, triages cheaply with a small model,
drops anyone already in the CRM, scores what is left through the same engine,
and writes anything at Moderate or better. It runs on a GitHub Actions cron and
needs `SCOUT_URL` and `SCOUT_SECRET` as repo secrets.

### How scoring works

`RESEARCH_VERIFY` in `server/prompts.js` holds the gate. A lead passes if they
own a recurring ceremony for a software team (gate 0), then scores A-E: ceremony
ownership, team size, reachability, tooling, seniority. Verdicts cap at
`Moderate (unverified)` when a gating fact is unknown, and missing data never
produces `Weak`.

Reddit leads are scored differently, because a username is not a name. No web
research runs, the post itself is the evidence, and facts the author states
about themselves are tagged `[SELF-STATED]` and treated as established. The
identity tripwire that catches stale titles on pasted lists still fires for
anyone claiming a real name.
