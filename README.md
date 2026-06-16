# Job Hunter

An **assisted** job-application engine you run locally. It goes further than the
"find jobs into a spreadsheet" workflow — it tailors and tracks too:

1. **Profile** — drop in your resume (PDF or text). Claude extracts a structured
   profile (titles, seniority, skills, highlights).
2. **Find & Rank** — pulls live postings from free job boards, then Claude scores
   every one against *your* profile: a match %, a company-quality tier, why it
   fits, and honest gaps. Sorted best-first.
3. **Tailor** — one click writes a specific, human-sounding cover letter for any
   job, plus resume tweaks and interview talking points for that role.
4. **Track** — save jobs and move them through `Saved → Applied → Interviewing →
   Closed`. Your saved cover letters live with each application.

> **Why not full auto-submit?** Blindly auto-submitting on LinkedIn/Indeed
> violates their Terms, risks an account ban, and fires off low-quality
> applications that hurt you. This tool does the 95% that actually moves the
> needle (find, rank, tailor, track) and leaves the final one-click submit to you.

## Job sources (no API key needed)

- **Remotive**, **Arbeitnow**, **Jobicy** — remote-focused, free, keyless.
- **Adzuna** (optional) — adds location-based / on-site coverage. Free tier;
  set `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` in `.env` to enable.

## Setup

```bash
cd ~/Developer/job-hunter
npm install
cp .env.example .env        # then add your ANTHROPIC_API_KEY
npm start
```

Open http://localhost:4500.

## Configuration (`.env`)

| Var | Default | Notes |
|-----|---------|-------|
| `ANTHROPIC_API_KEY` | — | Required. |
| `PORT` | `4500` | Dashboard port. |
| `RANK_MODEL` | `claude-opus-4-8` | Ranking is the high-volume step — switch to `claude-haiku-4-5` or `claude-sonnet-4-6` to cut cost. |
| `WRITE_MODEL` | `claude-opus-4-8` | Resume analysis + cover letters. |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` / `ADZUNA_COUNTRY` | — | Optional location-based source. |

## How it works

- Resume PDFs are sent straight to Claude as a document block (no parsing libs).
- Ranking batches ~10 jobs per call and caches your profile across batches.
- All output uses JSON-schema-constrained structured outputs.
- Storage is two JSON files under `data/` (gitignored) — no database.

## Notes

- Costs are billed to your Anthropic key. Searching is free; ranking + writing
  use the API. The top 40 results are ranked per search.
- This is a personal-use assistant. Respect each job board's terms of service.
