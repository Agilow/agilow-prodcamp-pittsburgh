/* ============================================================
   Scout configuration.

   Everything tunable about the automated sweep lives here: where it
   looks, how much it is allowed to spend per run, and what is good
   enough to write to the CRM.

   This file has no imports and no side effects. Delete scout-config.js,
   scout-sources.js, the /api/scout route and the workflow, and the
   scout is gone without touching anything else.
   ============================================================ */

/* Subreddits where people who run standups actually talk about running them. */
export const SUBREDDITS = [
  "scrum",
  "agile",
  "projectmanagement",
  "ExperiencedDevs",
  "engineeringmanagement",
];

/* Search terms run per subreddit, on top of the /new sweep. These find the
   pain directly rather than hoping it floats to the top of new. */
export const SEARCH_TERMS = ["standup", "daily standup", "status meeting"];

/* Per-run caps. The scout is on a cron, so a small steady trickle beats a
   big sweep: a run that costs little can run every 5 hours forever. */
export const CAPS = {
  // Candidates kept after fetch + pre-filter, before dedupe.
  maxCandidatesPerRun: 15,
  // Leads actually scored. Each is several OpenAI calls, so this is the
  // number that matters for spend.
  maxScoredPerRun: 10,
  // Posts older than this are ignored.
  sinceDays: 7,
  // Stop scoring past this and return what is already written. The GitHub
  // Actions curl allows 600s; this leaves room for the write tail.
  budgetMs: 8 * 60 * 1000,
  // Concurrent qualifyOne calls. Matches QUALIFY_CONCURRENCY in index.js.
  scoreConcurrency: 3,
};

/* Verdicts worth a CRM row. Weak is dropped: the whole point of the gate is
   that we do not chase people who do not own a standup. */
export const WRITE_VERDICTS = ["Strong", "Moderate", "Moderate (unverified)"];

/* The pre-filter is a cheap triage pass over titles and snippets, so it runs
   on a small model. Kept here rather than hardcoded at the call site: the
   server otherwise reads exactly one model from OPENAI_MODEL, and a second
   hardcoded model is how a surprise bill happens. */
export const PREFILTER_MODEL = process.env.SCOUT_PREFILTER_MODEL || "gpt-4.1-mini";

/* Reddit rejects requests with a default or absent User-Agent, and rate-limits
   generic ones harder. Identify the bot honestly. */
export const USER_AGENT =
  process.env.SCOUT_USER_AGENT ||
  "agilow-hub-scout/1.0 (by /u/agilow; contact shaurya@agilow.ai)";

/* Owner written on scout-created CRM rows. Notion auto-creates select options
   on write, so this needs no setup in the CRM. */
export const SCOUT_OWNER = "Scout";
