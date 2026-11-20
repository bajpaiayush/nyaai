const API = (window.location.hostname.includes("pages.dev") || window.location.hostname.includes("cloudflare"))
  ? "https://nyaai-1.onrender.com"
  : ""; // same-origin when running locally or on Render

const state = {
  view: "dashboard",
  cases: [],
  historicalCases: [],
  currentCaseId: null,
  currentCase: null,
  currentTab: "overview",
  documents: [],
  analyses: {},      // analysis_type -> result object (with .citations)
  citationGraphs: {}, // caseId -> citation graph data
  citationsMap: {},  // ref_key -> citation, scoped to last-rendered analysis
  loadingAnalysis: null,
  compareTargetId: null,
};

const main = document.getElementById("main");

// ---------------------------------------------------------------- API ----
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (e) {}
    throw new Error(detail);
  }
  return res.json();
}
const getJSON = (path) => api(path);
const postJSON = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
const patchJSON = (path, body) => api(path, { method: "PATCH", body: JSON.stringify(body) });

// ------------------------------------------------------------- helpers ---
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  if (s === undefined || s === null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function nl2br(s) { return esc(s).replace(/\n/g, "<br/>"); }

// -------------------------------------------------------- MODAL helper ----
function showErrorModal(message) {
  // Remove any existing modal
  const existing = document.getElementById("nya-modal-overlay");
  if (existing) existing.remove();

  const overlay = el(`
    <div id="nya-modal-overlay" style="
      position:fixed; inset:0; background:rgba(0,0,0,0.52); z-index:9000;
      display:flex; align-items:center; justify-content:center;
      animation:fadeIn .18s ease;
    ">
      <div style="
        background:#fff; border-radius:8px; max-width:520px; width:92%; padding:32px 36px;
        box-shadow:0 8px 40px rgba(0,0,0,0.26); position:relative;
        border-top:5px solid #c5221f;
      ">
        <div style="display:flex; align-items:flex-start; gap:14px; margin-bottom:18px;">
          <div style="font-size:28px; line-height:1;">⚠️</div>
          <div>
            <div style="font-weight:700; font-size:16px; color:#c5221f; margin-bottom:6px;">Case Type Not Supported</div>
            <div style="font-size:14px; color:#333; line-height:1.6;">${esc(message)}</div>
          </div>
        </div>
        <div style="background:#fff3cd; border:1px solid #ffeeba; border-radius:4px; padding:12px 14px; font-size:13px; color:#856404; margin-bottom:20px;">
          <strong>NyaAI</strong> is currently specialised for <strong>Land &amp; Property Cases</strong>.
          Support for other case types (Criminal, Civil, Matrimonial, etc.) will be added in future releases.
        </div>
        <button id="nya-modal-close" style="
          background:#1a3a5c; color:#fff; border:none; border-radius:4px; padding:10px 24px;
          font-size:14px; font-weight:600; cursor:pointer; letter-spacing:.04em;
        ">Understood — Go Back</button>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  document.getElementById("nya-modal-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

function refChips(refs) {
  if (!refs || !refs.length) return "";
  return refs.map(r => `<span class="ref-chip" data-ref="${esc(r)}">${esc(r)}</span>`).join("");
}

function attachRefChipHandlers(scopeEl) {
  scopeEl.querySelectorAll(".ref-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const citation = state.citationsMap[chip.dataset.ref];
      if (citation) openDrawer(citation);
    });
  });
}

function openDrawer(citation) {
  document.getElementById("drawer-content").innerHTML = `
    <h4>${esc(citation.case_name || citation.document_filename || "Source")}</h4>
    <div class="drawer-meta">
      ${citation.source_type === "historical_case" ? "Historical case" : "Current case document"}
      ${citation.document_filename ? " · " + esc(citation.document_filename) : ""}
      ${citation.page_number ? " · page " + esc(citation.page_number) : ""}
      ${citation.similarity_score != null ? " · relevance " + citation.similarity_score.toFixed(3) : ""}
    </div>
    <div class="drawer-excerpt">${esc(citation.excerpt || "(no excerpt captured)")}</div>
  `;
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawer-backdrop").classList.add("open");
}
function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawer-backdrop").classList.remove("open");
}
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);

function setCitationsMap(citations) {
  state.citationsMap = {};
  (citations || []).forEach(c => { state.citationsMap[c.ref_key] = c; });
}

// -------------------------------------------------------------- sidebar --
async function fetchCases() {
  state.cases = await getJSON("/cases");
}

function renderSidebar() {
  const list = document.getElementById("case-list");
  list.innerHTML = "";
  state.cases.forEach(c => {
    const item = el(`<div class="case-list-item ${c.id === state.currentCaseId ? "active" : ""}">${esc(c.title)}</div>`);
    item.addEventListener("click", () => openCase(c.id));
    list.appendChild(item);
  });
  document.getElementById("nav-dashboard").classList.toggle("active", state.view === "dashboard");
  document.getElementById("nav-corpus").classList.toggle("active", state.view === "corpus");
  document.getElementById("nav-search").classList.toggle("active", state.view === "search");
}

async function refreshSidebar() {
  await fetchCases();
  renderSidebar();
}

function navigateTo(hash) {
  if (window.location.hash === hash) {
    render({ refetch: false });
  } else {
    window.location.hash = hash;
  }
}

document.getElementById("nav-dashboard").addEventListener("click", () => navigateTo("#dashboard"));
document.getElementById("nav-corpus").addEventListener("click", () => navigateTo("#corpus"));
document.getElementById("nav-search").addEventListener("click", () => navigateTo("#search"));
document.getElementById("btn-new-case").addEventListener("click", () => navigateTo("#new-case"));

// ------------------------------------------------------------ dashboard --
async function renderDashboard() {
  const cases = state.cases;
  const analyzed = cases.filter(c => c.status === "analyzed").length;
  const indexed = cases.filter(c => c.status === "indexed").length;

  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <div class="sub">Case intelligence overview</div>
      </div>
      <button class="btn primary" id="dash-new-case">+ New case</button>
    </div>

    <div class="grid cols-3" style="margin-bottom:30px;">
      <div class="card"><div class="stat-num">${cases.length}</div><div class="stat-label">Total cases</div></div>
      <div class="card"><div class="stat-num">${indexed}</div><div class="stat-label">Documents indexed</div></div>
      <div class="card"><div class="stat-num">${analyzed}</div><div class="stat-label">Fully analyzed</div></div>
    </div>

    <h3 style="font-family:var(--serif); font-weight:400; font-size:17px; margin-bottom:14px;">Recent cases</h3>
    <div class="grid cols-2" id="dash-case-grid"></div>
  `;
  document.getElementById("dash-new-case").addEventListener("click", () => {
    navigateTo("#new-case");
  });

  const grid = document.getElementById("dash-case-grid");
  if (!cases.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-title">No cases yet</div>
      Create your first case to upload documents and run source-grounded analysis.
    </div>`;
    return;
  }
  cases.forEach(c => {
    const card = el(`<div class="card case-card">
      <div class="title">${esc(c.title)}</div>
      <div class="case-card-footer">
        <span class="meta">${esc(c.case_type || "Unspecified type")} &nbsp;&middot;&nbsp; <span class="status-pill ${c.status}">${esc(c.status)}</span></span>
        <button class="dash-delete-btn" data-id="${esc(c.id)}" title="Remove case" aria-label="Remove case">&#10005; Remove</button>
      </div>
    </div>`);

    // Open case on card click (but not on the delete button)
    card.addEventListener("click", (e) => {
      if (!e.target.closest(".dash-delete-btn")) openCase(c.id);
    });

    // Delete button
    card.querySelector(".dash-delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const confirmed = confirm(`Remove "${c.title}" permanently? This will also delete all its documents and analyses.`);
      if (!confirmed) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Deleting…";
      try {
        await api(`/cases/${c.id}`, { method: "DELETE" });
        if (state.currentCaseId === c.id) {
          state.currentCaseId = null;
          state.currentCase = null;
          state.view = "dashboard";
        }
        await render({ refetch: true });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "✕ Remove";
        alert("Could not delete case: " + err.message);
      }
    });

    grid.appendChild(card);
  });
}

// -------------------------------------------------------------- corpus --
async function renderCorpus() {
  state.corpus = state.corpus || { page: 1, limit: 20, q: "" };

  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Historical Case Corpus</h1>
        <div class="sub">The precedent library used for retrieval &amp; legal comparative analysis</div>
      </div>
    </div>
    <div class="synthetic-note" style="background:#e8f0fe; color:#1a73e8; border-color:#c5d7f8; margin-bottom:16px;">
      Real historical precedents from the Indian legal corpus (Indian Kanoon). Includes Supreme Court, High Court, and Tribunal judgments. Grounded retrieval is powered by this corpus.
    </div>

    <div class="card" style="margin-bottom:16px; padding:14px 18px;">
      <div style="display:flex; gap:12px; align-items:center;">
        <input type="text" id="corpus-search-input" placeholder="Search precedents by case name, court, or citation..." value="${esc(state.corpus.q)}" style="flex:1; font-size:14px;" />
        <button class="btn primary" id="corpus-search-btn" style="white-space:nowrap;">Search</button>
        ${state.corpus.q ? `<button class="btn ghost" id="corpus-clear-btn" style="white-space:nowrap;">Clear</button>` : ""}
      </div>
    </div>

    <div id="corpus-container">
      <div class="loading-line">Loading corpus precedents…</div>
    </div>
  `;

  document.getElementById("corpus-search-btn").addEventListener("click", () => {
    state.corpus.q = document.getElementById("corpus-search-input").value.trim();
    state.corpus.page = 1;
    loadCorpusPage();
  });

  document.getElementById("corpus-search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.corpus.q = e.target.value.trim();
      state.corpus.page = 1;
      loadCorpusPage();
    }
  });

  const clearBtn = document.getElementById("corpus-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.corpus.q = "";
      state.corpus.page = 1;
      renderCorpus();
    });
  }

  await loadCorpusPage();
}

async function loadCorpusPage() {
  const container = document.getElementById("corpus-container");
  if (!container) return;
  container.innerHTML = `<div class="loading-line">Loading page ${state.corpus.page}…</div>`;

  try {
    const url = `/historical-cases?page=${state.corpus.page}&limit=${state.corpus.limit}&envelope=true${state.corpus.q ? '&q=' + encodeURIComponent(state.corpus.q) : ''}`;
    const data = await getJSON(url);
    const items = data.items || [];
    const total = data.total || 0;
    const pages = data.pages || 1;
    const page = data.page || 1;

    function renderPaginationHtml() {
      return `
        <div class="pagination-bar">
          <div class="pagination-info">
            Showing <strong>${items.length ? (page - 1) * state.corpus.limit + 1 : 0}–${Math.min(page * state.corpus.limit, total)}</strong> of <strong>${total.toLocaleString()}</strong> precedents
          </div>
          <div class="pagination-controls">
            <button class="pagination-btn" id="p-first" ${page <= 1 ? "disabled" : ""}>⏮ First</button>
            <button class="pagination-btn" id="p-prev" ${page <= 1 ? "disabled" : ""}>◀ Prev</button>
            <span class="pagination-page-indicator">Page ${page} of ${pages}</span>
            <button class="pagination-btn" id="p-next" ${page >= pages ? "disabled" : ""}>Next ▶</button>
            <button class="pagination-btn" id="p-last" ${page >= pages ? "disabled" : ""}>Last ⏭</button>
          </div>
        </div>
      `;
    }

    if (!items.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No precedents found</div>
          ${state.corpus.q ? `No precedents matching "${esc(state.corpus.q)}". Try a different search term.` : "No precedents in database."}
        </div>
      `;
      return;
    }

    container.innerHTML = `
      ${renderPaginationHtml()}
      <div class="grid cols-2" id="corpus-grid"></div>
      ${renderPaginationHtml()}
    `;

    const grid = container.querySelector("#corpus-grid");
    items.forEach(hc => {
      grid.appendChild(el(`
        <div class="card" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div class="title" style="font-weight:600; font-size:15px; margin-bottom:6px; color:var(--navy);">${esc(hc.case_name)}</div>
            <div class="meta" style="color:var(--muted); font-size:12px; margin-bottom:10px;">
              ${esc(hc.court || "High Court / Supreme Court")} ${hc.year ? "· " + hc.year : ""} ${hc.citation ? "· " + esc(hc.citation) : ""}
            </div>
            <div style="font-size:12.5px; font-weight:600; color:var(--saffron); margin-bottom:8px;">${esc(hc.case_type || "Land & Property Dispute")}</div>
            <div style="font-size:13px; color:var(--muted); line-height:1.45;">${esc((hc.summary || "").slice(0, 240))}…</div>
          </div>
          <div style="margin-top:14px; padding-top:10px; border-top:1px solid var(--cream-border); display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11.5px; color:var(--muted);">${hc.document_count ? hc.document_count + " document(s)" : "Corpus record"}</span>
            <button class="btn ghost small btn-compare-hc" data-id="${esc(hc.id)}" data-name="${esc(hc.case_name)}">⚖️ Compare Target</button>
          </div>
        </div>
      `));
    });

    container.querySelectorAll(".btn-compare-hc").forEach(btn => {
      btn.addEventListener("click", () => {
        state.compareTargetId = btn.dataset.id;
        if (state.currentCaseId) {
          openCase(state.currentCaseId, "compare");
        } else if (state.cases && state.cases.length) {
          openCase(state.cases[0].id, "compare");
        } else {
          alert("Open an active case first to run comparison against " + btn.dataset.name);
        }
      });
    });

    container.querySelectorAll("#p-first").forEach(b => b.addEventListener("click", () => {
      if (state.corpus.page > 1) { state.corpus.page = 1; loadCorpusPage(); }
    }));
    container.querySelectorAll("#p-prev").forEach(b => b.addEventListener("click", () => {
      if (state.corpus.page > 1) { state.corpus.page--; loadCorpusPage(); }
    }));
    container.querySelectorAll("#p-next").forEach(b => b.addEventListener("click", () => {
      if (state.corpus.page < pages) { state.corpus.page++; loadCorpusPage(); }
    }));
    container.querySelectorAll("#p-last").forEach(b => b.addEventListener("click", () => {
      if (state.corpus.page < pages) { state.corpus.page = pages; loadCorpusPage(); }
    }));

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">Couldn't load corpus</div>${esc(err.message)}</div>`;
  }
}

// ------------------------------------------------------------ new case --
function renderNewCase() {
  main.innerHTML = `
    <div class="page-header"><div><h1>Register New Case</h1><div class="sub">Import from an online judgment URL or create manually</div></div></div>
    <div class="synthetic-note" style="background:#fff3cd; color:#856404; border-color:#ffeeba; margin-bottom:20px;">
      <strong>Note:</strong> NyaAI is currently specialized for <strong>Land &amp; Property Cases</strong>.
    </div>

    <div class="grid cols-2" style="gap:24px; max-width:1050px;">
      <div class="card">
        <h3 style="margin-top:0;">Option A: Import from URL (Indian Kanoon / Court)</h3>
        <p style="font-size:13px; color:var(--muted); margin-bottom:14px;">Paste an Indian Kanoon or public court land judgment URL. NyaAi will acquire the document, clean the text, extract its legal profile, and index it automatically.</p>
        <label>Judgment URL</label>
        <input type="url" id="f-url" placeholder="https://indiankanoon.org/doc/154031036/" />
        <label>Case Type</label>
        <input type="text" id="f-url-type" placeholder="e.g. Land Acquisition, Property Dispute" value="Land Acquisition" />
        <div class="form-actions" style="margin-top:16px;">
          <button class="btn primary" id="f-url-submit">Acquire &amp; Index Case</button>
        </div>
        <div id="url-status" style="margin-top:10px;"></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0;">Option B: Enter Case Details Manually</h3>
        <label>Case title</label>
        <input type="text" id="f-title" placeholder="e.g. Ramesh Chandra v. State — Land Title Dispute" />
        <label>Case type</label>
        <input type="text" id="f-type" placeholder="e.g. Land Dispute - Tenancy, Partition Suit" value="Land Dispute" />
        <label>Facts</label>
        <textarea id="f-facts" placeholder="Detail the land ownership, possession, or acquisition facts..."></textarea>
        <label>Charges / legal issues</label>
        <textarea id="f-issues" placeholder="Specify land title claims, compensation dispute, or boundary issues..."></textarea>
        <label>Arguments (one per line)</label>
        <textarea id="f-arguments" placeholder="Petitioner: Claimant has valid registered sale deed since 1985...&#10;Respondent: Land acquired under Land Acquisition Act..."></textarea>
        <label>Evidence on hand (one item per line)</label>
        <textarea id="f-evidence" placeholder="e.g. Registered Sale Deed, Khatian records, Revenue receipt"></textarea>
        <div class="form-actions">
          <button class="btn primary" id="f-submit">Create Case</button>
          <button class="btn ghost" id="f-cancel">Cancel</button>
        </div>
        <div id="manual-status" style="margin-top:10px;"></div>
      </div>
    </div>
  `;

  document.getElementById("f-cancel").addEventListener("click", () => {
    navigateTo("#dashboard");
  });
  
  // URL Import handler
  document.getElementById("f-url-submit").addEventListener("click", async () => {
    const url = document.getElementById("f-url").value.trim();
    if (!url) { alert("Please enter a valid judgment URL."); return; }
    const status = document.getElementById("url-status");
    status.innerHTML = `<div class="loading-line">Acquiring document, extracting legal profile &amp; indexing…</div>`;
    try {
      const c = await postJSON("/cases/from-url", {
        url,
        case_type: document.getElementById("f-url-type").value.trim() || "Land Dispute",
      });
      status.innerHTML = "";
      await openCase(c.id);
    } catch (err) {
      status.innerHTML = "";
      const msg = err.message || "Unknown error";
      if (msg.toLowerCase().includes("land") || msg.toLowerCase().includes("designed for")) {
        showErrorModal(msg);
      } else {
        status.innerHTML = `<div style="color:var(--danger); font-size:13.5px; background:#fce8e6; padding:10px 14px; border-radius:4px; margin-top:8px;">${esc(msg)}</div>`;
      }
    }
  });

  // Manual Form handler
  document.getElementById("f-submit").addEventListener("click", async () => {
    const title = document.getElementById("f-title").value.trim();
    if (!title) { alert("Please give the case a title."); return; }
    const status = document.getElementById("manual-status");
    status.innerHTML = `<div class="loading-line">Creating case…</div>`;
    const payload = {
      title,
      case_type: document.getElementById("f-type").value.trim() || "Land Dispute",
      facts: document.getElementById("f-facts").value.trim(),
      charges_issues: document.getElementById("f-issues").value.trim(),
      arguments_text: document.getElementById("f-arguments").value.trim(),
      evidence_text: document.getElementById("f-evidence").value.trim(),
    };
    try {
      const c = await postJSON("/cases", payload);
      status.innerHTML = "";
      await openCase(c.id);
    } catch (err) {
      status.innerHTML = "";
      const msg = err.message || "Unknown error";
      if (msg.toLowerCase().includes("land") || msg.toLowerCase().includes("designed for")) {
        showErrorModal(msg);
      } else {
        status.innerHTML = `<div style="color:var(--danger); font-size:13.5px; background:#fce8e6; padding:10px 14px; border-radius:4px; margin-top:8px;">${esc(msg)}</div>`;
      }
    }
  });
}

// --------------------------------------------------------- case workspace
async function openCase(caseId, tab = "overview") {
  state.currentCaseId = caseId;
  state.view = "case";
  state.currentTab = tab;
  state.analyses = {};
  navigateTo(`#case/${caseId}/${tab}`);
}

async function loadCaseData() {
  state.currentCase = await getJSON(`/cases/${state.currentCaseId}`);
  state.documents = await getJSON(`/cases/${state.currentCaseId}/documents`);
  try {
    const list = await getJSON(`/cases/${state.currentCaseId}/analysis`);
    (list || []).forEach(a => {
      if (a.analysis_type && a.content && !state.analyses[a.analysis_type]) {
        const val = a.content[a.analysis_type];
        // Do not cache empty arrays in state.analyses so tabs fetch live populated results
        if (!Array.isArray(val) || val.length > 0) {
          state.analyses[a.analysis_type] = { analysis_id: a.id, ...a.content, citations: a.citations || [] };
        }
      }
    });
  } catch (e) {}
}

const TABS = [
  ["overview", "Overview"],
  ["documents", "Documents"],
  ["similar", "Similar Cases"],
  ["graph", "Citation Graph"],
  ["legal", "Legal Analysis"],
  ["prosecution-defence", "Arguments"],
  ["evidence", "Evidence"],
  ["contradictions", "Contradictions"],
  ["compare", "Case Comparison"],
  ["brief", "Pre-Hearing Brief"],
];

function renderCaseWorkspace() {
  const c = state.currentCase;
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${esc(c.title)}</h1>
        <div class="sub">${esc(c.case_type || "Unspecified type")} ${c.legal_domain ? "· " + esc(c.legal_domain) : ""} ${c.case_number ? "· #" + esc(c.case_number) : ""}</div>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <span class="status-pill ${c.status}">${esc(c.status)}</span>
        <button class="btn ghost" id="btn-export-pdf" style="display:none;">Export PDF</button>
        <button class="btn primary" id="btn-analyze">Analyze case</button>
      </div>
    </div>
    <div class="tabs" id="tabs"></div>
    <div id="tab-content"></div>
  `;
  const tabsEl = document.getElementById("tabs");
  TABS.forEach(([key, label]) => {
    const t = el(`<div class="tab ${state.currentTab === key ? "active" : ""}">${label}</div>`);
    t.addEventListener("click", () => { state.currentTab = key; renderTabContent(); syncTabHighlight(); updateHash(); });
    tabsEl.appendChild(t);
  });
  document.getElementById("btn-analyze").addEventListener("click", runFullAnalysis);
  
  const btnExport = document.getElementById("btn-export-pdf");
  if (c.status === "analyzed") {
      btnExport.style.display = "inline-flex";
      btnExport.addEventListener("click", () => {
          window.open(`${API}/cases/${state.currentCaseId}/brief/export`, "_blank");
      });
  }
  
  renderTabContent();
}
function syncTabHighlight() {
  [...document.querySelectorAll(".tab")].forEach((t, i) => t.classList.toggle("active", TABS[i][0] === state.currentTab));
}

async function runFullAnalysis() {
  const btn = document.getElementById("btn-analyze");
  btn.disabled = true;
  btn.innerHTML = `<span style="display:inline-block; animation:spin 1s linear infinite; margin-right:6px;">⚙</span> Analyzing pipelines…`;
  
  const holder = document.getElementById("tab-content");
  if (holder) {
    holder.innerHTML = `
      <div class="card" style="text-align:center; padding:40px 20px;">
        <div style="font-size:24px; margin-bottom:12px;">⚖️</div>
        <h3 style="margin:0 0 8px 0; font-family:var(--serif);">Synthesizing Legal Precedents &amp; Arguments</h3>
        <p style="color:var(--muted); font-size:13.5px; max-width:540px; margin:0 auto 16px auto;">
          Querying precedent corpus, computing statutory overlap, and running AI decision-support synthesis...
        </p>
        <div class="loading-line" style="margin:0 auto; width:180px;"></div>
      </div>
    `;
  }

  try {
    const result = await postJSON(`/cases/${state.currentCaseId}/analyze`, {});
    state.analyses = result;
    await loadCaseData();
    await fetchCases();
    renderSidebar();
    state.currentTab = "similar";
    updateHash();
    renderCaseWorkspace();
  } catch (e) {
    showErrorModal("Analysis failed: " + e.message);
    if (holder) {
      holder.innerHTML = `<div class="empty-state"><div class="empty-title">Couldn't complete analysis</div>${esc(e.message)}</div>`;
    }
  } finally {
    const currentBtn = document.getElementById("btn-analyze");
    if (currentBtn) {
      currentBtn.disabled = false;
      currentBtn.textContent = "Analyze case";
    }
  }
}

function renderTabContent() {
  const holder = document.getElementById("tab-content");
  switch (state.currentTab) {
    case "overview": return renderOverviewTab(holder);
    case "documents": return renderDocumentsTab(holder);
    case "similar": return renderAnalysisTab(holder, "similar_cases", "/similar-cases", renderSimilarCases);
    case "graph": return renderGraphTab(holder);
    case "legal": return renderAnalysisTab(holder, "legal_provisions", "/legal-provisions", renderLegalProvisions);
    case "prosecution-defence": return renderAnalysisTab(holder, "prosecution_defence", "/prosecution-defence", renderProsecutionDefence);
    case "evidence": return renderAnalysisTab(holder, "evidence_gaps", "/evidence-gaps", renderEvidenceGaps);
    case "contradictions": return renderAnalysisTab(holder, "contradictions", "/contradictions", renderContradictions);
    case "compare": return renderCompareTab(holder);
    case "brief": return renderAnalysisTab(holder, "brief", "/brief", renderBrief);
  }
}

async function renderGraphTab(holder) {
  let data = state.citationGraphs[state.currentCaseId];
  if (!data) {
    holder.innerHTML = `<div class="loading-line">Building precedent citation graph…</div>`;
    try {
      data = await getJSON(`/cases/${state.currentCaseId}/citation-graph`);
      state.citationGraphs[state.currentCaseId] = data;
    } catch (e) {
      holder.innerHTML = `<div class="empty-state"><div class="empty-title">Couldn't load citation graph</div>${esc(e.message)}</div>`;
      return;
    }
  }
  try {
    const nodes = data.nodes || [];
    const links = data.links || [];
    const metrics = data.metrics || {};

    holder.innerHTML = `
      <div class="page-header" style="margin-bottom:16px;">
        <div>
          <h2 style="font-family:var(--serif); font-size:18px; margin:0;">Citation &amp; Precedent Authority Network</h2>
          <div class="sub">Inter-case citation relationships across the historical precedent corpus</div>
        </div>
      </div>

      <div class="grid cols-3" style="margin-bottom:20px;">
        <div class="card"><div class="stat-num">${metrics.node_count || nodes.length}</div><div class="stat-label">Connected Precedents</div></div>
        <div class="card"><div class="stat-num">${metrics.edge_count || links.length}</div><div class="stat-label">Citation Paths</div></div>
        <div class="card"><div class="stat-num">${metrics.focus_cited_by_count || 0}</div><div class="stat-label">Times Cited Authority</div></div>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <h3 style="margin-top:0;">Precedent Authority Ranking</h3>
        <div style="font-size:12.5px; color:var(--muted); margin-bottom:12px;">Precedents ranked by in-degree citation frequency in case law.</div>
        <div class="grid cols-2" style="gap:12px;">
          ${nodes.slice(0, 10).map(n => `
            <div style="border:1px solid var(--border); padding:10px 14px; border-radius:4px; background:#fff;">
              <div style="font-weight:600; font-size:13.5px; color:var(--primary);">${esc(n.label)}</div>
              <div style="font-size:12px; color:var(--muted); margin-top:2px;">${esc(n.court || "")} ${n.year ? "· " + n.year : ""}</div>
              <div style="margin-top:6px; font-size:12px;">
                <span class="score-badge" style="background:#e8f0fe; color:#1a73e8;">Cited ${n.in_degree} times</span>
                ${n.out_degree ? `<span class="score-badge" style="background:#f1f3f4; color:#5f6368;">Cites ${n.out_degree} cases</span>` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0;">Citation Relationships</h3>
        <table style="width:100%; border-collapse:collapse; font-size:12.5px; margin-top:8px;">
          <thead>
            <tr style="text-align:left; border-bottom:2px solid var(--border); color:var(--muted);">
              <th style="padding:6px 8px;">Citing Case</th>
              <th style="padding:6px 8px;">Relation</th>
              <th style="padding:6px 8px;">Cited Authority</th>
            </tr>
          </thead>
          <tbody>
            ${links.slice(0, 15).map(l => {
              const srcNode = nodes.find(n => n.id === l.source) || { label: l.source };
              const tgtNode = nodes.find(n => n.id === l.target) || { label: l.target };
              return `
                <tr style="border-bottom:1px solid #f0f0f0;">
                  <td style="padding:8px; font-weight:500;">${esc(srcNode.label)}</td>
                  <td style="padding:8px; color:var(--accent); font-family:monospace;">— cites →</td>
                  <td style="padding:8px; font-weight:500;">${esc(tgtNode.label)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    holder.innerHTML = `<div class="empty-state"><div class="empty-title">Couldn't load citation graph</div>${esc(e.message)}</div>`;
  }
}

function renderOverviewTab(holder) {
  const c = state.currentCase;
  const factsText = c.facts || "";
  const issuesText = c.charges_issues || c.issues || "";

  // Structured arguments rendering
  let argsHtml = "";
  if (typeof c.arguments === "object" && !Array.isArray(c.arguments) && Object.keys(c.arguments || {}).length) {
    const pet = c.arguments.petitioner || [];
    const resp = c.arguments.respondent || [];
    const general = c.arguments.general || [];
    let items = [];
    if (pet.length) {
      items.push(`<div style="margin-bottom:8px;"><b style="color:var(--primary);">Petitioner / Appellant:</b><ul style="margin:4px 0 8px 18px; padding:0;">${pet.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>`);
    }
    if (resp.length) {
      items.push(`<div style="margin-bottom:8px;"><b style="color:#b06000;">Respondent / State:</b><ul style="margin:4px 0 8px 18px; padding:0;">${resp.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>`);
    }
    if (general.length) {
      items.push(`<ul style="margin:4px 0 8px 18px; padding:0;">${general.map(g => `<li>${esc(g)}</li>`).join("")}</ul>`);
    }
    argsHtml = items.join("") || "<span style='color:var(--muted)'>Not provided</span>";
  } else if (c.arguments_text) {
    argsHtml = nl2br(c.arguments_text);
  } else {
    argsHtml = "<span style='color:var(--muted)'>Not provided</span>";
  }

  // Structured evidence rendering
  let eviHtml = "";
  if (Array.isArray(c.evidence) && c.evidence.length) {
    eviHtml = `
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${c.evidence.map(e => {
          const desc = typeof e === "object" ? (e.description || e.name || JSON.stringify(e)) : String(e);
          return `<span style="background:var(--card-bg, #f4f5f7); border:1px solid var(--border, #e2e4e8); padding:4px 9px; border-radius:14px; font-size:12px; font-weight:500;">📄 ${esc(desc)}</span>`;
        }).join("")}
      </div>
    `;
  } else if (c.evidence_text) {
    eviHtml = nl2br(c.evidence_text);
  } else {
    eviHtml = "<span style='color:var(--muted)'>Not provided</span>";
  }

  holder.innerHTML = `
    <div class="grid cols-2">
      <div class="card"><h3>Facts</h3><div style="max-height:360px; overflow-y:auto; line-height:1.55;">${nl2br(factsText) || "<span style='color:var(--muted)'>Not provided</span>"}</div></div>
      <div class="card"><h3>Charges / Issues</h3><div style="line-height:1.55;">${nl2br(issuesText) || "<span style='color:var(--muted)'>Not provided</span>"}</div></div>
      <div class="card"><h3>Arguments</h3><div style="max-height:360px; overflow-y:auto; line-height:1.5;">${argsHtml}</div></div>
      <div class="card"><h3>Evidence on hand</h3><div style="max-height:360px; overflow-y:auto; line-height:1.5;">${eviHtml}</div></div>
    </div>
    <p class="disclaimer">NyaAi is a decision-support tool for legal professionals. It does not determine guilt, innocence, or sentencing, and every generated claim should be checked against the linked source before relying on it.</p>
  `;
}

// ------------------------------------------------------------ documents --
function renderDocumentsTab(holder) {
  holder.innerHTML = `
    <div class="upload-zone" id="upload-zone">
      <div style="font-weight:600; margin-bottom:4px;">Upload a case document</div>
      <div style="font-size:12.5px;">.pdf, .txt, or .md — click to choose a file</div>
      <input type="file" id="file-input" style="display:none" accept=".pdf,.txt,.md" />
    </div>
    <div id="upload-status"></div>
    <div class="card" id="doc-list-card"><h3>Documents (${state.documents.length})</h3><div id="doc-list"></div></div>
  `;
  document.getElementById("upload-zone").addEventListener("click", () => document.getElementById("file-input").click());
  document.getElementById("file-input").addEventListener("change", handleUpload);

  const listEl = document.getElementById("doc-list");
  if (!state.documents.length) {
    listEl.innerHTML = `<div style="color:var(--muted); font-size:13px;">No documents uploaded yet.</div>`;
  } else {
    state.documents.forEach(d => {
      listEl.appendChild(el(`
        <div class="doc-row">
          <div>${esc(d.filename)} <span style="color:var(--muted); font-size:11.5px;">· ${esc(d.doc_type)} · ${d.num_chunks} chunks</span></div>
          <button class="btn ghost small" data-del="${d.id}">Remove</button>
        </div>
      `));
    });
    listEl.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await api(`/cases/${state.currentCaseId}/documents/${btn.dataset.del}`, { method: "DELETE" });
        await loadCaseData();
        renderDocumentsTab(holder);
      });
    });
  }
}

async function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById("upload-status");
  status.innerHTML = `<div class="loading-line">Uploading and indexing ${esc(file.name)}…</div>`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("doc_type", "general");
  try {
    await api(`/cases/${state.currentCaseId}/documents`, { method: "POST", body: formData });
    await loadCaseData();
    status.innerHTML = "";
    renderDocumentsTab(document.getElementById("tab-content"));
    refreshSidebar();
  } catch (err) {
    status.innerHTML = `<div style="color:var(--danger); font-size:13px;">Upload failed: ${esc(err.message)}</div>`;
  }
}

// -------------------------------------------------------- generic runner
async function renderAnalysisTab(holder, key, endpointSuffix, renderer) {
  holder.innerHTML = `<div class="loading-line">Loading ${key.replace("_", " ")}…</div>`;
  try {
    let result = state.analyses[key];
    const items = result ? result[key] : null;
    if (!result || (Array.isArray(items) && items.length === 0)) {
      result = await getJSON(`/cases/${state.currentCaseId}${endpointSuffix}`);
      state.analyses[key] = result;
    }
    setCitationsMap(result.citations);
    holder.innerHTML = "";
    renderer(holder, result);
    attachRefChipHandlers(holder);
  } catch (e) {
    holder.innerHTML = `<div class="empty-state"><div class="empty-title">Couldn't load this analysis</div>${esc(e.message)}</div>`;
  }
}

function renderSimilarCases(holder, result) {
  const cases = result.similar_cases || [];
  if (!cases.length) {
    holder.appendChild(el(`<div class="empty-state"><div class="empty-title">No similar cases retrieved yet</div>Run "Analyze case" from the top of the page.</div>`));
    return;
  }
  cases.forEach(sc => {
    const b = sc.score_breakdown || {};
    const relScore = sc.relevance_score != null ? sc.relevance_score : sc.rerank_total_score;
    const breakdownHtml = `
      <div style="display:flex; flex-wrap:wrap; gap:6px; margin:8px 0;">
        <span class="score-badge" style="background:#e8f0fe; color:#1a73e8;" title="Embedding semantic cosine similarity">Semantic: ${b.semantic != null ? b.semantic : '—'}</span>
        <span class="score-badge" style="background:#fce8e6; color:#c5221f;" title="BM25 keyword overlap">BM25: ${b.lexical != null ? b.lexical : '—'}</span>
        <span class="score-badge" style="background:#e6f4ea; color:#137333;" title="Statutory section match">Statute: ${b.statute_overlap != null ? b.statute_overlap : '—'}</span>
        <span class="score-badge" style="background:#fef7e0; color:#b06000;" title="Precedent citation frequency">Authority: ${b.citation_authority != null ? b.citation_authority : '—'}</span>
      </div>
    `;

    holder.appendChild(el(`
      <div class="result-card">
        <div class="rc-title">${esc(sc.case_name)} ${relScore != null ? `<span class="score-badge">relevance ${relScore}</span>` : ""} ${sc.rerank_total_score != null ? `<span class="score-badge" style="background:var(--primary); color:#fff;">rerank ${sc.rerank_total_score}</span>` : ""}</div>
        <div class="rc-meta">${esc(sc.court || "")} ${sc.year ? "· " + sc.year : ""}</div>
        ${breakdownHtml}
        <div class="rc-body">${esc(sc.why_relevant || "Precedent shares statutory interpretation and procedural nexus with the current dispute.")}</div>
        <div style="margin-top:8px; font-style:italic; color:var(--muted); font-size:12.6px;">"${esc((sc.matching_excerpt || "").slice(0, 220))}…"</div>
        <div style="margin-top:10px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <div>${refChips([sc.ref_key || "S1"])}</div>
          <button class="btn ghost small btn-compare-sc" data-casename="${esc(sc.case_name)}">⚖️ Compare with this case</button>
        </div>
      </div>
    `));
  });

  holder.querySelectorAll(".btn-compare-sc").forEach(btn => {
    btn.addEventListener("click", () => {
      const caseName = btn.dataset.casename;
      const match = (state.historicalCases || []).find(h => h.case_name === caseName);
      if (match) {
        state.compareTargetId = match.id;
      }
      state.currentTab = "compare";
      renderTabContent();
      syncTabHighlight();
    });
  });
}

function renderLegalProvisions(holder, result) {
  const provisions = result.legal_provisions || [];
  provisions.forEach(p => {
    const prov = typeof p === "string" ? p.trim() : (p.provision || p.act || p.law || p.section || (typeof p === "object" ? Object.values(p).join(" - ") : String(p))).trim();
    if (!prov) return;
    const why = typeof p === "string" ? "" : (p.why_relevant || p.relevance || "");
    const refs = typeof p === "string" ? [] : (p.source_refs || []);
    holder.appendChild(el(`
      <div class="result-card">
        <div class="rc-title">${esc(prov)}</div>
        ${why ? `<div class="rc-body">${esc(why)}</div>` : ""}
        ${refs.length ? `<div style="margin-top:8px;">${refChips(refs)}</div>` : ""}
      </div>
    `));
  });
  if (!provisions.length) {
    holder.appendChild(el(`<div class="empty-state"><div class="empty-title">No legal provisions identified</div>Run "Analyze case" from the top of the page.</div>`));
  }
}

function renderProsecutionDefence(holder, result) {
  const wrap = el(`<div class="pd-columns">
    <div class="pd-side">
      <div class="column-heading">Prosecution</div>
      <ul id="pd-pros-args"></ul>
      <div class="column-heading" style="margin-top:14px;">Precedents cited</div>
      <div id="pd-pros-refs"></div>
      <div class="column-heading" style="margin-top:14px;">Gaps</div>
      <ul id="pd-pros-gaps"></ul>
    </div>
    <div class="pd-side">
      <div class="column-heading">Defence</div>
      <ul id="pd-def-args"></ul>
      <div class="column-heading" style="margin-top:14px;">Precedents cited</div>
      <div id="pd-def-refs"></div>
      <div class="column-heading" style="margin-top:14px;">Gaps</div>
      <ul id="pd-def-gaps"></ul>
    </div>
  </div>`);
  holder.appendChild(wrap);
  const p = result.prosecution || {}, d = result.defence || {};
  (p.arguments || []).forEach(a => wrap.querySelector("#pd-pros-args").appendChild(el(`<li>${esc(a)}</li>`)));
  (d.arguments || []).forEach(a => wrap.querySelector("#pd-def-args").appendChild(el(`<li>${esc(a)}</li>`)));
  (p.gaps || []).forEach(a => wrap.querySelector("#pd-pros-gaps").appendChild(el(`<li>${esc(a)}</li>`)));
  (d.gaps || []).forEach(a => wrap.querySelector("#pd-def-gaps").appendChild(el(`<li>${esc(a)}</li>`)));
  wrap.querySelector("#pd-pros-refs").innerHTML = refChips(p.supporting_precedents) || `<span style="color:var(--muted); font-size:12px;">None</span>`;
  wrap.querySelector("#pd-def-refs").innerHTML = refChips(d.supporting_precedents) || `<span style="color:var(--muted); font-size:12px;">None</span>`;
  if (result.note) holder.appendChild(el(`<p class="disclaimer">${esc(result.note)}</p>`));
}

function renderEvidenceGaps(holder, result) {
  const present = el(`<div class="evidence-col"><div class="tag-present">Evidence present</div><ul></ul></div>`);
  (result.evidence_present || []).forEach(e => present.querySelector("ul").appendChild(el(`<li>${esc(e)}</li>`)));
  const gaps = el(`<div class="evidence-col"><div class="tag-verify">Potential evidence to verify</div><ul></ul></div>`);
  (result.potential_evidence_to_verify || []).forEach(e => gaps.querySelector("ul").appendChild(el(`<li>${esc(e)}</li>`)));
  holder.appendChild(present);
  holder.appendChild(gaps);
}

function renderContradictions(holder, result) {
  const items = result.contradictions || [];
  items.forEach(c => {
    holder.appendChild(el(`
      <div class="result-card">
        <div class="rc-title">${esc(c.type.replace(/_/g, " "))}</div>
        <div class="rc-body">${esc(c.description)}</div>
        ${c.values_found && c.values_found.length ? `<div style="margin-top:6px; font-size:12.5px; color:var(--muted);">Values found: ${c.values_found.map(esc).join(", ")}</div>` : ""}
        <div style="margin-top:8px;">${refChips(c.source_refs)}</div>
      </div>
    `));
  });
}

function renderBrief(holder, result) {
  const briefHeader = el(`
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; padding-bottom:12px; border-bottom:1px solid var(--border);">
      <div>
        <h2 style="font-family:var(--serif); margin:0 0 4px 0; font-size:20px;">Pre-Hearing Brief &amp; Strategy</h2>
        <div style="font-size:12.5px; color:var(--muted);">Grounded decision-support synthesis across pleadings, retrieved statutes, and precedent authorities.</div>
      </div>
      <button class="btn ghost small" id="btn-refresh-brief" title="Re-synthesize this brief using latest case data and analyses">↺ Regenerate Brief</button>
    </div>
  `);
  holder.appendChild(briefHeader);

  briefHeader.querySelector("#btn-refresh-brief").addEventListener("click", async () => {
    const btn = briefHeader.querySelector("#btn-refresh-brief");
    btn.disabled = true;
    btn.textContent = "Regenerating…";
    try {
      const fresh = await postJSON(`/cases/${state.currentCaseId}/brief`, {});
      state.analyses.brief = fresh;
      setCitationsMap(fresh.citations || []);
      holder.innerHTML = "";
      renderBrief(holder, fresh);
      attachRefChipHandlers(holder);
    } catch (e) {
      alert("Failed to regenerate brief: " + e.message);
      btn.disabled = false;
      btn.textContent = "↺ Regenerate Brief";
    }
  });

  const sections = [
    ["Case overview", result.case_overview],
    ["Key facts", result.key_facts],
    ["Legal issues", result.legal_issues],
  ];
  sections.forEach(([title, body]) => {
    if (body) {
      holder.appendChild(el(`<div class="analysis-block"><h3>${esc(title)}</h3><div>${nl2br(body)}</div></div>`));
    }
  });

  // Relevant laws
  const laws = el(`<div class="analysis-block"><h3>Relevant laws</h3></div>`);
  let lawCount = 0;
  (result.relevant_laws || []).forEach(p => {
    const prov = typeof p === "string" ? p.trim() : (p.provision || p.act || p.law || p.title || p.section || (typeof p === "object" ? Object.values(p).filter(v => typeof v === "string").join(" — ") : String(p))).trim();
    if (!prov) return;
    lawCount++;
    const why = typeof p === "string" ? "" : (p.why_relevant || p.relevance || p.explanation || "");
    laws.appendChild(el(`
      <div class="result-card">
        <div class="rc-title">${esc(prov)}</div>
        ${why ? `<div class="rc-body">${esc(why)}</div>` : ""}
      </div>
    `));
  });
  if (!lawCount) {
    laws.appendChild(el(`<div style="color:var(--muted); font-size:13px;">No relevant laws identified yet. Run <strong>Legal Analysis</strong> first to identify statutory provisions.</div>`));
  }
  holder.appendChild(laws);

  // Relevant precedents
  const precedents = el(`<div class="analysis-block"><h3>Relevant precedents</h3></div>`);
  let precCount = 0;
  (result.relevant_precedents || []).forEach(p => {
    const name = typeof p === "string" ? p.trim() : (p.case_name || p.title || p.name || p.citation || (typeof p === "object" ? Object.values(p).filter(v => typeof v === "string").join(" — ") : String(p))).trim();
    if (!name) return;
    precCount++;
    const why = typeof p === "string" ? "" : (p.why_relevant || p.relevance || p.explanation || "");
    precedents.appendChild(el(`
      <div class="result-card">
        <div class="rc-title">${esc(name)}</div>
        ${why ? `<div class="rc-body">${esc(why)}</div>` : ""}
      </div>
    `));
  });
  if (!precCount) {
    precedents.appendChild(el(`<div style="color:var(--muted); font-size:13px;">No relevant precedents retrieved yet. Run <strong>Similar Cases</strong> first to locate authorities.</div>`));
  }
  holder.appendChild(precedents);

  // Prosecution vs Defence
  const pd = el(`<div class="analysis-block"><h3>Prosecution vs Defence</h3></div>`);
  const pdWrap = el(`<div class="pd-columns"><div class="pd-side"><div class="column-heading">Prosecution / Appellant</div><ul></ul></div><div class="pd-side"><div class="column-heading">Defence / Respondent</div><ul></ul></div></div>`);
  const prosUl = pdWrap.querySelector(".pd-side:nth-child(1) ul");
  const defUl = pdWrap.querySelector(".pd-side:nth-child(2) ul");
  const prosArgs = Array.isArray(result.prosecution_arguments) ? result.prosecution_arguments : ((result.prosecution_arguments || {}).arguments || (result.prosecution_arguments || {}).petitioner || []);
  const defArgs = Array.isArray(result.defence_arguments) ? result.defence_arguments : ((result.defence_arguments || {}).arguments || (result.defence_arguments || {}).respondent || []);
  prosArgs.forEach(a => prosUl.appendChild(el(`<li>${esc(typeof a === "string" ? a : (a.argument || JSON.stringify(a)))}</li>`)));
  defArgs.forEach(a => defUl.appendChild(el(`<li>${esc(typeof a === "string" ? a : (a.argument || JSON.stringify(a)))}</li>`)));
  if (!prosArgs.length) prosUl.appendChild(el(`<li style="color:var(--muted); font-size:12.5px;">No prosecution arguments extracted.</li>`));
  if (!defArgs.length) defUl.appendChild(el(`<li style="color:var(--muted); font-size:12.5px;">No defence arguments extracted.</li>`));
  pd.appendChild(pdWrap);
  holder.appendChild(pd);

  // Evidence summary & gaps
  const evi = el(`<div class="analysis-block"><h3>Evidence summary &amp; gaps</h3></div>`);
  const eviWrap = el(`<div><div class="tag-present">Present Evidence</div><ul></ul><div class="tag-verify" style="margin-top:12px;">Evidence to Verify / Gaps</div><ul></ul></div>`);
  const presUl = eviWrap.querySelector("ul:nth-of-type(1)");
  const verUl = eviWrap.querySelector("ul:nth-of-type(2)");
  const evPresent = Array.isArray(result.evidence_summary) ? result.evidence_summary : (result.evidence_present || []);
  const evGaps = Array.isArray(result.evidence_gaps) ? result.evidence_gaps : (result.potential_evidence_to_verify || []);
  evPresent.forEach(a => presUl.appendChild(el(`<li>${esc(typeof a === "string" ? a : (a.description || JSON.stringify(a)))}</li>`)));
  evGaps.forEach(a => verUl.appendChild(el(`<li>${esc(typeof a === "string" ? a : (a.description || JSON.stringify(a)))}</li>`)));
  if (!evPresent.length) presUl.appendChild(el(`<li style="color:var(--muted); font-size:12.5px;">No direct evidence documented.</li>`));
  if (!evGaps.length) verUl.appendChild(el(`<li style="color:var(--muted); font-size:12.5px;">No notable evidentiary gaps recorded.</li>`));
  evi.appendChild(eviWrap);
  holder.appendChild(evi);

  // Contradictions
  const contra = el(`<div class="analysis-block"><h3>Contradictions</h3></div>`);
  let contraCount = 0;
  (result.contradictions || []).forEach(c => {
    contraCount++;
    const title = typeof c === "string" ? "Contradiction / Conflict" : ((c.type || "Contradiction").replace(/_/g, " "));
    const desc = typeof c === "string" ? c : (c.description || JSON.stringify(c));
    contra.appendChild(el(`<div class="result-card"><div class="rc-title">${esc(title)}</div><div class="rc-body">${esc(desc)}</div></div>`));
  });
  if (!contraCount) {
    contra.appendChild(el(`<div style="color:var(--muted); font-size:13px;">No explicit evidentiary or timeline contradictions detected across documents.</div>`));
  }
  holder.appendChild(contra);

  // Questions to examine
  const questions = el(`<div class="analysis-block"><h3>Questions to examine</h3><ul></ul></div>`);
  const qUl = questions.querySelector("ul");
  (result.questions_to_examine || []).forEach(q => qUl.appendChild(el(`<li>${esc(typeof q === "string" ? q : (q.question || JSON.stringify(q)))}</li>`)));
  if (!(result.questions_to_examine || []).length) qUl.appendChild(el(`<li style="color:var(--muted); font-size:12.5px;">No additional hearing questions specified.</li>`));
  holder.appendChild(questions);

  if (result.warning) holder.appendChild(el(`<p class="disclaimer" style="color:var(--warn);">${esc(result.warning)}</p>`));
  holder.appendChild(el(`<p class="disclaimer">This brief is assembled entirely from the case data and the analyses you have run — it is a starting point for a legal professional, not a final legal conclusion.</p>`));
}

// -------------------------------------------------------------- compare --
async function renderCompareTab(holder) {
  holder.innerHTML = `<div class="loading-line">Retrieving and ranking relevant precedent authorities for comparison…</div>`;
  let relatedCases = [];
  try {
    relatedCases = await getJSON(`/cases/${state.currentCaseId}/related-precedents`);
  } catch (e) {
    relatedCases = [];
  }

  if (!relatedCases.length) {
    holder.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0;">Precedent Case Comparison</h3>
        <div class="empty-state">
          <div class="empty-title">No sufficiently relevant precedents found</div>
          <p style="margin-top:8px; line-height:1.5;">
            No sufficiently relevant precedents were identified in the corpus for this case's specific facts and legal issues.
            Try uploading case documents or running <strong>Analyze case</strong> from the top toolbar to enrich retrieval signals.
          </p>
        </div>
      </div>`;
    return;
  }

  const similarList = (state.analyses.similar_cases?.similar_cases || []);
  let topOptionsHtml = "";
  if (similarList.length) {
    topOptionsHtml = `
      <optgroup label="⭐ Top Similar Precedents (from Analysis)">
        ${similarList.map(sc => {
          const match = relatedCases.find(hc => hc.case_name === sc.case_name);
          const val = match ? match.id : "";
          return val ? `<option value="${val}">★ ${esc(sc.case_name)} (${esc(sc.court || "")} ${sc.year || ""})</option>` : "";
        }).filter(Boolean).join("")}
      </optgroup>
    `;
  }

  holder.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="margin-top:0; margin-bottom:8px;">Precedent Case Comparison</h3>
      <p style="color:var(--muted); font-size:13px; margin-bottom:14px;">
        Select a recommended precedent from the curated shortlist below (ranked by statutory match, semantic relevance, and citation authority) to perform an automated side-by-side comparative analysis.
      </p>
      <label for="compare-select" style="font-weight:600;">Choose a relevant precedent to compare against:</label>
      <select id="compare-select" style="width:100%; padding:9px 12px; margin-top:6px; border:1px solid var(--border); border-radius:6px; font-size:13.5px; background:var(--card-bg);">
        <option value="">Select a recommended precedent (${relatedCases.length} available)…</option>
        ${topOptionsHtml}
        <optgroup label="Relevant Precedents (${relatedCases.length} shortlisted)">
          ${relatedCases.map(hc => `<option value="${hc.id}">${esc(hc.case_name)}${hc.year ? ` (${hc.year})` : ""} — ${esc(hc.court || "Court")}${hc.relevance_score != null ? ` [Score: ${hc.relevance_score}]` : ""}</option>`).join("")}
        </optgroup>
      </select>
      <div id="compare-precedent-preview" style="margin-top:10px;"></div>
      <div class="form-actions" style="margin-top:14px;">
        <button class="btn primary" id="compare-run">Compare Precedent</button>
      </div>
    </div>
    <div id="compare-result"></div>
  `;

  const btnRun = document.getElementById("compare-run");
  const selCase = document.getElementById("compare-select");
  const previewDiv = document.getElementById("compare-precedent-preview");

  function updatePreview() {
    const selId = selCase.value;
    const found = relatedCases.find(c => c.id === selId);
    if (found) {
      previewDiv.innerHTML = `
        <div style="padding:10px 14px; background:var(--cream-bg, #fdfbf7); border:1px solid var(--cream-border, #e2d9c8); border-left:3px solid var(--navy, #1a2a3a); border-radius:4px; font-size:13px;">
          <div style="font-weight:600; color:var(--navy-dark, #0d1b2a); margin-bottom:4px;">
            ${esc(found.case_name)} (${esc(found.court || "Court")} ${found.year || ""})
          </div>
          <div style="color:var(--text-mid, #444); line-height:1.5;">
            <strong>Relevance:</strong> ${esc(found.why_relevant || "Identified as legally relevant precedent via citation and semantic matching.")}
          </div>
        </div>
      `;
    } else {
      previewDiv.innerHTML = "";
    }
  }

  selCase.addEventListener("change", updatePreview);

  if (state.compareTargetId) {
    selCase.value = state.compareTargetId;
    state.compareTargetId = null;
    updatePreview();
    setTimeout(() => btnRun.click(), 50);
  }

  btnRun.addEventListener("click", async () => {
    const hcId = selCase.value;
    if (!hcId) {
      alert("Please select a precedent case from the dropdown first.");
      return;
    }
    const resultHolder = document.getElementById("compare-result");
    btnRun.disabled = true;
    btnRun.textContent = "Analyzing & Comparing…";
    resultHolder.innerHTML = `<div class="loading-line">Generating detailed side-by-side comparison…</div>`;
    try {
      const result = await postJSON(`/cases/${state.currentCaseId}/compare`, { historical_case_id: hcId });
      setCitationsMap(result.citations);
      resultHolder.innerHTML = "";
      renderComparisonResult(resultHolder, result);
      attachRefChipHandlers(resultHolder);
    } catch (e) {
      resultHolder.innerHTML = `<div class="empty-state"><div class="empty-title">Comparison failed</div>${esc(e.message)}</div>`;
    } finally {
      btnRun.disabled = false;
      btnRun.textContent = "Compare Precedent";
    }
  });
}

function renderComparisonResult(holder, result) {
  const cur = result.current_case || state.currentCase || {}, hist = result.historical_case || {};
  const curFacts = cur.facts || state.currentCase?.facts || "—";
  const curIssues = cur.issues || cur.charges_issues || state.currentCase?.issues || state.currentCase?.charges_issues || "—";
  const histSummary = hist.summary || "Summary pending review.";
  const histOutcome = hist.outcome || "Settled by Court judgment.";

  holder.appendChild(el(`
    <div class="grid cols-2" style="margin-bottom:20px;">
      <div class="card">
        <h3 style="color:var(--primary); margin-top:0;">Current Case (${esc(cur.title || state.currentCase?.title || "Lead Dispute")})</h3>
        <div style="font-size:13px; margin-top:6px; line-height:1.5;"><b>Facts:</b> ${esc(curFacts.slice(0, 350))}${curFacts.length > 350 ? "…" : ""}</div>
        <div style="font-size:13px; margin-top:8px; line-height:1.5;"><b>Issues:</b> ${esc(curIssues.slice(0, 350))}${curIssues.length > 350 ? "…" : ""}</div>
      </div>
      <div class="card">
        <h3 style="color:#b06000; margin-top:0;">Precedent: ${esc(hist.case_name || "Historical Case")}</h3>
        <div style="font-size:13px; margin-top:6px; line-height:1.5;"><b>Summary:</b> ${esc(histSummary.slice(0, 350))}${histSummary.length > 350 ? "…" : ""}</div>
        <div style="font-size:13px; margin-top:8px; line-height:1.5;"><b>Outcome:</b> ${esc(histOutcome)}</div>
      </div>
    </div>
  `));
  const sim = el(`<div class="analysis-block"><h3>Similarities</h3><ul></ul></div>`);
  (result.similarities || []).forEach(s => sim.querySelector("ul").appendChild(el(`<li>${esc(s)}</li>`)));
  holder.appendChild(sim);

  const diff = result.differences || {};
  holder.appendChild(el(`
    <div class="analysis-block"><h3>Differences</h3>
      <div class="grid cols-2">
        <div><div class="column-heading">Unique to current case</div><ul>${(diff.unique_to_current_case||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><div class="column-heading">Unique to historical case</div><ul>${(diff.unique_to_historical_case||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
    </div>
  `));

  holder.appendChild(el(`<div class="analysis-block"><h3>Legal significance</h3><div>${esc(result.legal_significance || "")}</div></div>`));
  const app = el(`<div class="analysis-block"><h3>Applicability considerations</h3><ul></ul></div>`);
  (result.applicability_considerations || []).forEach(a => app.querySelector("ul").appendChild(el(`<li>${esc(a)}</li>`)));
  holder.appendChild(app);
}

// ------------------------------------------------------------- router ---
function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) return null;
  const parts = hash.split("/");
  if (parts[0] === "case" && parts[1]) {
    return { view: "case", caseId: parts[1], tab: parts[2] || "overview", target: parts[3] || null };
  }
  if (["dashboard", "corpus", "search", "new-case"].includes(parts[0])) {
    return { view: parts[0] };
  }
  return null;
}

function updateHash() {
  if (state.view === "case" && state.currentCaseId) {
    const target = `#case/${state.currentCaseId}/${state.currentTab || "overview"}`;
    if (window.location.hash !== target) history.replaceState(null, "", target);
  } else if (["dashboard", "corpus", "search", "new-case"].includes(state.view)) {
    const target = `#${state.view}`;
    if (window.location.hash !== target) history.replaceState(null, "", target);
  }
}

async function render(opts = { refetch: true }) {
  if (opts.refetch) {
    await fetchCases();
  }
  const route = parseHash();
  if (route) {
    state.view = route.view;
    if (route.view !== "case") {
      state.currentCaseId = null;
    }
    if (route.caseId && state.cases.some(c => c.id === route.caseId)) {
      state.currentCaseId = route.caseId;
      state.currentTab = route.tab || "overview";
      if (route.target) state.compareTargetId = route.target;
      await loadCaseData();
      renderSidebar();
      return renderCaseWorkspace();
    }
  }
  renderSidebar();
  if (state.view === "dashboard") return renderDashboard();
  if (state.view === "corpus") return renderCorpus();
  if (state.view === "search") return renderSearch();
  if (state.view === "new-case") return renderNewCase();
  if (state.view === "case") return renderCaseWorkspace();
}

window.addEventListener("hashchange", () => render({ refetch: false }));

// --------------------------------------------------------- legal research search
async function renderSearch() {
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Legal Research</h1>
        <div class="sub">Hybrid semantic + BM25 search across the Indian legal precedent corpus</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <div style="display:flex; gap:12px; align-items:center;">
        <input type="text" id="search-q" placeholder="e.g. Section 302 IPC murder appeal Supreme Court" style="flex:1; font-size:15px;" />
        <button class="btn primary" id="search-btn" style="white-space:nowrap;">Search Corpus</button>
      </div>
      <div style="font-size:12px; color:var(--muted); margin-top:8px;">Searches all ${0} indexed chunks with hybrid retrieval (semantic embedding + BM25 lexical).</div>
    </div>
    <div id="search-results"></div>
  `;

  const doSearch = async () => {
    const q = document.getElementById("search-q").value.trim();
    if (!q) return;
    const resultsEl = document.getElementById("search-results");
    resultsEl.innerHTML = `<div class="loading-line">Searching…</div>`;
    try {
      const results = await getJSON(`/api/search?q=${encodeURIComponent(q)}&limit=15`);
      if (!results.length) {
        resultsEl.innerHTML = `<div class="empty-state"><div class="empty-title">No results found</div>Try broader search terms or ensure the corpus has been ingested.</div>`;
        return;
      }
      resultsEl.innerHTML = "";
      results.forEach(r => {
        resultsEl.appendChild(el(`
          <div class="result-card">
            <div class="rc-title">
              ${esc(r.case_name)}
              ${r.doc_url ? `<a href="${esc(r.doc_url)}" target="_blank" style="font-size:12px; color:var(--accent); font-weight:400; margin-left:8px;">↗ Source</a>` : ""}
            </div>
            <div class="rc-meta">${esc(r.court || "")} ${r.year ? "· " + r.year : ""}</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin:8px 0;">
              <span class="score-badge" style="background:#e8f0fe; color:#1a73e8;" title="Embedding cosine similarity">Semantic: ${r.semantic_score}</span>
              <span class="score-badge" style="background:#fce8e6; color:#c5221f;" title="BM25 lexical match">BM25: ${r.lexical_score}</span>
              <span class="score-badge" style="background:#e6f4ea; color:#137333;" title="Combined score">Hybrid: ${r.hybrid_score}</span>
            </div>
            <div class="rc-body" style="font-style:italic; color:var(--muted); font-size:12.6px;">"${esc((r.excerpt || "").slice(0, 250))}…"</div>
          </div>
        `));
      });
    } catch (e) {
      resultsEl.innerHTML = `<div class="empty-state"><div class="empty-title">Search failed</div>${esc(e.message)}</div>`;
    }
  };

  document.getElementById("search-btn").addEventListener("click", doSearch);
  document.getElementById("search-q").addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
}

render();
