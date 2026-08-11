# Repurpose notes — Qualify: company ICP scorer → person scorer

Salvaged from an uncommitted refactor that lived in
`~/Desktop/cold-outreach-shaurya/agilow-hub/agilow-prodcamp-pittsburgh/`
(based on `aebe21d`, 28 Jun 2026). That directory has been deleted; this file is
what was worth keeping.

**Why nothing was copied wholesale:**

1. It was based on `aebe21d`, two commits behind `main`. Copying it would have
   reverted `ac74f49`'s three-tier size rule and `1a5fdb2`'s aviation carve-out.
2. `server/prompts.js` there **did not parse** — the rewritten `RESEARCH_PROMPT`
   template literal was terminated with `` ` },{ `` (stray object syntax). The
   refactor never ran.
3. Its prompt changes rewrote `RESEARCH_PROMPT`, which is **dead code** — never
   imported by `server/index.js`. The live ICP gate lives in `RESEARCH_VERIFY`,
   which that refactor never touched. It would have changed zero verdicts.
4. Its target was different anyway: scoring people for a student's internship
   outreach, not scoring standup owners for app.agilow.ai.

The *shape* below is what transfers.

---

## 1. Person-as-title `PROPS` layout

The company-centric map makes `Company Name` the Notion **title** and demotes the
person to a secondary `rich_text`. Person-scoring inverts this: the person is the
row, the company is an attribute.

```js
const PROPS = {
  // Core identity
  contact: "Name",          // TITLE column = the person
  company: "Company",       // demoted to a plain property
  role: "Role",             // FIRST-CLASS — was annotated "not in this CRM"

  // Outreach metadata
  channel: "Channel",
  icp: "Connection Fit",    // select: Strong | Moderate | Moderate (unverified) | Weak
  personType: "Person Type",// select — NEW column, the contact-type taxonomy

  // Relationship + notes
  warmTie: "Warm Tie",      // replaces "Latest state " (note: had a trailing space)
  hook: "Hook",             // NEW — the specific thing to reference
  notes: "Notes",
  owner: "Owner",

  // Drafting + research (unchanged)
  draft, aiDraft, editReason, research, status,

  // Optional
  code, linkedin, companyUrl,
};
```

**Role as a first-class column is the single most important change.** The current
`qualifyOne()` hardcodes `leadTitle: ""` — it deliberately blanks the most
person-relevant field there is. Every person-level gate depends on the title.

## 2. Recommended Notion schema (carry into the CRM before flipping PROPS)

| Column | Type | Notes |
|---|---|---|
| Name | **Title** | the person |
| Company | Text or Select | |
| Role | Text | |
| LinkedIn | URL | |
| Connection Fit | Select | Strong / Moderate / Moderate (unverified) / Weak |
| Person Type | Select | see taxonomy below |
| Warm Tie | Text | |
| Hook | Text | |
| Status | Status | New / Researched / Drafted / Sent / Replied |
| Draft | Text | required for write-back |
| AI Draft | Text | |
| Edit Reason | Text | |
| Research | Text | |
| Notes | Text | |
| Channel, Website, Code | optional | supported if present |

**Migration warning:** flipping the title column from company to person is a
Notion-side schema change, not just a code change. Existing rows have the company
in their title. `resolveColName()` tolerates renames, not re-typings.

## 3. Person-type taxonomy replaces contact-type

The refactor swapped `ICP founder/exec | Connector | Engineer/IC | Adjacent |
Not relevant | Unknown` for a person-shaped set. Its values were tuned for
internship outreach (`Engineer/IC | Recruiter | Manager-EM | Senior-Leader | Not
relevant`), so they don't transfer directly — but the *move* does:

- classify **who the person is**, independent of the fit verdict
- drive `SUGGESTED INTENT` off the type, not off a default sales script
- keep a `Connector` escape hatch that bypasses the scoring gate entirely

Our taxonomy (standup automation): `Ceremony owner` / `Eng leader` / `Connector`
/ `IC` / `Not relevant` / `Unknown`.

**Must change together, same commit:** prompt taxonomy ↔ `extractVerdict` enum
(`server/index.js`) ↔ `contactTypeClass()` (`src/Hub.jsx`) ↔ pill CSS.

## 4. Seniority-sanity criterion

Its criterion `S. SENIORITY SANITY: neither too senior (C-level/VP) nor too
junior (<SWE I)` is the genuinely portable idea. Company ICPs gate on *company*
maturity; person ICPs need a **two-sided** seniority band — too junior can't
champion, too senior turns a $25/seat tool into a procurement cycle.

This becomes criterion **E** in the new gate, keeping the A–E letters so
`dossierToBlocks()`'s `/^[A-E]\.\s+/` bullet formatting survives.

## 5. Four-value connection-fit scale — keep verbatim

`Strong | Moderate | Moderate (unverified) | Weak`. The refactor kept these, and
so should we. The labels are independently re-derived by regex in six places
(`fitFromVerdict`, `normIcp`, `verdictIcpClass`, `verdictRank`, the
`extractVerdict` enum, `hub.css`). Renaming them is pure cost for zero gain —
score *people* on the same scale.

It also tightened `normIcp()` to check `"unverified"` before `"moderate"`, and
moved `STATUSES` to a person lifecycle (`new/researched/drafted/sent/replied`).
Both are small and worth taking.

## 6. `mapLead` inversion

```js
const contact = readProp(props, P.contact) || titleVal || "";  // person first
const company = readProp(props, P.company) || "";              // may be empty
hook: readProp(props, P.hook) || readProp(props, P.warmTie) || "",
```

Company may legitimately be empty for a person-shaped lead (a Reddit poster, a
community mod). The current `|| "Untitled"` company fallback assumes it never is.

---

## Carried forward untouched

Everything domain-neutral stays: `withRetry` / lazy clients / dns+undici
workarounds, the whole Notion type-layer (`resolveColName`, `readProp`,
`buildWrite`, `writeProps`, `richChunks`), `dossierToBlocks`, `runSearchPass`,
`mapLimit`, the three-tier source-confidence system with its aggregator
blocklist, the 60-day recency rule, the `turnXsearchN` fabrication ban, the
notes-vs-web reconciliation rule, and the bad-lead tripwire (renamed
PERSON–ROLE MISMATCH).
