const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};
const escapeHtml = (s = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let lastRanked = [];
const jobsById = {};
let selectedId = null;

// ---- Gemini key / model (browser only) -----------------------------------
function aiHeaders(extra = {}) {
  const h = { ...extra };
  const key = localStorage.getItem("gemini_key");
  const model = localStorage.getItem("gemini_model");
  if (key) h["x-gemini-key"] = key;
  if (model) h["x-gemini-model"] = model;
  return h;
}
function refreshKeyUI() {
  const has = !!localStorage.getItem("gemini_key");
  $("#key-dot").className = "dot " + (has ? "on" : "off");
  $("#key-banner").style.display = has ? "none" : "flex";
}

const modalBg = $("#modal-bg");
modalBg.addEventListener("click", (e) => { if (e.target === modalBg) modalBg.classList.remove("open"); });
const wireClose = () => $("#modal .close").addEventListener("click", () => modalBg.classList.remove("open"));

function openSettings() {
  modalBg.classList.add("open");
  const key = localStorage.getItem("gemini_key") || "";
  const model = localStorage.getItem("gemini_model") || "";
  $("#modal").innerHTML = `
    <button class="close">&times;</button>
    <h2>Gemini API key</h2>
    <div class="co">Free key from Google AI Studio. Stored only in this browser, sent only to your local server.</div>
    <label>API key</label>
    <input type="password" id="set-key" placeholder="AIza…" value="${key}" />
    <label>Model</label>
    <select id="set-model"><option value="${model}">${model || "gemini-2.5-flash (default)"}</option></select>
    <div class="help">No key yet? <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a free one →</a></div>
    <div class="actions">
      <button class="btn tiny" id="set-save">Save</button>
      <button class="btn ghost tiny" id="set-load">Load my models</button>
    </div>
    <div id="set-status" class="status-msg"></div>`;
  wireClose();
  $("#set-load").onclick = loadModels;
  $("#set-save").onclick = saveSettings;
}
async function loadModels() {
  const key = $("#set-key").value.trim();
  const status = $("#set-status");
  if (!key) { status.className = "status-msg err"; status.textContent = "Enter your key first."; return; }
  status.className = "status-msg"; status.textContent = "Fetching your available models…";
  try {
    const { models } = await api("/api/models", { headers: { "x-gemini-key": key } });
    if (!models.length) { status.textContent = "No usable models for this key."; return; }
    const pick = models.find((m) => /2\.5-flash/.test(m)) || models.find((m) => /flash/.test(m)) || models.find((m) => /pro/.test(m)) || models[0];
    $("#set-model").innerHTML = models.map((m) => `<option value="${m}" ${m === pick ? "selected" : ""}>${m}</option>`).join("");
    status.textContent = `✓ ${models.length} models available — pick one and Save.`;
  } catch (err) { status.className = "status-msg err"; status.textContent = err.message; }
}
function saveSettings() {
  const key = $("#set-key").value.trim();
  const model = $("#set-model").value;
  if (key) localStorage.setItem("gemini_key", key); else localStorage.removeItem("gemini_key");
  if (model) localStorage.setItem("gemini_model", model);
  refreshKeyUI();
  $("#set-status").className = "status-msg";
  $("#set-status").textContent = "✓ Saved.";
  setTimeout(() => modalBg.classList.remove("open"), 700);
}
$("#settings-btn").addEventListener("click", openSettings);
$("#banner-open").addEventListener("click", openSettings);

// ---- View switching (icon rail) ------------------------------------------
function showView(v) {
  $$(".rail nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === `view-${v}`));
  if (v === "tracker") loadTracker();
}
$$(".rail nav button").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.view === "settings") return openSettings();
    showView(b.dataset.view);
  })
);

// ---- Helpers -------------------------------------------------------------
const initials = (s = "") => (s.trim()[0] || "•").toUpperCase();
function timeAgo(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (isNaN(d)) return "";
  if (d < 1) return "today";
  if (d < 2) return "1 day ago";
  if (d < 30) return `${Math.floor(d)} days ago`;
  return `${Math.floor(d / 30)} mo ago`;
}
function scoreColor(s) { return s == null ? "var(--faint)" : s >= 75 ? "#34d399" : s >= 50 ? "#fbbf24" : "#f87171"; }
function buildRing(score, size = 132) {
  const r = 56, c = 2 * Math.PI * r, pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const off = c * (1 - pct / 100), col = scoreColor(score), cx = size / 2;
  return `<div class="ring" style="width:${size}px;height:${size}px;">
    <svg width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="12"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <div class="ring-label"><div class="num" style="color:${col}">${score ?? "—"}${score != null ? "%" : ""}</div><div class="cap">MATCH</div></div>
  </div>`;
}

// ---- Search + job list ---------------------------------------------------
$("#search-btn").addEventListener("click", runSearch);
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

async function runSearch() {
  const q = $("#q").value.trim();
  const loc = $("#loc").value.trim();
  const status = $("#search-status");
  const btn = $("#search-btn");
  showView("jobs");
  if (!q) { status.className = "status-msg err"; status.textContent = "Enter some keywords."; return; }
  btn.disabled = true;
  status.className = "status-msg"; status.textContent = "Searching job boards…";
  try {
    const { jobs } = await api("/api/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, location: loc }),
    });
    if (!jobs.length) { status.textContent = "No jobs found — try broader keywords."; renderJobList([]); return; }
    status.textContent = `Found ${jobs.length}. Ranking top matches with Gemini…`;
    const ranked = await api("/api/rank", {
      method: "POST", headers: aiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ jobs }),
    });
    lastRanked = ranked.jobs;
    renderJobList(lastRanked);
    status.textContent = `✓ Ranked ${lastRanked.length} by fit.`;
    if (lastRanked[0]) selectJob(lastRanked[0].id);
  } catch (err) {
    status.className = "status-msg err"; status.textContent = err.message;
  } finally { btn.disabled = false; }
}

function renderJobList(jobs) {
  Object.keys(jobsById).forEach((k) => delete jobsById[k]);
  jobs.forEach((j) => (jobsById[j.id] = j));
  $("#joblist-count").textContent = jobs.length;
  const items = $("#joblist-items");
  if (!jobs.length) { items.innerHTML = ''; if (!selectedId) renderDetail(null); return; }
  items.innerHTML = jobs.map((j) => `
    <div class="jobrow" data-id="${j.id}">
      <div class="av">${initials(j.company || j.title)}</div>
      <div class="jb">
        <h4>${j.title}</h4>
        <div class="co">${j.company || "—"}</div>
        <div class="lo">📍 ${j.location || "—"} · ${j.source}</div>
      </div>
      <div class="mini">
        <div class="mini-score" style="color:${scoreColor(j.matchScore)}">${j.matchScore ?? "—"}</div>
        <div class="mini-ago">${timeAgo(j.postedAt)}</div>
      </div>
    </div>`).join("");
  items.querySelectorAll(".jobrow").forEach((row) =>
    row.addEventListener("click", () => selectJob(row.dataset.id))
  );
}

function selectJob(id) {
  selectedId = id;
  $$("#joblist-items .jobrow").forEach((r) => r.classList.toggle("active", r.dataset.id === id));
  const job = jobsById[id];
  renderDetail(job);
  renderSide(job);
}

function renderDetail(job) {
  const d = $("#detail");
  if (!job) { d.innerHTML = `<div class="empty">🔍 Search for roles above, then pick one to see how well it fits you.</div>`; return; }
  const why = (job.fitReasons || []).length
    ? `<ul class="tight">${job.fitReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : `<div class="desc-text">—</div>`;
  const gaps = (job.gaps || []).length
    ? `<ul class="tight">${job.gaps.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : `<div class="desc-text">No major gaps flagged.</div>`;
  d.innerHTML = `
    <div class="detail-head">
      <div><h2>${escapeHtml(job.title)}</h2><div class="co">${escapeHtml(job.company || "—")} · 📍 ${escapeHtml(job.location || "—")}</div></div>
      <div class="detail-actions">
        <a href="${job.url}" target="_blank" rel="noopener"><button class="btn tiny">Open ↗</button></a>
        <button class="btn ghost tiny" id="d-cover">✍ Cover letter</button>
        <button class="btn ghost tiny" id="d-track">＋ Track</button>
      </div>
    </div>
    <div class="ring-row">
      ${buildRing(job.matchScore)}
      <div class="ring-meta">
        <div class="tagline">
          ${job.category ? `<span class="tag cat">${job.category}</span>` : ""}
          ${job.tier ? `<span class="tag tier">${job.tier}</span>` : ""}
          ${job.salary ? `<span class="tag">💰 ${escapeHtml(job.salary)}</span>` : ""}
        </div>
        <div class="desc-text">${job.matchScore != null ? `Gemini rates this a <b style="color:${scoreColor(job.matchScore)}">${job.matchScore}%</b> fit for your profile.` : "Not scored."}</div>
      </div>
    </div>
    <div class="fit-cards">
      <div class="card-mini why"><h4>✓ Why it fits</h4>${why}</div>
      <div class="card-mini gaps"><h4>△ Gaps</h4>${gaps}</div>
    </div>
    ${(job.tags || []).length ? `<div class="block"><h4>Tags</h4><div class="chips">${job.tags.slice(0, 10).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div></div>` : ""}
    <div class="block"><h4>About the role</h4><div class="desc-text">${escapeHtml(job.description || "")}</div></div>`;
  $("#d-cover").addEventListener("click", () => openCover(job));
  $("#d-track").addEventListener("click", (e) => trackJob(job, e.target));
}

function renderSide(job) {
  const p = $("#sidepanel");
  if (!job) { p.innerHTML = ""; return; }
  const col = scoreColor(job.matchScore);
  p.innerHTML = `
    <div class="panel glass">
      <div class="k">Company tier</div>
      <div class="tier-row"><span class="tier">${escapeHtml(job.tier || "—")}</span><span class="gauge" style="color:${col}">${job.matchScore ?? "—"}${job.matchScore != null ? "%" : ""}</span></div>
    </div>
    <div class="panel glass">
      <div class="k" style="margin-bottom:8px;">Details</div>
      <div class="kv"><span>Category</span><span>${job.category || "—"}</span></div>
      <div class="kv"><span>Source</span><span>${job.source || "—"}</span></div>
      <div class="kv"><span>Posted</span><span>${timeAgo(job.postedAt) || "—"}</span></div>
      <div class="kv"><span>Salary</span><span>${job.salary ? escapeHtml(job.salary) : "—"}</span></div>
    </div>
    <div class="panel glass">
      <div class="k" style="margin-bottom:10px;">Actions</div>
      <div class="actions">
        <button class="btn" id="s-cover">✍ Write cover letter</button>
        <button class="btn ghost" id="s-track">＋ Track this job</button>
        <a href="${job.url}" target="_blank" rel="noopener"><button class="btn ghost" style="width:100%;">Open posting ↗</button></a>
      </div>
    </div>`;
  $("#s-cover").addEventListener("click", () => openCover(job));
  $("#s-track").addEventListener("click", (e) => trackJob(job, e.target));
}

// ---- Cover letter modal --------------------------------------------------
async function openCover(job) {
  if (!job) return;
  modalBg.classList.add("open");
  $("#modal").innerHTML = `<button class="close">&times;</button><h2>${escapeHtml(job.title)}</h2><div class="co">${escapeHtml(job.company)}</div><p class="empty">Writing a tailored cover letter with Gemini…</p>`;
  wireClose();
  try {
    const r = await api("/api/cover-letter", {
      method: "POST", headers: aiHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ job }),
    });
    $("#modal").innerHTML = `<button class="close">&times;</button>
      <h2>${escapeHtml(job.title)}</h2><div class="co">${escapeHtml(job.company)}</div>
      <h4>Cover letter</h4><div class="letter">${escapeHtml(r.coverLetter)}</div>
      <h4>Resume tailoring</h4><ul class="tight">${r.resumeTailoring.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      <h4>Interview talking points</h4><ul class="tight">${r.talkingPoints.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      <div class="actions"><button class="btn tiny" id="copy-letter">Copy letter</button><button class="btn ghost tiny" id="save-letter">Save to tracker</button></div>`;
    wireClose();
    $("#copy-letter").addEventListener("click", () => { navigator.clipboard.writeText(r.coverLetter); $("#copy-letter").textContent = "Copied ✓"; });
    $("#save-letter").addEventListener("click", async () => { await trackJob(job, null, { coverLetter: r.coverLetter, status: "applied" }); $("#save-letter").textContent = "Saved ✓"; });
  } catch (err) {
    $("#modal").innerHTML = `<button class="close">&times;</button><p class="status-msg err">${err.message}</p>`;
    wireClose();
  }
}

// ---- Profile -------------------------------------------------------------
function renderProfile(p) {
  if (!p) return;
  if (p.name) $("#rail-avatar").textContent = initials(p.name);
  const view = $("#profile-view");
  view.style.display = "block";
  view.innerHTML = `
    <h2>${p.name || "Candidate"} <span class="chip">${p.seniority || ""}</span></h2>
    <p class="hint">${p.summary || ""}</p>
    <div class="profile-grid">
      <div><div class="k">Target titles</div><div class="chips">${(p.targetTitles || []).map((t) => `<span class="chip">${t}</span>`).join("")}</div></div>
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
  status.className = "status-msg"; status.textContent = "Analyzing your resume with Gemini…";
  try {
    const p = await api("/api/profile", { method: "POST", body: new FormData(e.target), headers: aiHeaders() });
    renderProfile(p);
    status.textContent = "✓ Profile saved. Search for jobs to see ranked matches.";
    if (p.preferredRole) $("#q").value = p.preferredRole;
    if (p.preferredLocation) $("#loc").value = p.preferredLocation;
  } catch (err) { status.className = "status-msg err"; status.textContent = err.message; }
  finally { btn.disabled = false; }
});

// ---- Tracker -------------------------------------------------------------
const STATUSES = ["saved", "applied", "interviewing", "closed"];
const STATUS_LABEL = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", closed: "Closed / Rejected" };

async function trackJob(job, btn, extra = {}) {
  if (!job) return;
  if (btn) { btn.disabled = true; btn.textContent = "Tracking…"; }
  await api("/api/applications", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, matchScore: job.matchScore, ...extra }),
  });
  if (btn) btn.textContent = "Tracked ✓";
}
async function loadTracker() {
  const cols = $("#tracker-cols");
  let apps = [];
  try { apps = await api("/api/applications"); } catch {}
  cols.innerHTML = STATUSES.map((s) => {
    const items = apps.filter((a) => (a.status || "saved") === s);
    return `<div class="col"><h4>${STATUS_LABEL[s]} · ${items.length}</h4>${items.length ? items.map(trackedCard).join("") : '<div class="empty">—</div>'}</div>`;
  }).join("");
  cols.querySelectorAll("select").forEach((sel) =>
    sel.addEventListener("change", async (e) => {
      await api(`/api/applications/${encodeURIComponent(e.target.dataset.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: e.target.value }) });
      loadTracker();
    }));
  cols.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => { await api(`/api/applications/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); loadTracker(); }));
  cols.querySelectorAll("[data-letter]").forEach((b) =>
    b.addEventListener("click", () => {
      const app = apps.find((a) => a.id === b.dataset.letter);
      modalBg.classList.add("open");
      $("#modal").innerHTML = `<button class="close">&times;</button><h2>${escapeHtml(app.title)}</h2><div class="co">${escapeHtml(app.company)}</div><h4>Saved cover letter</h4><div class="letter">${escapeHtml(app.coverLetter || "")}</div>`;
      wireClose();
    }));
}
function trackedCard(a) {
  return `<div class="tracked">
    <h5>${escapeHtml(a.title)}</h5>
    <div class="co">${escapeHtml(a.company || "—")}${a.matchScore != null ? ` · ${a.matchScore}% match` : ""}</div>
    <select data-id="${a.id}">${STATUSES.map((s) => `<option value="${s}" ${(a.status || "saved") === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select>
    <div class="links">
      ${a.url ? `<a href="${a.url}" target="_blank" rel="noopener">Open ↗</a>` : ""}
      ${a.coverLetter ? `<a href="#" data-letter="${a.id}">Letter</a>` : ""}
      <a href="#" data-del="${a.id}" style="color:#fca5a5;">Remove</a>
    </div></div>`;
}

// ---- Init ----------------------------------------------------------------
refreshKeyUI();
renderDetail(null);
(async () => {
  try {
    const p = await api("/api/profile");
    if (p) { renderProfile(p); if (p.preferredRole) $("#q").value = p.preferredRole; if (p.preferredLocation) $("#loc").value = p.preferredLocation; }
  } catch {}
})();
