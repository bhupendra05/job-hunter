// Google Gemini integration (free tier). Plain REST via global fetch — no SDK.
// The API key is supplied per-request (from the browser) or via GEMINI_API_KEY.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function generateJSON({ apiKey, model, parts, systemInstruction, schema, maxOutputTokens = 4096 }) {
  if (!apiKey)
    throw new Error("No Gemini API key — open Settings (⚙ top-right) and paste your free key.");
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      maxOutputTokens,
      temperature: 0.4,
    },
  };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

  const res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);

  const text =
    (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text)
      .filter(Boolean)
      .join("") || "";
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new Error("Empty response from Gemini" + (reason ? ` (${reason})` : ""));
  }
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Could not parse JSON from Gemini response.");
  }
}

// List models the supplied key can actually use (for the UI dropdown).
export async function listModels(apiKey) {
  if (!apiKey) throw new Error("No Gemini API key provided.");
  const res = await fetch(`${API_BASE}/models`, { headers: { "x-goog-api-key": apiKey } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => n.startsWith("gemini"));
}

// ---- Resume analysis -----------------------------------------------------
const PROFILE_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    targetTitles: { type: "ARRAY", items: { type: "STRING" } },
    seniority: { type: "STRING" },
    yearsExperience: { type: "NUMBER" },
    topSkills: { type: "ARRAY", items: { type: "STRING" } },
    locations: { type: "ARRAY", items: { type: "STRING" } },
    summary: { type: "STRING" },
    highlights: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["name", "targetTitles", "seniority", "yearsExperience", "topSkills", "locations", "summary", "highlights"],
};

export async function analyzeResume({ apiKey, model, pdfBase64, text, role, location }) {
  const parts = [];
  if (pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: pdfBase64 } });
  else parts.push({ text: `RESUME:\n${text}` });
  parts.push({
    text:
      `Analyze this resume and extract a structured candidate profile for job matching. ` +
      `Infer experience level and a realistic set of target job titles. ` +
      (role ? `The candidate is aiming for roles like: "${role}". ` : "") +
      (location ? `Preferred location(s): "${location}". ` : "") +
      `"summary" should be a punchy 2-3 sentence positioning statement in the third person. ` +
      `"highlights" should be 4-6 of the strongest, most quantified achievements.`,
  });
  return generateJSON({ apiKey, model, parts, schema: PROFILE_SCHEMA, maxOutputTokens: 2048 });
}

// ---- Job ranking ---------------------------------------------------------
const RANK_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          matchScore: { type: "INTEGER" },
          tier: { type: "STRING", enum: ["Top-tier", "Strong company", "Mid", "Early startup", "Low credibility"] },
          category: { type: "STRING", enum: ["Strong match", "Stretch", "High-probability"] },
          fitReasons: { type: "ARRAY", items: { type: "STRING" } },
          gaps: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["id", "matchScore", "tier", "category", "fitReasons", "gaps"],
      },
    },
  },
  required: ["results"],
};

function rankSystemPrompt(profile) {
  return (
    `You are an expert technical recruiter scoring how well job postings fit a specific candidate. ` +
    `Be honest and calibrated — do not inflate scores.\n\n` +
    `CANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}\n\n` +
    `For each job return: matchScore (0-100 realistic fit), tier (company-quality bucket; ` +
    `use "Low credibility" for staffing agencies / vague reposts), category ` +
    `("Strong match" = apply now, "Stretch" = reach role, "High-probability" = very likely interview), ` +
    `fitReasons (2-4 concrete reasons), and gaps (0-3 honest risks). One result per job, keyed by job id.`
  );
}

export async function rankJobs({ apiKey, model, profile, jobs }) {
  const capped = jobs.slice(0, 40);
  const batches = [];
  for (let i = 0; i < capped.length; i += 10) batches.push(capped.slice(i, i + 10));
  const systemInstruction = rankSystemPrompt(profile);
  const scoresById = {};

  const batchResults = await Promise.all(
    batches.map((batch) => {
      const compact = batch.map((j) => ({
        id: j.id, title: j.title, company: j.company,
        location: j.location, tags: j.tags, salary: j.salary, description: j.description,
      }));
      return generateJSON({
        apiKey, model, systemInstruction, schema: RANK_SCHEMA, maxOutputTokens: 4096,
        parts: [{ text: `Score these ${compact.length} jobs:\n${JSON.stringify(compact, null, 2)}` }],
      }).catch(() => ({ results: [] }));
    })
  );

  for (const r of batchResults) for (const item of r.results || []) scoresById[item.id] = item;

  return capped
    .map((j) => ({ ...j, ...(scoresById[j.id] || { matchScore: null }) }))
    .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
}

// ---- Cover letter + tailoring -------------------------------------------
const COVER_SCHEMA = {
  type: "OBJECT",
  properties: {
    coverLetter: { type: "STRING" },
    resumeTailoring: { type: "ARRAY", items: { type: "STRING" } },
    talkingPoints: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["coverLetter", "resumeTailoring", "talkingPoints"],
};

export async function writeCoverLetter({ apiKey, model, profile, job }) {
  return generateJSON({
    apiKey, model, schema: COVER_SCHEMA, maxOutputTokens: 2048,
    parts: [{
      text:
        `Write a tailored, specific cover letter for this candidate and job. ` +
        `Sound human and confident, not generic or AI-flavored. No clichés ("I am excited to apply"), ` +
        `no filler. ~250 words, concrete, tied to the role.\n\n` +
        `Also return: resumeTailoring (3-5 specific tweaks for THIS job) and ` +
        `talkingPoints (3-5 points to raise in an interview for this role).\n\n` +
        `CANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}\n\n` +
        `JOB:\n${JSON.stringify({ title: job.title, company: job.company, location: job.location, description: job.description, tags: job.tags }, null, 2)}`,
    }],
  });
}
