import express from "express";
import multer from "multer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { searchJobs } from "./src/jobSources.mjs";
import { analyzeResume, rankJobs, writeCoverLetter } from "./src/claude.mjs";
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

const need = (res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(400).json({
      error:
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env, add your key, and restart.",
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
    if (!need(res)) return;
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
  if (!need(res)) return;
  const profile = await getProfile();
  if (!profile)
    return res.status(400).json({ error: "Add your resume first (Profile tab)." });
  const { jobs = [] } = req.body || {};
  if (!jobs.length) return res.status(400).json({ error: "No jobs to rank." });
  const ranked = await rankJobs({ profile, jobs });
  res.json({ jobs: ranked });
}));

// ---- Cover letter --------------------------------------------------------
app.post("/api/cover-letter", wrap(async (req, res) => {
  if (!need(res)) return;
  const profile = await getProfile();
  if (!profile)
    return res.status(400).json({ error: "Add your resume first (Profile tab)." });
  const { job } = req.body || {};
  if (!job) return res.status(400).json({ error: "No job provided." });
  const result = await writeCoverLetter({ profile, job });
  res.json(result);
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
  if (!process.env.ANTHROPIC_API_KEY)
    console.log("  ⚠  ANTHROPIC_API_KEY not set — add it to .env before using AI features.\n");
});
