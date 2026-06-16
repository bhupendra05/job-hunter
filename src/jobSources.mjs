// Free job-board fetchers. No API key required for Remotive / Arbeitnow / Jobicy.
// Adzuna is optional (free tier) and only used if credentials are set.
// Every source is normalized to a common job shape.

const UA = { "User-Agent": "job-hunter/1.0 (local job search assistant)" };

function stripHtml(html = "") {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text = "", n = 1500) {
  return text.length > n ? text.slice(0, n) + "…" : text;
}

async function safeFetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, { headers: UA, ...opts });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---- Remotive (https://remotive.com/api/remote-jobs) ---------------------
async function fetchRemotive(query) {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(
    query
  )}&limit=50`;
  const data = await safeFetchJson(url);
  if (!data?.jobs) return [];
  return data.jobs.map((j) => ({
    id: `remotive-${j.id}`,
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || "Remote",
    remote: true,
    url: j.url,
    description: clip(stripHtml(j.description)),
    tags: j.tags || [],
    salary: j.salary || "",
    source: "Remotive",
    postedAt: j.publication_date || "",
  }));
}

// ---- Arbeitnow (https://www.arbeitnow.com/api/job-board-api) --------------
async function fetchArbeitnow(query) {
  const data = await safeFetchJson(
    "https://www.arbeitnow.com/api/job-board-api"
  );
  if (!data?.data) return [];
  const q = query.toLowerCase();
  return data.data
    .filter(
      (j) =>
        !q ||
        j.title?.toLowerCase().includes(q) ||
        (j.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        j.description?.toLowerCase().includes(q)
    )
    .map((j) => ({
      id: `arbeitnow-${j.slug}`,
      title: j.title,
      company: j.company_name,
      location: j.location || (j.remote ? "Remote" : ""),
      remote: !!j.remote,
      url: j.url,
      description: clip(stripHtml(j.description)),
      tags: j.tags || [],
      salary: "",
      source: "Arbeitnow",
      postedAt: j.created_at
        ? new Date(j.created_at * 1000).toISOString()
        : "",
    }));
}

// ---- Jobicy (https://jobicy.com/api/v2/remote-jobs) -----------------------
async function fetchJobicy(query) {
  const url = `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(
    query
  )}`;
  const data = await safeFetchJson(url);
  if (!data?.jobs) return [];
  return data.jobs.map((j) => ({
    id: `jobicy-${j.id}`,
    title: j.jobTitle,
    company: j.companyName,
    location: j.jobGeo || "Remote",
    remote: true,
    url: j.url,
    description: clip(stripHtml(j.jobExcerpt || j.jobDescription || "")),
    tags: j.jobIndustry || [],
    salary:
      j.annualSalaryMin && j.annualSalaryMax
        ? `${j.salaryCurrency || ""}${j.annualSalaryMin}–${j.annualSalaryMax}`
        : "",
    source: "Jobicy",
    postedAt: j.pubDate || "",
  }));
}

// ---- Adzuna (optional, free tier — location-based coverage) ---------------
async function fetchAdzuna(query, location) {
  const { ADZUNA_APP_ID, ADZUNA_APP_KEY, ADZUNA_COUNTRY = "gb" } = process.env;
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) return [];
  const params = new URLSearchParams({
    app_id: ADZUNA_APP_ID,
    app_key: ADZUNA_APP_KEY,
    results_per_page: "30",
    what: query,
    "content-type": "application/json",
  });
  if (location) params.set("where", location);
  const url = `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/1?${params}`;
  const data = await safeFetchJson(url);
  if (!data?.results) return [];
  return data.results.map((j) => ({
    id: `adzuna-${j.id}`,
    title: j.title,
    company: j.company?.display_name || "",
    location: j.location?.display_name || "",
    remote: /remote/i.test(j.title + " " + (j.description || "")),
    url: j.redirect_url,
    description: clip(stripHtml(j.description)),
    tags: j.category?.label ? [j.category.label] : [],
    salary:
      j.salary_min && j.salary_max
        ? `${Math.round(j.salary_min)}–${Math.round(j.salary_max)}`
        : "",
    source: "Adzuna",
    postedAt: j.created || "",
  }));
}

// Dedupe by company+title (case-insensitive).
function dedupe(jobs) {
  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    if (!j.title || !j.url) continue;
    const key = `${(j.company || "").toLowerCase()}|${j.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

export async function searchJobs({ query, location = "" }) {
  const results = await Promise.all([
    fetchRemotive(query),
    fetchArbeitnow(query),
    fetchJobicy(query),
    fetchAdzuna(query, location),
  ]);
  return dedupe(results.flat());
}
