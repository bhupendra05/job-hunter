import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env manually (no dotenv dependency)
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file — ok */ }

import express from "express";
import multer from "multer";

import { searchJobs } from "./src/jobSources.mjs";
import {
  analyzeResume,
  rankJobs,
  writeCoverLetter,
  listModels,
  DEFAULT_MODEL,
} from "./src/gemini.mjs";
import {
  getProfile,
  saveProfile,
  getApplications,
  upsertApplication,
  updateApplication,
  deleteApplication,
} from "./src/store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ limits: { fileSize: 12 * 1024 * 1024 } }); // 12 MB

app.use(express.json({ limit: "4mb" }));
app.use(express.static(join(__dirname, "public")));

// Per-request Gemini credentials: prefer the key the browser sends, fall back to env.
const creds = (req) => ({
  apiKey: req.get("x-gemini-key") || process.env.GEMINI_API_KEY || "",
  model: req.get("x-gemini-model") || DEFAULT_MODEL,
});

const requireKey = (res, apiKey) => {
  if (!apiKey) {
    res.status(400).json({
      error: "No Gemini API key — open Settings (⚙ top-right) and paste your free key.",
    });
    return false;
  }
  return true;
};

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err?.message || "Server error" });
  });

// ---- Profile -------------------------------------------------------------
app.get("/api/profile", wrap(async (_req, res) => {
  res.json((await getProfile()) || null);
}));

app.post(
  "/api/profile",
  upload.single("resume"),
  wrap(async (req, res) => {
    const { apiKey, model } = creds(req);
    if (!requireKey(res, apiKey)) return;
    const { role = "", location = "", text = "" } = req.body || {};
    const pdfBase64 =
      req.file && req.file.mimetype === "application/pdf"
        ? req.file.buffer.toString("base64")
        : null;
    const resumeText =
      !pdfBase64 && req.file ? req.file.buffer.toString("utf8") : text;

    if (!pdfBase64 && !resumeText.trim()) {
      return res
        .status(400)
        .json({ error: "Upload a PDF resume or paste resume text." });
    }

    const profile = await analyzeResume({
      apiKey,
      model,
      pdfBase64,
      text: resumeText,
      role,
      location,
    });
    profile.preferredRole = role;
    profile.preferredLocation = location;
    profile.updatedAt = new Date().toISOString();
    await saveProfile(profile);
    res.json(profile);
  })
);

// ---- Search + Rank -------------------------------------------------------
app.post("/api/search", wrap(async (req, res) => {
  const { query = "", location = "" } = req.body || {};
  if (!query.trim()) return res.status(400).json({ error: "Enter a search query." });
  const jobs = await searchJobs({ query: query.trim(), location: location.trim() });
  res.json({ count: jobs.length, jobs });
}));

app.post("/api/rank", wrap(async (req, res) => {
  const { apiKey, model } = creds(req);
  if (!requireKey(res, apiKey)) return;
  const profile = await getProfile();
  if (!profile)
    return res.status(400).json({ error: "Add your resume first (Profile tab)." });
  const { jobs = [] } = req.body || {};
  if (!jobs.length) return res.status(400).json({ error: "No jobs to rank." });
  const ranked = await rankJobs({ apiKey, model, profile, jobs });
  res.json({ jobs: ranked });
}));

// Models the supplied key can use — populates the Settings dropdown.
app.get("/api/models", wrap(async (req, res) => {
  const { apiKey } = creds(req);
  if (!requireKey(res, apiKey)) return;
  res.json({ models: await listModels(apiKey) });
}));

// ---- Cover letter --------------------------------------------------------
app.post("/api/cover-letter", wrap(async (req, res) => {
  const { apiKey, model } = creds(req);
  if (!requireKey(res, apiKey)) return;
  const profile = await getProfile();
  if (!profile)
    return res.status(400).json({ error: "Add your resume first (Profile tab)." });
  const { job } = req.body || {};
  if (!job) return res.status(400).json({ error: "No job provided." });
  const result = await writeCoverLetter({ apiKey, model, profile, job });
  res.json(result);
}));

// ---- Debug endpoint (dev-only) -------------------------------------------
app.post("/api/debug-resume", wrap(async (req, res) => {
  const { apiKey, model } = creds(req);
  if (!requireKey(res, apiKey)) return;
  const { readFileSync } = await import("node:fs");
  const pdfPath = `${process.env.HOME}/Downloads/BhupendraTale Resume in pdf.pdf`;
  const pdfBase64 = readFileSync(pdfPath).toString("base64");
  // Call Gemini raw — return full API response for diagnosis
  const body = {
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
      { text: "Extract a JSON candidate profile. Return fields: name, targetTitles (array), seniority, yearsExperience (number), topSkills (array), locations (array), summary, highlights (array)." },
    ]}],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
  };
  const raw = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body),
  });
  const data = await raw.json().catch(() => ({}));
  res.json({ httpStatus: raw.status, finishReason: data?.candidates?.[0]?.finishReason, parts: (data?.candidates?.[0]?.content?.parts || []).map(p => ({ thought: p.thought, len: p.text?.length, preview: p.text?.slice(0, 200) })), error: data?.error });
}));

// ---- Application tracker -------------------------------------------------
app.get("/api/applications", wrap(async (_req, res) => {
  res.json(await getApplications());
}));

app.post("/api/applications", wrap(async (req, res) => {
  const apps = await upsertApplication(req.body || {});
  res.json(apps);
}));

app.patch("/api/applications/:id", wrap(async (req, res) => {
  const updated = await updateApplication(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
}));

app.delete("/api/applications/:id", wrap(async (req, res) => {
  res.json(await deleteApplication(req.params.id));
}));

const PORT = process.env.PORT || 4500;
app.listen(PORT, () => {
  console.log(`\n  job-hunter dashboard → http://localhost:${PORT}\n`);
  if (!process.env.GEMINI_API_KEY)
    console.log("  ℹ  No GEMINI_API_KEY in env — add your free key in the web UI (⚙ Settings).\n");
});
