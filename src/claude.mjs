// All Claude calls: resume analysis, job ranking, cover-letter writing.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const RANK_MODEL = process.env.RANK_MODEL || "claude-opus-4-8";
const WRITE_MODEL = process.env.WRITE_MODEL || "claude-opus-4-8";

// Call the Messages API with a JSON-schema-constrained output and parse it.
async function structured({ model, max_tokens, system, content, schema }) {
  const res = await client.messages.create({
    model,
    max_tokens,
    ...(system ? { system } : {}),
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema } },
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

// ---- Resume analysis -----------------------------------------------------
const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    targetTitles: { type: "array", items: { type: "string" } },
    seniority: { type: "string" },
    yearsExperience: { type: "number" },
    topSkills: { type: "array", items: { type: "string" } },
    locations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
  },
  required: [
    "name",
    "targetTitles",
    "seniority",
    "yearsExperience",
    "topSkills",
    "locations",
    "summary",
    "highlights",
  ],
};

export async function analyzeResume({ pdfBase64, text, role, location }) {
  const blocks = [];
  if (pdfBase64) {
    blocks.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfBase64,
      },
    });
  } else {
    blocks.push({ type: "text", text: `RESUME:\n${text}` });
  }
  blocks.push({
    type: "text",
    text:
      `Analyze this resume and extract a structured candidate profile for job matching. ` +
      `Infer experience level and a realistic set of target job titles. ` +
      (role ? `The candidate is aiming for roles like: "${role}". ` : "") +
      (location ? `Preferred location(s): "${location}". ` : "") +
      `"summary" should be a punchy 2-3 sentence positioning statement written in the third person. ` +
      `"highlights" should be 4-6 of the strongest, most quantified achievements.`,
  });

  return structured({
    model: WRITE_MODEL,
    max_tokens: 2000,
    content: blocks,
    schema: PROFILE_SCHEMA,
  });
}

// ---- Job ranking ---------------------------------------------------------
const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          matchScore: { type: "integer" },
          tier: {
            type: "string",
            enum: ["Top-tier", "Strong company", "Mid", "Early startup", "Low credibility"],
          },
          category: {
            type: "string",
            enum: ["Strong match", "Stretch", "High-probability"],
          },
          fitReasons: { type: "array", items: { type: "string" } },
          gaps: { type: "array", items: { type: "string" } },
        },
        required: ["id", "matchScore", "tier", "category", "fitReasons", "gaps"],
      },
    },
  },
  required: ["results"],
};

function profileSystemPrompt(profile) {
  return [
    {
      type: "text",
      text:
        `You are an expert technical recruiter scoring how well job postings fit a specific candidate. ` +
        `Be honest and calibrated — do not inflate scores.\n\n` +
        `CANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}\n\n` +
        `For each job return:\n` +
        `- matchScore: 0-100 realistic fit considering skills, seniority, and domain.\n` +
        `- tier: company quality bucket. Use "Low credibility" for staffing agencies / vague reposts.\n` +
        `- category: "Strong match" (apply now), "Stretch" (reach role), or "High-probability" (very likely to get an interview).\n` +
        `- fitReasons: 2-4 concrete reasons it fits.\n` +
        `- gaps: 0-3 honest gaps or risks.\n` +
        `Return one result object per job, keyed by the job id provided.`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

// Rank up to ~40 jobs in batches of 10 to keep each call small and reliable.
export async function rankJobs({ profile, jobs }) {
  const capped = jobs.slice(0, 40);
  const batches = [];
  for (let i = 0; i < capped.length; i += 10) batches.push(capped.slice(i, i + 10));

  const system = profileSystemPrompt(profile);
  const scoresById = {};

  const batchResults = await Promise.all(
    batches.map((batch) => {
      const compact = batch.map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        tags: j.tags,
        salary: j.salary,
        description: j.description,
      }));
      return structured({
        model: RANK_MODEL,
        max_tokens: 4000,
        system,
        content: [
          {
            type: "text",
            text: `Score these ${compact.length} jobs:\n${JSON.stringify(compact, null, 2)}`,
          },
        ],
        schema: RANK_SCHEMA,
      }).catch(() => ({ results: [] }));
    })
  );

  for (const r of batchResults) {
    for (const item of r.results || []) scoresById[item.id] = item;
  }

  // Merge scores back onto the full job objects; unscored jobs get a null score.
  return capped
    .map((j) => ({ ...j, ...(scoresById[j.id] || { matchScore: null }) }))
    .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
}

// ---- Cover letter + tailoring -------------------------------------------
const COVER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    coverLetter: { type: "string" },
    resumeTailoring: { type: "array", items: { type: "string" } },
    talkingPoints: { type: "array", items: { type: "string" } },
  },
  required: ["coverLetter", "resumeTailoring", "talkingPoints"],
};

export async function writeCoverLetter({ profile, job }) {
  return structured({
    model: WRITE_MODEL,
    max_tokens: 2000,
    content: [
      {
        type: "text",
        text:
          `Write a tailored, specific cover letter for this candidate and job. ` +
          `Sound human and confident, not generic or AI-flavored. No clichés ("I am excited to apply"), ` +
          `no filler. ~250 words, concrete, tied to the role.\n\n` +
          `Also return:\n` +
          `- resumeTailoring: 3-5 specific tweaks to make the resume land better for THIS job.\n` +
          `- talkingPoints: 3-5 points to raise in an interview for this role.\n\n` +
          `CANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}\n\n` +
          `JOB:\n${JSON.stringify(
            {
              title: job.title,
              company: job.company,
              location: job.location,
              description: job.description,
              tags: job.tags,
            },
            null,
            2
          )}`,
      },
    ],
    schema: COVER_SCHEMA,
  });
}
