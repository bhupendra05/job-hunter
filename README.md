# Job Hunter

An **assisted** job-application engine you run locally, with a glassmorphism UI.
It goes further than the "find jobs into a spreadsheet" workflow — it tailors and
tracks too:

1. **Profile** — drop in your resume (PDF or text). Gemini extracts a structured
   profile (titles, seniority, skills, highlights).
2. **Find & Rank** — pulls live postings from free job boards, then Gemini scores
   every one against *your* profile: a match %, a company-quality tier, why it
   fits, and honest gaps. Sorted best-first.
3. **Tailor** — one click writes a specific, human-sounding cover letter for any
   job, plus resume tweaks and interview talking points for that role.
4. **Track** — save jobs and move them through `Saved → Applied → Interviewing →
   Closed`. Saved cover letters live with each application.

> **Why not full auto-submit?** Blindly auto-submitting on LinkedIn/Indeed
> violates their Terms, risks an account ban, and fires off low-quality
> applications that hurt you. This tool does the 95% that actually moves the
> needle (find, rank, tailor, track) and leaves the final one-click submit to you.

## Free — bring your own Gemini key (entered in the app)

Job Hunter runs on **Google Gemini's free tier**. You add your key **right in the
web UI** (⚙ button, top-right) — it's stored only in your browser (`localStorage`)
and sent only to your own local server. Nothing is committed or shared.

Get a free key in seconds at **https://aistudio.google.com/apikey**.

The Settings panel can **load the models your key supports** and let you pick one
(`gemini-2.5-flash` is a great free default; `gemini-2.5-pro` for higher quality).

## Job sources (no API key needed)

- **Remotive**, **Arbeitnow**, **Jobicy** — remote-focused, free, keyless.
- **Adzuna** (optional) — adds location-based / on-site coverage. Free tier;
  set `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` in `.env` to enable.

## Setup

```bash
cd ~/Developer/job-hunter
npm install
npm start          # → http://localhost:4500
```

Open http://localhost:4500, click **⚙ API key**, paste your free Gemini key,
hit **Load my models**, pick one, and **Save**. That's it.

(Optional: copy `.env.example` to `.env` to pre-fill the key/port for every
visitor instead of entering it in the UI.)

## Configuration (optional `.env`)

| Var | Default | Notes |
|-----|---------|-------|
| `GEMINI_API_KEY` | — | Optional — the UI key field overrides it. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Default model when none chosen in the UI. |
| `PORT` | `4500` | Dashboard port. |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` / `ADZUNA_COUNTRY` | — | Optional location-based source. |

## How it works

- Resume PDFs are sent straight to Gemini as inline data (no parsing libs).
- Ranking batches ~10 jobs per call; all AI output uses Gemini structured
  outputs (`responseSchema`) so it's always valid JSON.
- The Gemini key is supplied per-request from the browser (`x-gemini-key`
  header), so a hosted instance can be multi-user — each visitor uses their own
  key, billed to their own free quota.
- Storage is two JSON files under `data/` (gitignored) — no database. Only
  `express` + `multer` as dependencies; Gemini is called over plain REST.

## Notes

- Searching is free and keyless; ranking + writing use your Gemini quota.
  The top 40 results are ranked per search.
- This is a personal-use assistant. Respect each job board's terms of service.
