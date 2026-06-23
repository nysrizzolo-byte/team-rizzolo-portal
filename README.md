# Team Rizzolo — Intranet Portal

A simple internal portal that pulls the team's tools together under one roof with tabbed navigation.

## Tabs
- **Metrics** — live now. Embeds the existing dashboard from https://nysrizzolo-byte.github.io/teamrizzolo/ via an iframe. The daily Cowork job that regenerates that dashboard is **untouched**.
- **AI Robot Trainer** — Training Studio (`trainer.html`). UI is live; the bots run on a local mock script. Real AI is Phase 4b.
- **DU Review** — placeholder. Will use **private Supabase Storage** (cloud, shared, behind login). Phase 3.

## Training Studio (`trainer.html`)
A self-contained training app loaded into the **AI Robot Trainer** tab.

**Four role tracks:** Junior · Loan Officer · LOA · Biz Development. Each track has:
- **Study** segments to read
- **Test** — multiple-choice quiz with instant scoring + explanations
- **Roleplay Bots** — a grid of bots = **4 scenarios × 10 difficulty levels** (1 = cooperative, 10 = hostile/suspicious)
- **Grading Metrics** — the dimensions each roleplay is scored on

**Two modes:**
- **Coach (Sal)** — you demonstrate the ideal handling against a bot, then capture your reasoning + rubric weights. This becomes the *golden answer* trainees are graded against.
- **Trainee** — study, test, then spar with the bots and get scored against Sal's golden answers.

**All content lives in the `TRACKS` object** at the top of `trainer.html` — segments, tests, scenarios, and metrics. You and Claude extend it there.

### Phase 4b — making the bots think
The bots currently reply from a local script (`getBotReply()`) so the studio works offline. To make them real:
1. A **Supabase Edge Function** (Deno) holds the Claude API key server-side and exposes `trainer-bot` + `grade-conversation` endpoints.
2. The browser calls those instead of the mock functions (the seam is marked in `trainer.html`).
3. Each bot's persona = scenario + difficulty + **Sal's golden examples** for that cell; grading compares the trainee transcript to Sal's golden answer on the track's metrics.

## How to view
Double-click `index.html` to open it in your browser. No build step, no dependencies.

> **Local note:** when opened with `file://`, some browsers (esp. Chrome) block the Trainer iframe from loading `trainer.html`. While testing locally, either open `trainer.html` directly, or run a tiny local server (`python3 -m http.server` in this folder). Once deployed to GitHub Pages (https), the iframe works exactly like Metrics.

## Build roadmap
1. **Portal shell** ✅ (this file) — tabs + live Metrics.
2. **Supabase Auth** — real team-only login on the portal. Needs the Project URL + anon key from Supabase → Settings → API.
3. **DU Review** — private Supabase Storage bucket (RLS-enforced, never public).
4. **AI Robot Trainer** — built when the tool is ready.

## Deploy
New GitHub repo → GitHub Pages (same flow as the `teamrizzolo` repo). Keep this **separate** from the `teamrizzolo` repo so the daily metrics job never overwrites it.

## Note on the Metrics tab
The embedded dashboard still has its own client-side `Rizzolo` password prompt; it will appear inside the Metrics tab until we later remove that gate (which lives in the daily Cowork generation prompt). The portal's own Supabase login is the real access control.
