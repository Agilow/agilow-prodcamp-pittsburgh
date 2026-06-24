# Agilow Hub — Handoff

## What this is
"Agilow Hub" is the **outreach module** UI built on top of an existing internal Agilow
dashboard (a Vite + React sprint/standup tool). The Hub is **UI-only**: no backend, no auth,
no real API calls. All data is hardcoded mock data. It reuses the existing product's design
system exactly so it looks like the same app.

## Stack
- Vite + React (no TypeScript), plain JSX.
- **Styling is hand-written CSS, NOT Tailwind.** Design tokens live in CSS variables.
  Do not introduce Tailwind — match the existing system.
- `framer-motion` for transitions, `lucide-react` for icons.

## Run
```bash
npm install
npm run dev        # vite dev server
npm run build      # production build (verified passing)
```
- `?nosplash` query param skips the loading splash (used for screenshots/dev).
- URL hash deep-links a screen, e.g. `#drafts`, `#queue`, `#replies`, `#sent`, `#settings`.

## File map
| File | Role |
|------|------|
| `src/main.jsx` | Entry point. **Currently renders `<Hub />`** (was `<App />`). |
| `src/Hub.jsx` | **The entire outreach module** — all screens, mock data, shell, splash. New file. |
| `src/hub.css` | Outreach-specific styles only (stat strip, lead table, draft split, pills, settings). New file. |
| `src/App.jsx` | The **original** sprint dashboard. Left fully intact, just no longer mounted. |
| `src/styles.css` | Shared design system (tokens + base classes). Reused by both App and Hub. Unchanged. |
| `public/agi2-nobg.png` | Agilow logo used in sidebar + splash. |

To restore the original dashboard, change `main.jsx` back to import/render `App`.

## Design system (reused from styles.css — do not redefine)
CSS variables on `:root`:
- `--navy: #081426` (sidebar), `--coral: #e8472a` (accent), `--ink: #141414` (near-black text)
- `--muted: #6f6f68`, `--quiet: #9a9a92`, `--line: #e7e3dc` (borders)
- `--surface: #fbfaf8`, status colors `--green #0b7f56`, `--amber #b7791f`, `--red #c92a2a`, `--blue #2864c9`
- Main content bg is bone `#f0f0f0`/`#f6f4ef`, not pure white.

Reused base classes: `.app-shell`, `.sidebar`, `.sidebar-content`, `.brand`, `.quick-search`,
`.nav-list/.nav-item/.nav-count`, `.sidebar-section/.sidebar-label`, `.sprint-card`,
`.progress-line`, `.sidebar-footer`, `.avatar(.avatar-sm/-md)`, `.main`, `.page`,
`.page-header(.tight/.hero-header)`, `h1`, `.lede`, `.eyebrow`, `.decision-strip/.signal-cell`,
`.panel`, `.panel-title`, `.priority-panel`, `.queue-title`, `.pill.queue-count`,
`.decision-list/.decision-row/.decision-id/.decision-copy/.decision-meta`, `.status-dot`
(variants `.done`=green, `.active`=amber, `.blocked`=red), `.mobile-nav`.

Avatar color palette (rotate through these): `["#e8472a","#13294b","#5b5bd6","#b7791f","#087f5b"]`
(orange / navy / purple / tan-brown / green). Avatars are solid circles with white 2-letter initials.

Sidebar has an **animated topographic contour canvas** (`AnimatedBackground` in Hub.jsx, copied
verbatim from App.jsx) — the subtle wave-line texture. Splash screen is the same loading screen
as the main product.

## Screens (all in src/Hub.jsx)
Sidebar nav: Overview, Lead Queue (badge 10), Drafts, Sent, Replies (badge 4), Settings.
Below a "PIPELINE" label: a progress block — "This week" 32%, orange bar, "32 / 100 sent", "8 replies".
Footer: Shiv Panjwani / "Founder workspace".

1. **Overview** (`Overview`) — `<h1>Outreach</h1>` + summary line. 4-stat strip
   (Leads sourced 287, Messages sent 52, Reply rate 9%, Meetings booked 2). "Today Queue" card
   (6 lead rows: ID, company·contact, hook subtitle, channel tag, avatar). "Recent Replies" card
   (status dot + contact + snippet + time + avatar).
2. **Lead Queue** (`LeadQueue`) — segmented filter pills (All/InMail/LinkedIn/Email, client-side
   working) + search field (visual only). Table: checkbox, ID, company, contact+role, ICP-fit pill
   (high/med/low), Apollo source tag, channel chip, "Draft" button (navigates to Drafts for that lead).
3. **Drafts** (`Drafts`) — two-column split. Left = selectable lead list. Right = detail panel:
   contact/company header, "Signal" box, editable textarea with the drafted message, action row
   (Approve & Send / Edit / Skip). InMail drafts show "Sends from Shiv's Sales Navigator" note.
4. **Sent** (`Sent`) — list: ID, contact, channel chip, sent time, status pill (Delivered/Opened/Replied).
5. **Replies** (`Replies`) — list: status dot, contact·company, reply snippet, channel, "Book call" /
   "Mark positive" buttons.
6. **Settings** (`Settings`) — sending accounts (Sales Nav / team LinkedIn / email) with toggles,
   daily limits (number inputs), signal sources toggle. Toggles flip locally; inputs are uncontrolled.

## Mock data (top of src/Hub.jsx)
- `leads` — array of 10 lead objects, the core dataset. Shape:
  `{ id, company, contact, role, hook, signal, channel('inmail'|'linkedin'|'email'),
     icp('high'|'med'|'low'), initials, color, draft (the message body) }`.
  Used by Overview queue, Lead Queue table, and Drafts.
- `replies` — array of 4: `{ id, contact, company, initials, color, snippet, channel,
  status('good'|'pending'), time }`. Used by Overview + Replies.
- `sent` — array of 8: `{ id, contact, company, initials, color, channel, time,
  status('delivered'|'opened'|'replied') }`.
- `channelLabel` maps channel keys to display labels.

## State model (current)
- `Hub` holds: `splash`, `active` (current screen, synced to URL hash on init),
  `selectedDraftId`. `openDraft(id)` sets the selected lead and switches to the Drafts screen.
- `LeadQueue` holds local `filter` and `checked` (checkbox map).
- `Drafts` holds local `text` (textarea); resets via `useEffect` when the selected lead changes.
- `Settings` holds local `toggles`.

## IMPORTANT: what is mock-only (must be wired for a real backend)
This is intentionally a UI shell. Before/while connecting a backend:
1. **Data is module-level constants**, not fetched state. Lists can't change after an action.
   → Lift `leads`/`replies`/`sent` into state (context or top-level `useState`) fed by a fetch.
2. **Action buttons are inert** — no onClick logic: "Approve & Send", "Edit", "Skip",
   "Book call", "Mark positive", Settings toggles/inputs. → Add handlers calling the API.
3. **Draft edits don't persist** — `text` is local and resets on lead switch. → Lift to the record / PATCH.
4. **Counts are hardcoded** — sidebar badges (10, 4), "32 / 100 sent", all stat numbers.
   → Derive from fetched data.
5. **Lead Queue search input is not bound**; the filter pills work client-side only.

Recommended pre-wiring refactor (no visual change): introduce a thin data layer — lift the three
arrays into state, replace constants with stubbed async fetches returning the mock data, and pass
`onSend`/`onSkip`/`onBookCall`/`onSaveDraft` callbacks down so every screen is a pure render of props.
(This refactor was offered but NOT yet done — confirm before assuming it exists.)

## Verified
- `npm run build` passes.
- Overview screen visually confirmed via headless screenshot — matches the existing dashboard's
  navy-sidebar + bone-content + coral-accent system.
