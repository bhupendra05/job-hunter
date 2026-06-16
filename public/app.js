const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};

let lastRanked = []; // ranked jobs from the most recent search

// ---- Tabs ----------------------------------------------------------------
$$("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    $$("nav button").forEach((x) => x.classList.remove("active"));
    $$(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $(`#tab-${b.dataset.tab}`).classList.add("active");
    if (b.dataset.tab === "tracker") loadTracker();
  })
);

// ---- Profile -------------------------------------------------------------
function renderProfile(p) {
  if (!p) return;
  const view = $("#profile-view");
  view.style.display = "block";
  view.innerHTML = `
    <h2>${p.name || "Candidate"} <span class="chip">${p.seniority || ""}</span></h2>
    <p class="hint">${p.summary || ""}</p>
    <div class="profile-grid">
      <div><div class="k">Target titles</div><div class="chips">${(p.targetTitles || [])
        .map((t) => `<span class="chip">${t}</span>`)
        .join("")}</div></div>
      <div><div class="k">Experience</div><div>${p.yearsExperience ?? "—"} yrs</div></div>
    </div>
    <div class="k" style="margin-top:14px;">Top skills</div>
    <div class="chips">${(p.topSkills || []).map((t) => `<span class="chip">${t}</span>`).join("")}</div>
    <div class="k" style="margin-top:14px;">Highlights</div>
    <ul class="tight">${(p.highlights || []).map((h) => `<li>${h}</li>`).join("")}</ul>`;
}

$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  const status = $("#profile-status");
  btn.disabled = true;
  status.className = "status-msg";
  status.textContent = "Analyzing your resume with Claude…";
  try {
    const fd = new FormData(e.target);
    const p = await api("/api/profile", { method: "POST", body: fd });
    renderProfile(p);
    status.textContent = "✓ Profile saved. Head to “Find & Rank”.";
    if (p.preferredRole) $("#q").value = p.preferredRole;
    if (p.preferredLocation) $("#loc").value = p.preferredLocation;
  } catch (err) {
    status.className = "status-msg err";
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---- Search + Rank -------------------------------------------------------
function scoreClass(s) {
  if (s == null) return "s-na";
  if (s >= 75) return "s-hi";
  if (s >= 50) return "s-mid";
  return "s-lo";
}

function jobCard(j) {
  const sc = scoreClass(j.matchScore);
  const reasons = (j.fitReasons || []).length
    ? `<div class="reasons"><b>Why it fits</b><ul class="tight">${j.fitReasons
        .map((r) => `<li>${r}</li>`)
        .join("")}</ul></div>`
    : "";
  const gaps = (j.gaps || []).length
    ? `<div class="reasons"><b>Gaps</b><ul class="tight">${j.gaps
        .map((r) => `<li>${r}</li>`)
        .join("")}</ul></div>`
    : "";
  return `
    <div class="job">
      <div class="top">
        <div>
          <h3>${j.title}</h3>
          <div class="co">${j.company || "—"}</div>
          <div class="meta"><span>📍 ${j.location || "—"}</span><span>🔗 ${j.source}</span>${
    j.salary ? `<span>💰 ${j.salary}</span>` : ""
  }</div>
        </div>
        <div class="score ${sc}">${j.matchScore ?? "—"}<small>MATCH</small></div>
      </div>
      <div class="tags">
        ${j.category ? `<span class="tag cat">${j.category}</span>` : ""}
        ${j.tier ? `<span class="tag">${j.tier}</span>` : ""}
        ${(j.tags || []).slice(0, 4).map((t) => `<span class="tag">${t}</span>`).join("")}
      </div>
      ${reasons}${gaps}
      <div class="actions">
        <a href="${j.url}" target="_blank" rel="noopener"><button class="btn tiny">Open posting ↗</button></a>
        <button class="btn ghost tiny" data-cover="${j.id}">✍ Cover letter</button>
        <button class="btn ghost tiny" data-track="${j.id}">＋ Track</button>
      </div>
    </div>`;
}

$("#search-btn").addEventListener("click", async () => {
  const q = $("#q").value.trim();
  const loc = $("#loc").value.trim();
  const status = $("#search-status");
  const btn = $("#search-btn");
  if (!q) { status.className = "status-msg err"; status.textContent = "Enter some keywords."; return; }
  btn.disabled = true;
  status.className = "status-msg";
  status.textContent = "Searching job boards…";
  try {
    const { jobs } = await api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, location: loc }),
    });
    if (!jobs.length) { status.textContent = "No jobs found — try broader keywords."; lastRanked = []; $("#results").innerHTML = ""; return; }
    status.textContent = `Found ${jobs.length} jobs. Ranking the top matches with Claude…`;
    const ranked = await api("/api/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs }),
    });
    lastRanked = ranked.jobs;
    $("#results").innerHTML = ranked.jobs.map(jobCard).join("");
    status.textContent = `✓ Ranked ${ranked.jobs.length} jobs by fit.`;
  } catch (err) {
    status.className = "status-msg err";
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// Delegate cover-letter / track buttons
$("#results").addEventListener("click", (e) => {
  const coverId = e.target.dataset.cover;
  const trackId = e.target.dataset.track;
  if (coverId) openCover(lastRanked.find((j) => j.id === coverId));
  if (trackId) trackJob(lastRanked.find((j) => j.id === trackId), e.target);
});

// ---- Cover letter modal --------------------------------------------------
const modalBg = $("#modal-bg");
modalBg.addEventListener("click", (e) => { if (e.target === modalBg) modalBg.classList.remove("open"); });

async function openCover(job) {
  if (!job) return;
  modalBg.classList.add("open");
  $("#modal").innerHTML = `<button class="close">&times;</button>
    <h2>${job.title}</h2><div class="co">${job.company}</div>
    <p class="empty">Writing a tailored cover letter with Claude…</p>`;
  $("#modal .close").addEventListener("click", () => modalBg.classList.remove("open"));
  try {
    const r = await api("/api/cover-letter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job }),
    });
    $("#modal").innerHTML = `<button class="close">&times;</button>
      <h2>${job.title}</h2><div class="co">${job.company}</div>
      <h4>Cover letter</h4>
      <div class="letter" id="letter-text">${escapeHtml(r.coverLetter)}</div>
      <h4>Resume tailoring</h4><ul class="tight">${r.resumeTailoring.map((x) => `<li>${x}</li>`).join("")}</ul>
      <h4>Interview talking points</h4><ul class="tight">${r.talkingPoints.map((x) => `<li>${x}</li>`).join("")}</ul>
      <div class="actions">
        <button class="btn tiny" id="copy-letter">Copy letter</button>
        <button class="btn ghost tiny" id="save-letter">Save to tracker</button>
      </div>`;
    $("#modal .close").addEventListener("click", () => modalBg.classList.remove("open"));
    $("#copy-letter").addEventListener("click", () => {
      navigator.clipboard.writeText(r.coverLetter);
      $("#copy-letter").textContent = "Copied ✓";
    });
    $("#save-letter").addEventListener("click", async () => {
      await trackJob(job, null, { coverLetter: r.coverLetter, status: "applied" });
      $("#save-letter").textContent = "Saved ✓";
    });
  } catch (err) {
    $("#modal").innerHTML = `<button class="close">&times;</button><p class="status-msg err">${err.message}</p>`;
    $("#modal .close").addEventListener("click", () => modalBg.classList.remove("open"));
  }
}

function escapeHtml(s = "") {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- Tracker -------------------------------------------------------------
const STATUSES = ["saved", "applied", "interviewing", "closed"];
const STATUS_LABEL = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", closed: "Closed / Rejected" };

async function trackJob(job, btn, extra = {}) {
  if (!job) return;
  if (btn) { btn.disabled = true; btn.textContent = "Tracking…"; }
  await api("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: job.id, title: job.title, company: job.company,
      location: job.location, url: job.url, matchScore: job.matchScore, ...extra,
    }),
  });
  if (btn) btn.textContent = "Tracked ✓";
}

async function loadTracker() {
  const cols = $("#tracker-cols");
  let apps = [];
  try { apps = await api("/api/applications"); } catch {}
  cols.innerHTML = STATUSES.map((s) => {
    const items = apps.filter((a) => (a.status || "saved") === s);
    return `<div class="col"><h4>${STATUS_LABEL[s]} · ${items.length}</h4>
      ${items.length ? items.map(trackedCard).join("") : '<div class="empty">—</div>'}</div>`;
  }).join("");

  cols.querySelectorAll("select").forEach((sel) =>
    sel.addEventListener("change", async (e) => {
      await api(`/api/applications/${encodeURIComponent(e.target.dataset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: e.target.value }),
      });
      loadTracker();
    })
  );
  cols.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`/api/applications/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
      loadTracker();
    })
  );
  cols.querySelectorAll("[data-letter]").forEach((b) =>
    b.addEventListener("click", () => {
      const app = apps.find((a) => a.id === b.dataset.letter);
      modalBg.classList.add("open");
      $("#modal").innerHTML = `<button class="close">&times;</button>
        <h2>${app.title}</h2><div class="co">${app.company}</div>
        <h4>Saved cover letter</h4><div class="letter">${escapeHtml(app.coverLetter || "")}</div>`;
      $("#modal .close").addEventListener("click", () => modalBg.classList.remove("open"));
    })
  );
}

function trackedCard(a) {
  return `<div class="tracked">
    <h5>${a.title}</h5>
    <div class="co">${a.company || "—"}${a.matchScore != null ? ` · ${a.matchScore}% match` : ""}</div>
    <select data-id="${a.id}">
      ${STATUSES.map((s) => `<option value="${s}" ${(a.status || "saved") === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}
    </select>
    <div class="links">
      ${a.url ? `<a href="${a.url}" target="_blank" rel="noopener">Open ↗</a>` : ""}
      ${a.coverLetter ? `<a href="#" data-letter="${a.id}">Letter</a>` : ""}
      <a href="#" data-del="${a.id}" style="color:var(--red);">Remove</a>
    </div>
  </div>`;
}

// ---- Init ----------------------------------------------------------------
(async () => {
  try {
    const p = await api("/api/profile");
    if (p) {
      renderProfile(p);
      if (p.preferredRole) $("#q").value = p.preferredRole;
      if (p.preferredLocation) $("#loc").value = p.preferredLocation;
    }
  } catch {}
})();
