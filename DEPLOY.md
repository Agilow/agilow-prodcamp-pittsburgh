# Deploying Agilow Hub

Two pieces, deployed separately:
- **Frontend** (Vite/React static site) -> **Vercel**
- **Backend** (Express API) -> **Render**

Deploy the **backend first** so you have its URL for the frontend's env var.

---

## 1. Backend -> Render

The repo includes `render.yaml` (a Blueprint). Two ways:

**A. Blueprint (recommended)**
1. Push this repo to GitHub.
2. Render dashboard -> **New -> Blueprint** -> select the repo. It reads `render.yaml`
   and creates a web service `agilow-prodcamp-pittsburgh` with `rootDir: server`.
3. Fill the secret env vars (they're `sync:false`, so Render prompts for them):
   - `OPENAI_API_KEY`
   - `NOTION_API_KEY`
   - `NOTION_DATABASE_ID`
   - `CORS_ORIGIN` -> set **after** Vercel is live (your Vercel URL, e.g. `https://agilow-hub.vercel.app`). Leave blank for now.
   - `OPENAI_MODEL` is preset to `gpt-4.1`.
4. Deploy. Confirm health: open `https://<your-service>.onrender.com/api/health` -> `{"ok":true}`.

**B. Manual (no blueprint)**
- New -> **Web Service** -> repo. Set: **Root Directory** = `server`,
  **Build Command** = `npm install`, **Start Command** = `node index.js`.
- Add the same env vars. Do **not** set `PORT` (Render injects it; the server reads `process.env.PORT`).

Copy the service URL, e.g. `https://agilow-prodcamp-pittsburgh.onrender.com`.

> Free tier note: the service sleeps after inactivity, so the first request after
> idle (and the first `/api/leads` load) can take ~50s to cold-start.

---

## 2. Frontend -> Vercel

`vercel.json` is already set (framework `vite`, build `npm run build`, output `dist`, SPA rewrite).

1. Vercel dashboard -> **Add New -> Project** -> import the repo.
   Root directory = repo root (leave default). Framework auto-detects as Vite.
2. **Environment Variables** -> add:
   - `VITE_API_URL` = your Render origin from step 1 (no trailing slash),
     e.g. `https://agilow-prodcamp-pittsburgh.onrender.com`
3. Deploy. Vercel inlines `VITE_API_URL` at build time, so the app calls the Render
   backend directly (no proxy in production).

---

## 3. Close the CORS loop
Back in Render, set `CORS_ORIGIN` to your Vercel URL (comma-separated if multiple,
e.g. preview + prod) and redeploy. Unset = allow all origins (fine for testing, lock it down for prod).

---

## 4. Notion prerequisites (one-time)
- The integration must be **shared** with the database (Notion -> DB -> ••• -> Connections).
- The DB needs a **`Draft`** text column (write-back target). The server does **not**
  auto-create columns — it returns a clear error if `Draft` is missing.
- Each lead's **Owner** (select) sets who the message is from / signs it (defaults to "Shiv").

---

## Local development (unchanged)
```bash
# terminal 1
cd server && npm install && node index.js     # http://localhost:8787

# terminal 2
npm install && npm run dev                     # http://localhost:5173
```
Leave `VITE_API_URL` unset locally — the Vite dev proxy forwards `/api/*` to `:8787`.

## Env var reference
| Where | Var | Purpose |
|------|-----|---------|
| Render (backend) | `OPENAI_API_KEY` | OpenAI auth |
| Render | `NOTION_API_KEY` | Notion integration secret |
| Render | `NOTION_DATABASE_ID` | Leads database |
| Render | `OPENAI_MODEL` | defaults `gpt-4.1` |
| Render | `CORS_ORIGIN` | allowed frontend origin(s); unset = all |
| Render | `PORT` | **auto-set by Render** — do not set manually |
| Vercel (frontend) | `VITE_API_URL` | Render backend origin (build-time) |
