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

// ---- RemoteOK (https://remoteok.com/api) — free, no key -----------------
async function fetchRemoteOK(query) {
  // RemoteOK filters by comma-separated tags; use the first meaningful word
  const tag = query.split(/\s+/)[0].toLowerCase();
  const data = await safeFetchJson(`https://remoteok.com/api?tags=${encodeURIComponent(tag)}&limit=50`);
  if (!Array.isArray(data)) return [];
  const q = query.toLowerCase();
  return data
    .filter((j) => j.id && j.position)
    .filter(
      (j) =>
        !q ||
        j.position?.toLowerCase().includes(q.split(/\s+/)[0]) ||
        (j.tags || []).some((t) => q.split(/\s+/).some((w) => t.toLowerCase().includes(w)))
    )
    .map((j) => ({
      id: `remoteok-${j.id}`,
      title: j.position,
      company: j.company || "",
      location: j.location || "Worldwide",
      remote: true,
      url: j.url || `https://remoteok.com/remote-jobs/${j.slug}`,
      description: clip(stripHtml(j.description || "")),
      tags: Array.isArray(j.tags) ? j.tags : [],
      salary: j.salary_min && j.salary_max ? `$${j.salary_min}–$${j.salary_max}` : "",
      source: "RemoteOK",
      postedAt: j.date || "",
    }));
}

// ---- Himalayas (https://himalayas.app/jobs/api) — free, no key -----------
async function fetchHimalayas(query) {
  const data = await safeFetchJson(
    `https://himalayas.app/jobs/api?limit=50&q=${encodeURIComponent(query)}`
  );
  if (!data?.jobs) return [];
  return data.jobs.map((j) => {
    const restrictions = j.locationRestrictions || [];
    const location = restrictions.length ? restrictions.join(", ") : "Worldwide";
    const sal =
      j.minSalary && j.maxSalary
        ? `${j.currency || ""}${Math.round(j.minSalary / 1000)}k–${Math.round(j.maxSalary / 1000)}k`
        : "";
    return {
      id: `himalayas-${j.guid || Math.random()}`,
      title: j.title,
      company: j.companyName || "",
      location,
      remote: true,
      url: j.applicationLink || `https://himalayas.app/companies/${j.companySlug}/jobs`,
      description: clip(stripHtml(j.excerpt || j.description || "")),
      tags: (j.categories || []).slice(0, 6).map((c) => c.toLowerCase().replace(/-/g, " ")),
      salary: sal,
      source: "Himalayas",
      postedAt: j.pubDate || "",
    };
  });
}

// ---- Active Jobs DB (active-jobs-db.p.rapidapi.com) — real ATS postings
// Pulls directly from company ATS systems (Workday, Greenhouse, Lever, SmartRecruiters…)
// India city support confirmed. Set RAPIDAPI_KEY in .env to enable.
// Endpoint: /active-ats  Required: time_frame (7d = last 7 days)
async function fetchActiveJobsDB(query, location) {
  const { RAPIDAPI_KEY } = process.env;
  if (!RAPIDAPI_KEY) return [];
  const params = new URLSearchParams({
    time_frame: "7d",
    limit: "20",
    offset: "0",
    title: query,
  });
  if (location) params.set("location", location);
  const data = await safeFetchJson(
    `https://active-jobs-db.p.rapidapi.com/active-ats?${params}`,
    { headers: { "x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": "active-jobs-db.p.rapidapi.com" } }
  );
  if (!Array.isArray(data)) return [];
  return data.map((j) => {
    const locs = j.locations_alt || [];
    const loc = locs[0] || (j.location_type === "REMOTE" ? "Remote" : "");
    const aiSal =
      j.ai_salary_min_value && j.ai_salary_max_value
        ? `${j.ai_salary_currency || ""} ${Math.round(j.ai_salary_min_value)}–${Math.round(j.ai_salary_max_value)} ${j.ai_salary_unit_text || ""}`.trim()
        : "";
    return {
      id: `activejobs-${j.id}`,
      title: j.title,
      company: j.organization || "",
      location: loc,
      remote: j.location_type === "REMOTE" || /remote/i.test(loc),
      url: j.url || "",
      description: clip(stripHtml(Array.isArray(j.ai_core_responsibilities) ? j.ai_core_responsibilities.join(" ") : (j.ai_requirements_summary || ""))),
      tags: j.ai_key_skills || [],
      salary: aiSal,
      source: `ActiveJobs·${j.source || "ATS"}`,
      postedAt: j.date_posted || "",
    };
  });
}

// ---- JSearch via RapidAPI — aggregates LinkedIn/Indeed/Glassdoor/ZipRecruiter
// Free tier: 500 req/month. Set RAPIDAPI_KEY in .env to enable.
// Best source for India-specific jobs — query includes city+country.
async function fetchJSearch(query, location) {
  const { RAPIDAPI_KEY } = process.env;
  if (!RAPIDAPI_KEY) return [];
  const q = location ? `${query} jobs in ${location}` : `${query} jobs`;
  const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q)}&num_pages=2&date_posted=month`;
  const data = await safeFetchJson(url, {
    headers: { "x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": "jsearch.p.rapidapi.com" },
  });
  if (!data?.data) return [];
  return data.data.map((j) => {
    const parts = [j.job_city, j.job_state, j.job_country].filter(Boolean);
    return {
      id: `jsearch-${j.job_id}`,
      title: j.job_title,
      company: j.employer_name || "",
      location: parts.join(", ") || (j.job_is_remote ? "Remote" : ""),
      remote: !!j.job_is_remote,
      url: j.job_apply_link || "",
      description: clip(stripHtml(j.job_description || "")),
      tags: [],
      salary:
        j.job_min_salary && j.job_max_salary
          ? `${j.job_salary_currency || ""} ${Math.round(j.job_min_salary)}–${Math.round(j.job_max_salary)}`
          : "",
      source: `JSearch·${j.job_publisher || "Indeed"}`,
      postedAt: j.job_posted_at_datetime_utc || "",
    };
  });
}

// ---- USAJOBS — official U.S. government job board, free API key
// Register free at https://developer.usajobs.gov/ to get USAJOBS_API_KEY.
// Set USAJOBS_EMAIL (the email you used to register) + USAJOBS_API_KEY in .env.
async function fetchUSAJobs(query, location) {
  const { USAJOBS_API_KEY, USAJOBS_EMAIL } = process.env;
  if (!USAJOBS_API_KEY || !USAJOBS_EMAIL) return [];
  const params = new URLSearchParams({ Keyword: query, ResultsPerPage: "25" });
  if (location) params.set("LocationName", location);
  const data = await safeFetchJson(`https://data.usajobs.gov/api/search?${params}`, {
    headers: {
      "User-Agent": `job-hunter/1.0 ${USAJOBS_EMAIL}`,
      "Authorization-Key": USAJOBS_API_KEY,
      Host: "data.usajobs.gov",
    },
  });
  if (!data?.SearchResult) return [];
  return (data.SearchResult.SearchResultItems || []).map((item) => {
    const j = item.MatchedObjectDescriptor;
    const rem = j.PositionSchedule?.[0]?.Name || "";
    const salObj = j.PositionRemuneration?.[0];
    return {
      id: `usajobs-${j.PositionID}`,
      title: j.PositionTitle,
      company: j.OrganizationName || "U.S. Government",
      location: j.PositionLocationDisplay || "USA",
      remote: /remote|telework/i.test(rem),
      url: j.PositionURI || "",
      description: clip(stripHtml(j.UserArea?.Details?.MajorDuties?.[0] || j.QualificationSummary || "")),
      tags: (j.JobCategory || []).map((c) => c.Name),
      salary: salObj ? `${salObj.MinimumRange}–${salObj.MaximumRange} ${salObj.RateIntervalCode}` : "",
      source: "USAJobs",
      postedAt: j.PublicationStartDate || "",
    };
  });
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
    fetchRemoteOK(query),
    fetchHimalayas(query),
    fetchActiveJobsDB(query, location), // direct ATS postings incl. India — needs RAPIDAPI_KEY
    fetchJSearch(query, location),      // LinkedIn/Indeed/Glassdoor — needs RAPIDAPI_KEY
    fetchUSAJobs(query, location),   // U.S. gov jobs — needs USAJOBS_API_KEY + USAJOBS_EMAIL
    fetchAdzuna(query, location),    // location-based — needs ADZUNA_APP_ID + ADZUNA_APP_KEY
  ]);
  let jobs = dedupe(results.flat());

  if (location.trim()) {
    const loc = location.toLowerCase().trim();
    // "Remote/Worldwide/Anywhere/Global" as the *entire* location = open to everyone.
    // "Remote USA" / "US Remote" / "Remote, Europe" = geographically restricted.
    // j.remote=true only means the work is remote, not that it's open to all countries.
    const GLOBALLY_OPEN = /^(remote|worldwide|anywhere|global)$/i;
    jobs = jobs.filter((j) => {
      const jloc = (j.location || "").toLowerCase().trim();
      if (!jloc) return true;                         // no restriction stated
      if (GLOBALLY_OPEN.test(jloc)) return true;      // exactly "Remote" / "Worldwide" etc.
      if (jloc.includes(loc)) return true;            // exact / partial match with user's location
      // multi-token: "bangalore india" → include if either word matches
      return loc.split(/[\s,]+/).some((word) => word.length > 2 && jloc.includes(word));
    });
  }

  return jobs;
}
