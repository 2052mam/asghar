/* AQx–Tirole Omega — application shell, state and rendering.
   The browser owns the workspace; the server owns the maths. Every mutation is
   persisted locally and re-scored through the same Python scoring function. */

import { initLang, getLang, setLang, toggleLang, t, loc } from "./i18n.js";
import {
  esc, num, compact, horizontalBars, histogram, donut, radar, chartEmpty,
} from "./charts.js";

const $ = (id) => document.getElementById(id);
const FACTORS_FALLBACK = ["competition", "valuation", "earnings_quality", "growth", "market_momentum", "risk_control"];
const STORAGE_KEY = "aqx.workspace.v1";
const PRESETS = {
  cautious: { return: 5, volatility: 15, years: 1, simulations: 10000 },
  base: { return: 15, volatility: 30, years: 1, simulations: 10000 },
  stressed: { return: 0, volatility: 55, years: 1, simulations: 15000 },
};

const state = {
  meta: null,
  datasets: [],
  rows: [],
  weights: {},
  datasetId: "demo",
  asOf: "",
  sourceNote: "",
  ranked: null,
  simulation: null,
  filter: "all",
  resultsSearch: "",
  universeSearch: "",
  selectedId: null,
  theme: "dark",
  recalcTimer: null,
  saveTimer: null,
  lastFocus: null,
  counter: 1,
  importWarnings: [],
};

function factorKeys() { return state.meta?.factor_keys || FACTORS_FALLBACK; }
function factorMeta(key) { return (state.meta?.factors || []).find((f) => f.key === key); }
function factorName(key, short = false) {
  const meta = factorMeta(key);
  return meta ? loc(short ? meta.short : meta.name) : key;
}
function statusInfo(key) {
  return state.meta?.statuses?.[key] || { en: key, fa: key, tone: "muted" };
}
function statusLabel(key) { return loc(statusInfo(key)); }
function statusDetail(key) {
  const info = statusInfo(key);
  return getLang() === "fa" ? info.fa_detail : info.en_detail;
}
function appliedWeights() {
  if (state.ranked?.weights_applied) return state.ranked.weights_applied;
  const weights = { ...state.weights };
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));
}
function scoreText(value, digits = 2) {
  return value === null || value === undefined ? "—" : num(value, digits);
}
function pct(value, digits = 0) { return `${num(value * 100, digits)}%`; }

/* ─────────────────────────── API ─────────────────────────── */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`HTTP ${response.status}`); }
  if (!response.ok || data.ok === false) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }
  return data;
}

function post(path, body) {
  return api(path, { method: "POST", body: JSON.stringify(body) });
}

function scoreRequestBody() {
  return {
    rows: state.rows,
    weights: state.weights,
    asOf: state.asOf,
  };
}

/* ─────────────────────────── Persistence ─────────────────────────── */

function loadWorkspace() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (raw && Array.isArray(raw.rows)) return raw;
  } catch { /* ignore corrupt storage */ }
  return null;
}

function saveWorkspace() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rows: state.rows, weights: state.weights, datasetId: state.datasetId,
        asOf: state.asOf, sourceNote: state.sourceNote,
      }));
    } catch { /* storage full or disabled */ }
  }, 180);
}

function uid() { return `r-${Date.now().toString(36)}-${state.counter++}`; }

function cloneRows(rows) {
  return rows.map((row, index) => ({
    id: row.id || `d-${index}`,
    ticker: row.ticker || "",
    note: row.note || "",
    ...Object.fromEntries(factorKeys().map((key) => [key, row[key] ?? null])),
  }));
}

/* ─────────────────────────── UI helpers ─────────────────────────── */

function icon(name, cls = "icon") {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function toast(message, { title = "", type = "success", detail = "" } = {}) {
  const node = document.createElement("div");
  node.className = "toast";
  node.dataset.type = type;
  node.setAttribute("role", "status");
  const iconName = type === "error" ? "alert" : type === "info" ? "info" : "check";
  node.innerHTML = `${icon(iconName)}<div>${title ? `<strong>${esc(title)}</strong>` : ""}${esc(message)}${detail ? `<br><small>${esc(detail)}</small>` : ""}</div>`;
  $("toast-region").appendChild(node);
  setTimeout(() => node.remove(), 4600);
}

function confirmAction(messageKey) {
  return new Promise((resolve) => {
    const dialog = $("confirm-dialog");
    $("confirm-message").textContent = t(messageKey);
    const ok = $("confirm-ok"), cancel = $("confirm-cancel");
    const cleanup = () => {
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
    };
    const onOk = () => { cleanup(); dialog.close(); resolve(true); };
    const onCancel = () => { cleanup(); dialog.close(); resolve(false); };
    const onClose = () => { cleanup(); resolve(false); };
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

function chip(key) {
  return `<span class="status-chip" data-tone="${esc(statusInfo(key).tone || "muted")}">${esc(statusLabel(key))}</span>`;
}

function warningNodes(warnings, extra = []) {
  const items = [...(warnings || []), ...extra];
  if (!items.length) return "";
  return items.map((w) => {
    const code = w.code || "info";
    const vars = { row: w.row ?? "", value: w.value ?? "", factor: w.factor ? factorName(w.factor) : "" };
    const infoTone = code === "weights_normalized" || code === "demo_data";
    return `<div class="inline-notice" data-tone="${infoTone ? "info" : "warn"}">${icon(infoTone ? "info" : "alert")}<span>${esc(t(`warn.${code}`, vars, getLang()) || code)}</span></div>`;
  }).join("");
}

function localizeStatic() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel)); });
  document.title = t("doc.title");
  updateViewTitle();
  const label = $("lang-label");
  if (label) label.textContent = getLang() === "en" ? "FA" : "EN";
}

function updateViewTitle() {
  const active = document.querySelector(".view.is-active")?.dataset.view || "overview";
  $("view-title").textContent = t(`nav.${active}`);
}

/* ─────────────────────────── Theme & language ─────────────────────────── */

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("aqx.theme"); } catch { /* ignore */ }
  state.theme = saved === "light" || saved === "dark"
    ? saved
    : (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTheme();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const use = $("theme-icon")?.querySelector("use");
  if (use) use.setAttribute("href", state.theme === "dark" ? "#i-sun" : "#i-moon");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.theme === "dark" ? "#090e1b" : "#f2f5fb");
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("aqx.theme", state.theme); } catch { /* ignore */ }
  applyTheme();
  // Charts are CSS-driven, but re-render to recalculate any measured geometry.
  renderAll();
}

/* ─────────────────────────── Bootstrap ─────────────────────────── */

async function boot() {
  initLang();
  initTheme();
  bindEvents();
  navigate();

  try {
    const [meta, datasets] = await Promise.all([api("/api/meta"), api("/api/datasets")]);
    state.meta = meta;
    state.datasets = datasets.datasets;
    const saved = loadWorkspace();
    if (saved) {
      state.rows = saved.rows;
      state.weights = saved.weights && Object.keys(saved.weights).length
        ? saved.weights : { ...meta.weights };
      state.datasetId = saved.datasetId || "demo";
      state.asOf = saved.asOf || "";
      state.sourceNote = saved.sourceNote || "";
    } else {
      state.rows = cloneRows(state.datasets[0].rows);
      state.weights = { ...meta.weights };
      state.datasetId = "demo";
      state.asOf = new Date().toISOString().slice(0, 10);
    }
    buildStaticSections();
    buildDatasetSelect();
    buildWeights();
    buildUniverseHead();
    buildBands();
    buildStatusFilters();
    buildScenarioAudit();
    $("as-of-input").value = state.asOf;
    $("source-note").value = state.sourceNote;
    renderUniverse();
    await recalculate();
  } catch (error) {
    console.error(error);
    $("health-text").textContent = t("health.error");
    $("health-pill").dataset.tone = "bad";
    toast(t("toast.error"), { type: "error", detail: error.message });
  }
}

function bindEvents() {
  $("lang-btn").addEventListener("click", () => { toggleLang(); renderAll(); });
  $("theme-btn").addEventListener("click", toggleTheme);
  $("menu-btn").addEventListener("click", () => openSidebar(true));
  $("sidebar-close").addEventListener("click", () => openSidebar(false));
  $("sidebar-scrim").addEventListener("click", () => openSidebar(false));
  window.addEventListener("hashchange", navigate);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      openSidebar(false);
      if (!$("detail-drawer").hidden) closeDrawer();
    }
  });

  $("hero-demo-btn").addEventListener("click", () => loadDataset("demo"));
  $("dataset-select").addEventListener("change", (e) => loadDataset(e.target.value));
  $("add-row-btn").addEventListener("click", addRow);
  $("clear-btn").addEventListener("click", clearRows);
  $("import-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", importFile);
  $("template-btn").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = "/api/template.csv";
    link.download = "aqx_universe_template.csv";
    document.body.appendChild(link); link.click(); link.remove();
  });
  $("export-btn").addEventListener("click", exportCsv);
  $("results-export-btn").addEventListener("click", exportCsv);
  $("recalculate-btn").addEventListener("click", async () => {
    await recalculate();
    toast(t("toast.recalculated"), { type: "info" });
  });
  $("normalize-btn").addEventListener("click", normalizeWeights);
  $("reset-weights-btn").addEventListener("click", resetWeights);
  $("as-of-input").addEventListener("change", (e) => {
    state.asOf = e.target.value; saveWorkspace(); renderOverview();
  });
  $("source-note").addEventListener("input", (e) => {
    state.sourceNote = e.target.value; saveWorkspace();
  });
  $("universe-search").addEventListener("input", (e) => {
    state.universeSearch = e.target.value.trim().toLowerCase();
    renderUniverseBody();
  });
  $("results-search").addEventListener("input", (e) => {
    state.resultsSearch = e.target.value.trim().toLowerCase();
    renderRankedList();
  });
  $("universe-body").addEventListener("input", onTableInput);
  $("universe-body").addEventListener("change", onTableChange);
  $("universe-body").addEventListener("click", onTableClick);
  $("universe-body").addEventListener("keydown", onTableKeydown);
  $("ranked-list").addEventListener("click", (e) => {
    const button = e.target.closest("[data-inspect]");
    if (button) openDrawer(button.dataset.inspect);
  });
  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-scrim").addEventListener("click", closeDrawer);
  $("detail-drawer").addEventListener("keydown", trapDrawerFocus);
  $("drawer-body").addEventListener("click", (e) => {
    if (e.target.closest("[data-save-memo]")) saveMemo();
  });
  document.querySelectorAll(".preset").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });
  ["sim-return", "sim-volatility", "sim-years", "sim-capital"].forEach((id) => {
    $(id).addEventListener("input", () => document.querySelectorAll(".preset").forEach((b) => b.classList.remove("is-selected")));
  });
  $("run-sim-btn").addEventListener("click", runSimulation);
}

function openSidebar(open) {
  $("sidebar").classList.toggle("is-open", open);
  $("sidebar-scrim").hidden = !open;
  document.body.classList.toggle("is-locked", open);
  if (open) $("sidebar-close").focus();
}

/* ─────────────────────────── Router ─────────────────────────── */

function navigate() {
  const allowed = ["overview", "universe", "results", "scenario", "method"];
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  const view = allowed.includes(hash) ? hash : "overview";
  document.querySelectorAll(".view").forEach((section) => {
    const active = section.dataset.view === view;
    section.classList.toggle("is-active", active);
    section.hidden = !active;
  });
  document.querySelectorAll(".nav-item").forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  updateViewTitle();
  openSidebar(false);
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ─────────────────────────── Build static sections ─────────────────────────── */

function buildStaticSections() {
  const lang = getLang();
  // Method: limitations
  $("method-limitations").innerHTML = (state.meta.limitations || [])
    .map((item) => `<li>${esc(loc(item))}</li>`).join("");
  // Method: design principles
  $("design-principles").innerHTML = [1, 2, 3, 4, 5, 6].map((i) => `
    <div class="design-principle">${icon(["eye", "refresh", "layers", "grid", "shield", "clock"][i - 1])}
      <h4>${esc(t(`design.${i}t`))}</h4><p>${esc(t(`design.${i}b`))}</p></div>`).join("");
  // Method: accessibility list
  $("a11y-list").innerHTML = [1, 2, 3, 4, 5, 6]
    .map((i) => `<li>${icon("check")}<span>${esc(t(`a11y.${i}`))}</span></li>`).join("");
  $("formula-example").innerHTML = t("method.formulaExample");
  $("method-factors").innerHTML = factorKeys().map((key) => {
    const meta = factorMeta(key);
    return `<div class="method-factor"><div class="method-factor-head"><b>${esc(loc(meta.name))}</b><span>${esc(pct(state.meta.weights[key]))}</span></div>
      <p>${esc(loc(meta.hint))}</p><p class="question">${esc(loc(meta.question))}</p></div>`;
  }).join("");
  // Overview limitations
  $("overview-limitations").innerHTML = (state.meta.limitations || []).slice(0, 3)
    .map((item) => `<li>${esc(loc(item))}</li>`).join("");
  // Scenario audit
  buildScenarioAudit();
  $("app-version").textContent = `v${state.meta.version}`;
  $("footer-version").textContent = `v${state.meta.version}`;
}

function buildScenarioAudit() {
  $("audit-list").innerHTML = [1, 2, 3, 4]
    .map((i) => `<li>${esc(t(`scenario.audit${i}`))}</li>`).join("");
}

function buildDatasetSelect() {
  const select = $("dataset-select");
  const options = state.datasets.map((d) => `<option value="${esc(d.id)}">${esc(loc(d.label))}</option>`);
  if (!state.datasets.some((d) => d.id === state.datasetId)) {
    options.push(`<option value="imported">${esc(getLang() === "fa" ? "داده ورودی / ویرایششده" : "Imported / edited data")}</option>`);
  }
  select.innerHTML = options.join("");
  select.value = state.datasetId;
  updateDatasetDescription();
}

function updateDatasetDescription() {
  const dataset = state.datasets.find((d) => d.id === state.datasetId);
  $("dataset-description").textContent = dataset
    ? loc(dataset.description)
    : (getLang() === "fa" ? "دادههای واردشده یا ویرایششده شما. هیچ امتیازی بهطور خودکار تولید نمیشود." : "Your imported or edited data. No score is generated automatically.");
}

function buildBands() {
  const keys = ["deep_review", "reviewable", "more_evidence", "low_priority", "incomplete"];
  const ranges = { deep_review: "80–100", reviewable: "70–79.99", more_evidence: "60–69.99", low_priority: "0–59.99", incomplete: "—" };
  $("bands-list").innerHTML = keys.map((key) => `
    <div class="band-row"><div class="band-row-head">${chip(key)}<span class="band-range">${ranges[key]}</span></div>
      <p>${esc(statusDetail(key))}</p></div>`).join("");
}

function buildStatusFilters() {
  const keys = ["all", "deep_review", "reviewable", "more_evidence", "low_priority", "incomplete"];
  $("status-filters").innerHTML = keys.map((key) => `
    <button class="filter-chip ${state.filter === key ? "is-active" : ""}" data-filter="${key}" aria-pressed="${state.filter === key}">
      ${esc(key === "all" ? t("results.filterAll") : statusLabel(key))}</button>`).join("");
  $("status-filters").querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { state.filter = btn.dataset.filter; buildStatusFilters(); renderRankedList(); });
  });
}

function buildUniverseHead() {
  const head = $("universe-head-row");
  head.innerHTML = `<th scope="col">${esc(t("universe.colTicker"))}</th>`
    + factorKeys().map((key) => `<th scope="col" title="${esc(loc(factorMeta(key)?.hint))}">${esc(factorName(key, true))}</th>`).join("")
    + `<th scope="col">${esc(t("universe.colComplete"))}</th><th scope="col"><span class="sr-only">${esc(t("universe.colActions") || "Actions")}</span></th>`;
}

function buildWeights() {
  const host = $("weight-sliders");
  host.innerHTML = factorKeys().map((key) => {
    const value = Math.round((state.weights[key] || 0) * 100);
    return `<div class="weight-slider" data-weight="${esc(key)}">
      <div class="weight-slider-head"><label for="w-${esc(key)}">${esc(factorName(key))}</label><b data-value>${value}%</b></div>
      <span class="field-help">${esc(loc(factorMeta(key)?.hint))}</span>
      <input type="range" id="w-${esc(key)}" min="0" max="100" step="1" value="${value}"
        aria-label="${esc(factorName(key))}" style="--pct:${value}%">
      <span class="field-help">${esc(t("universe.weightHint"))}</span></div>`;
  }).join("");
  host.querySelectorAll("input[type=range]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.closest("[data-weight]").dataset.weight;
      state.weights[key] = Number(input.value) / 100;
      updateWeightDisplay(true);
    });
  });
  updateWeightDisplay();
}

function updateWeightDisplay(recalculate = false) {
  const total = factorKeys().reduce((sum, key) => sum + (state.weights[key] || 0), 0);
  factorKeys().forEach((key) => {
    const wrapper = document.querySelector(`[data-weight="${key}"]`);
    if (!wrapper) return;
    const value = Math.round((state.weights[key] || 0) * 100);
    wrapper.querySelector("[data-value]").textContent = `${value}%`;
    wrapper.querySelector("input").value = value;
    wrapper.querySelector("input").style.setProperty("--pct", `${value}%`);
  });
  const totalNode = $("weight-total");
  totalNode.textContent = pct(total, total === 1 ? 0 : 1);
  totalNode.classList.toggle("is-off", Math.abs(total - 1) > 0.0001);
  saveWorkspace();
  if (recalculate) scheduleRecalculate();
}

/* ─────────────────────────── Data actions ─────────────────────────── */

async function loadDataset(id) {
  const dataset = state.datasets.find((d) => d.id === id);
  if (!dataset) return;
  if (state.rows.length && !(await confirmAction("dialog.datasetMessage"))) {
    $("dataset-select").value = state.datasetId;
    return;
  }
  state.rows = cloneRows(dataset.rows);
  state.datasetId = id;
  state.importWarnings = [];
  state.filter = "all";
  saveWorkspace();
  updateDatasetDescription();
  $("dataset-select").value = id;
  renderUniverse();
  await recalculate();
  toast(t("toast.datasetLoaded", { name: loc(dataset.label) }), { type: "info" });
}

function addRow() {
  const index = state.rows.length + 1;
  state.rows.push({
    id: uid(), ticker: `NEW-${String(index).padStart(2, "0")}`, note: "",
    ...Object.fromEntries(factorKeys().map((key) => [key, null])),
  });
  saveWorkspace();
  renderUniverse();
  scheduleRecalculate();
  const last = $("universe-body").querySelector("tr:last-child .ticker-input");
  if (last) { last.focus(); last.select(); }
}

async function clearRows() {
  if (!state.rows.length) return;
  if (!(await confirmAction("dialog.clearMessage"))) return;
  state.rows = [];
  saveWorkspace();
  renderUniverse();
  await recalculate();
  toast(t("toast.cleared"), { type: "info" });
}

function onTableInput(event) {
  const target = event.target;
  const rowNode = target.closest("tr[data-row-id]");
  if (!rowNode) return;
  const row = state.rows.find((r) => r.id === rowNode.dataset.rowId);
  if (!row) return;
  if (target.classList.contains("ticker-input")) {
    row.ticker = target.value;
  } else if (target.classList.contains("cell-input")) {
    const key = target.dataset.factor;
    const raw = target.value.trim();
    const parsed = raw === "" ? null : Number(raw.replace(/[۰-۹٠-٩]/g, (d) => "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(d) % 10));
    const invalid = raw !== "" && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100);
    target.classList.toggle("is-invalid", invalid);
    target.classList.toggle("is-empty", raw === "");
    row[key] = raw === "" ? null : (Number.isFinite(parsed) && !invalid ? parsed : raw);
    updateCompletenessCell(rowNode, row);
  }
  saveWorkspace();
  scheduleRecalculate();
}

function onTableChange(event) {
  if (event.target.classList.contains("cell-input")) {
    // Keep the raw value visible if invalid; the server will flag it as missing.
    renderAllWarnings();
  }
}

function onTableClick(event) {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  const id = button.dataset.delete;
  state.rows = state.rows.filter((r) => r.id !== id);
  saveWorkspace();
  renderUniverse();
  scheduleRecalculate();
}

function onTableKeydown(event) {
  if (!["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
  const cell = event.target.closest("td");
  if (!cell || !event.target.matches("input")) return;
  const index = Array.from(cell.parentElement.children).indexOf(cell);
  const row = cell.parentElement;
  const targetRow = event.key === "ArrowUp" ? row.previousElementSibling
    : event.key === "ArrowDown" ? row.nextElementSibling : row.nextElementSibling;
  if (!targetRow) return;
  const input = targetRow.children[index]?.querySelector("input");
  if (input) { event.preventDefault(); input.focus(); if (input.select) input.select(); }
}

function updateCompletenessCell(rowNode, row) {
  const count = factorKeys().filter((key) => {
    const value = row[key];
    return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
  }).length;
  const cell = rowNode.querySelector(".completeness-cell");
  if (cell) {
    cell.innerHTML = `<span class="completeness-dot ${count === factorKeys().length ? "is-full" : ""}"></span>${esc(t("universe.fullInputs", { n: count }))}`;
  }
  rowNode.classList.toggle("is-incomplete", count < factorKeys().length);
}

function normalizeWeights() {
  const total = factorKeys().reduce((sum, key) => sum + (state.weights[key] || 0), 0);
  if (total <= 0) { state.weights = { ...state.meta.weights }; }
  else factorKeys().forEach((key) => { state.weights[key] = (state.weights[key] || 0) / total; });
  updateWeightDisplay(true);
  toast(t("toast.normalized"), { type: "info" });
}

async function resetWeights() {
  if (!(await confirmAction("dialog.resetWeightsMessage"))) return;
  state.weights = { ...state.meta.weights };
  updateWeightDisplay(true);
  toast(t("toast.weightsReset"), { type: "info" });
}

async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (state.rows.length && !(await confirmAction("dialog.importMessage"))) return;
  const form = new FormData();
  form.append("file", file);
  try {
    const result = await api("/api/import", { method: "POST", body: form });
    state.rows = cloneRows(result.rows);
    state.datasetId = "imported";
    state.importWarnings = result.warnings || [];
    buildDatasetSelect();
    saveWorkspace();
    renderUniverse();
    await recalculate();
    toast(t("toast.imported", { n: result.rows.length, name: result.filename }), { type: "info" });
  } catch (error) {
    toast(t("toast.error"), { type: "error", detail: error.message });
  }
}

async function exportCsv() {
  if (!state.rows.length) { toast(t("toast.noRows"), { type: "error" }); return; }
  try {
    const response = await fetch("/api/export", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scoreRequestBody()),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aqx_ranked_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t("toast.exported"), { type: "info" });
  } catch (error) {
    toast(t("toast.error"), { type: "error", detail: error.message });
  }
}

/* ─────────────────────────── Scoring & render orchestration ─────────────────────────── */

function scheduleRecalculate() {
  clearTimeout(state.recalcTimer);
  state.recalcTimer = setTimeout(() => recalculate().catch(() => {}), 320);
}

async function recalculate() {
  if (!state.meta) return;
  try {
    state.ranked = await post("/api/score", scoreRequestBody());
    renderDerived();
    return state.ranked;
  } catch (error) {
    $("health-text").textContent = t("health.error");
    $("health-pill").dataset.tone = "bad";
    toast(t("toast.error"), { type: "error", detail: error.message });
    return null;
  }
}

/** Called after every scoring response. Deliberately does NOT rebuild the
    editable table, so typing is never interrupted by an auto-recalculation. */
function renderDerived() {
  if (!state.meta) return;
  renderHealth();
  renderOverview();
  renderResults();
  renderAllWarnings();
  if (!$("detail-drawer").hidden && state.selectedId) renderDrawer(state.selectedId);
}

/** Full re-render for language, theme and dataset changes. */
function renderAll() {
  if (!state.meta) return;
  localizeStatic();
  buildStaticSections();
  buildDatasetSelect();
  buildUniverseHead();
  buildWeights();
  renderUniverse();
  renderDerived();
  renderScenario();
}

function renderAllWarnings() {
  const warnings = state.ranked?.warnings || [];
  const extra = [...state.importWarnings];
  if (state.datasetId === "demo") extra.push({ code: "demo_data" });
  const html = warningNodes(warnings, extra);
  $("overview-warnings").innerHTML = html;
  $("universe-warnings").innerHTML = html;
}

function renderHealth() {
  const stats = state.ranked?.stats;
  const pill = $("health-pill");
  if (!stats) { $("health-text").textContent = t("health.checking"); pill.dataset.tone = ""; return; }
  if (stats.total === 0) {
    $("health-text").textContent = t("health.empty"); pill.dataset.tone = "bad";
  } else if (stats.incomplete > 0) {
    $("health-text").textContent = t("health.missing", { n: stats.incomplete });
    pill.dataset.tone = "warn";
  } else {
    $("health-text").textContent = t("health.ok", { complete: stats.complete, total: stats.total });
    pill.dataset.tone = "good";
  }
  pill.title = `${stats.complete} / ${stats.total}`;
  $("nav-row-count").textContent = String(stats.total);
}

function kpiCard({ label, value, foot, color, meter }) {
  return `<div class="kpi" style="--kpi-color:var(--${color})">
    <span class="kpi-label">${esc(label)}</span>
    <span class="kpi-value" dir="ltr">${value}</span>
    <span class="kpi-foot">${esc(foot)}</span>
    ${meter !== undefined ? `<span class="kpi-meter"><span style="inline-size:${Math.max(0, Math.min(100, meter))}%"></span></span>` : ""}
  </div>`;
}

function renderOverview() {
  const stats = state.ranked?.stats;
  const rows = state.ranked?.rows || [];
  const total = stats?.total ?? 0;
  const complete = stats?.complete ?? 0;
  $("overview-kpis").innerHTML = [
    kpiCard({ label: t("kpi.universe"), value: num(total), foot: t("kpi.universeFoot"), color: "accent-2" }),
    kpiCard({ label: t("kpi.complete"), value: `${num(complete)}<small> / ${num(total)}</small>`, foot: t("kpi.completeFoot"), color: "accent", meter: total ? (complete / total) * 100 : 0 }),
    kpiCard({ label: t("kpi.median"), value: scoreText(stats?.median), foot: t("kpi.medianFoot"), color: "accent-2", meter: stats?.median ?? 0 }),
    kpiCard({ label: t("kpi.asOf"), value: state.asOf ? `<span dir="ltr">${esc(state.asOf)}</span>` : `<small>${esc(t("kpi.noDate"))}</small>`, foot: t("kpi.asOfFoot"), color: "accent-3" }),
  ].join("");

  const top = rows.filter((r) => r.score_complete).slice(0, 6);
  if (top.length) {
    horizontalBars($("overview-chart"), top.map((r) => ({ label: r.ticker, value: r.composite_score, accent: r.rank === 1 })), {
      caption: t("chart.topRows"), labelHeader: t("universe.colTicker"), valueHeader: t("chart.score"),
    });
  } else {
    chartEmpty($("overview-chart"), t("chart.noData"));
  }

  donut($("completeness-chart"), complete, total, { label: t("common.complete"), sub: t("common.complete") });
  const coverage = stats?.factor_coverage || {};
  $("coverage-list").innerHTML = factorKeys().map((key) => {
    const value = (coverage[key] || 0) * 100;
    return `<div class="coverage-row" data-low="${value < 100}"><span>${esc(factorName(key, true))}</span><span dir="ltr">${num(value, 0)}%</span>
      <span class="bar-track"><span style="inline-size:${value}%"></span></span></div>`;
  }).join("");
  renderAllWarnings();

  const applied = appliedWeights();
  $("overview-weights").innerHTML = factorKeys().map((key) => `
    <div class="weight-mini-row"><span>${esc(factorName(key))}</span>
      <span class="bar-track"><span style="inline-size:${Math.min(100, (applied[key] || 0) * 100 / 0.3)}%"></span></span>
      <b dir="ltr">${esc(pct(applied[key] || 0, 1))}</b></div>`).join("");
}

function renderUniverse() {
  renderUniverseBody();
  renderAllWarnings();
  updateDatasetDescription();
}

function renderUniverseBody() {
  const body = $("universe-body");
  const search = state.universeSearch;
  const visible = state.rows.filter((row) => !search || String(row.ticker).toLowerCase().includes(search));
  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="${factorKeys().length + 3}" class="empty-state">${esc(search ? t("results.noRows") : t("warn.empty_universe"))}</td></tr>`;
  } else {
    body.innerHTML = visible.map((row) => {
      const filled = factorKeys().filter((key) => {
        const value = row[key];
        return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
      }).length;
      const cells = factorKeys().map((key) => {
        const raw = row[key];
        const isEmpty = raw === null || raw === "" || raw === undefined;
        const invalid = !isEmpty && (!Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 100);
        return `<td data-label="${esc(factorName(key, true))}"><input class="cell-input ${isEmpty ? "is-empty" : ""} ${invalid ? "is-invalid" : ""}"
          type="text" inputmode="decimal" dir="ltr" value="${esc(isEmpty ? "" : raw)}"
          data-factor="${esc(key)}" aria-label="${esc(row.ticker)} — ${esc(factorName(key))}" maxlength="8"></td>`;
      }).join("");
      return `<tr data-row-id="${esc(row.id)}" class="${filled < factorKeys().length ? "is-incomplete" : ""}">
        <td class="ticker-cell" data-label="${esc(t("universe.colTicker"))}"><input class="ticker-input" type="text" value="${esc(row.ticker)}" dir="auto" maxlength="48" aria-label="${esc(t("universe.colTicker"))}" data-role="ticker"></td>
        ${cells}
        <td class="completeness-cell" data-label="${esc(t("universe.colComplete"))}"><span class="completeness-dot ${filled === factorKeys().length ? "is-full" : ""}"></span>${esc(t("universe.fullInputs", { n: filled }))}</td>
        <td data-label=""><button class="row-delete" data-delete="${esc(row.id)}" aria-label="${esc(t("universe.deleteAria"))}">${icon("trash")}</button></td>
      </tr>`;
    }).join("");
  }
  $("row-count-label").textContent = t("universe.rowCount", { shown: visible.length, total: state.rows.length });
}

/* ─────────────────────────── Results ─────────────────────────── */

function renderResults() {
  const stats = state.ranked?.stats;
  const rows = state.ranked?.rows || [];
  $("results-kpis").innerHTML = [
    kpiCard({ label: t("resultsKpi.median"), value: scoreText(stats?.median), foot: t("resultsKpi.medianFoot"), color: "accent" }),
    kpiCard({ label: t("resultsKpi.spread"), value: (stats?.p25 !== null && stats?.p25 !== undefined) ? `${scoreText(stats.p25, 1)}–${scoreText(stats.p75, 1)}` : "—", foot: t("resultsKpi.spreadFoot"), color: "accent-2" }),
    kpiCard({ label: t("resultsKpi.top"), value: scoreText(stats?.max), foot: t("resultsKpi.topFoot"), color: "accent-3" }),
    kpiCard({ label: t("resultsKpi.movers"), value: num(stats?.rank_movers ?? 0), foot: t("resultsKpi.moversFoot"), color: "accent-2" }),
  ].join("");
  const computed = state.ranked?.computed_at;
  $("computed-at").textContent = computed
    ? t("results.computedAt", { time: new Date(computed).toLocaleString(getLang() === "fa" ? "fa-IR" : "en-GB") })
    : "";

  const bins = (stats?.distribution || []).map((b) => ({ x0: b.from, x1: b.to, count: b.count }));
  const hasScores = (stats?.complete || 0) > 0;
  if (hasScores) {
    histogram($("distribution-chart"), bins, {
      caption: t("chart.score"), valueHeader: t("chart.count"),
      formatX: (v) => num(v, 0),
      markers: [{ key: "median", label: t("chart.medianLine"), value: stats.median }],
      formatValue: (v) => num(v, 1),
    });
  } else {
    chartEmpty($("distribution-chart"), t("chart.noData"));
  }

  buildBands();
  buildStatusFilters();
  renderRankedList();
  renderSensitivity(rows, stats);
}

function renderRankedList() {
  const rows = state.ranked?.rows || [];
  const search = state.resultsSearch;
  const visible = rows.filter((row) =>
    (state.filter === "all" || row.status_key === state.filter)
    && (!search || String(row.ticker).toLowerCase().includes(search)));
  const host = $("ranked-list");
  if (!visible.length) {
    host.innerHTML = "";
    $("ranked-empty").hidden = false;
    return;
  }
  $("ranked-empty").hidden = true;
  host.innerHTML = visible.map((row) => {
    const score = row.composite_score;
    const delta = row.rank_delta;
    let deltaHtml = `<span class="rank-delta">—</span>`;
    if (delta !== null && delta !== undefined) {
      const dir = delta > 0 ? "down" : delta < 0 ? "up" : "flat";
      const arrow = delta > 0 ? "arrow-down" : delta < 0 ? "arrow-up" : null;
      const text = delta === 0 ? "±0" : `${delta > 0 ? "−" : "+"}${Math.abs(delta)}`;
      deltaHtml = `<span class="rank-delta" data-dir="${dir}" title="${esc(t("results.moverDetail", { from: row.rank, to: row.equal_rank }))}">${arrow ? icon(arrow) : ""}${text}</span>`;
    }
    return `<div class="rank-row ${row.score_complete ? "" : "is-incomplete"} ${row.rank === 1 ? "is-top" : ""}">
      <span class="rank-number">${row.rank !== null ? num(row.rank) : "—"}</span>
      <span class="rank-name"><b dir="auto">${esc(row.ticker)}</b>${chip(row.status_key)}</span>
      <span class="rank-score-bar"><span class="bar-track"><span style="inline-size:${score !== null ? Math.max(0, Math.min(100, score)) : 0}%"></span></span></span>
      <span class="rank-score ${score === null ? "is-empty" : ""}" dir="ltr">${scoreText(score)}</span>
      ${deltaHtml}
      <button class="inspect-btn" data-inspect="${esc(row.id)}">${icon("eye")}<span>${esc(t("results.inspect"))}</span></button>
    </div>`;
  }).join("");
}

function renderSensitivity(rows, stats) {
  const movers = rows.filter((r) => r.rank_delta !== null && Math.abs(r.rank_delta) >= 2)
    .sort((a, b) => Math.abs(b.rank_delta) - Math.abs(a.rank_delta));
  const count = movers.length;
  const total = stats?.complete || 0;
  $("sensitivity-summary").innerHTML = `<strong>${esc(num(count))}</strong>${esc(count
    ? t("results.rankMovers", { movers: count, total })
    : t("results.noMovers"))}`;
  $("sensitivity-list").innerHTML = movers.slice(0, 6).map((row) => {
    const up = row.rank_delta < 0;
    return `<div class="mover-row" data-dir="${up ? "up" : "down"}">${icon(up ? "arrow-up" : "arrow-down")}
      <b dir="auto">${esc(row.ticker)}</b><span class="num">${num(row.rank)} → ${num(row.equal_rank)}</span></div>`;
  }).join("") || `<div class="mover-row">${icon("check")}<span>${esc(t("results.noMovers"))}</span></div>`;
}

/* ─────────────────────────── Detail drawer ─────────────────────────── */

function openDrawer(id) {
  state.selectedId = id;
  state.lastFocus = document.activeElement;
  $("drawer-scrim").hidden = false;
  $("detail-drawer").hidden = false;
  document.body.classList.add("is-locked");
  renderDrawer(id);
  $("drawer-close").focus();
}

function closeDrawer() {
  $("detail-drawer").hidden = true;
  $("drawer-scrim").hidden = true;
  document.body.classList.remove("is-locked");
  state.selectedId = null;
  if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
}

function trapDrawerFocus(event) {
  if (event.key !== "Tab") return;
  const focusables = $("detail-drawer").querySelectorAll('button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function renderDrawer(id) {
  const row = (state.ranked?.rows || []).find((r) => r.id === id);
  if (!row) { closeDrawer(); return; }
  const keys = factorKeys();
  const weights = appliedWeights();
  const medians = state.ranked?.stats?.factor_medians || {};
  const scores = keys.map((key) => row.factors[key]);
  const filled = keys.map((key, i) => ({ key, value: scores[i] })).filter((f) => f.value !== null && f.value !== undefined);
  const weakest = filled.length ? filled.reduce((a, b) => (a.value <= b.value ? a : b)) : null;
  const strongest = filled.length ? filled.reduce((a, b) => (a.value >= b.value ? a : b)) : null;
  $("drawer-title").textContent = row.ticker;
  $("drawer-title").setAttribute("dir", "auto");

  const summary = `<div class="drawer-summary">
      <div class="drawer-score"><strong dir="ltr">${row.score_complete ? scoreText(row.composite_score) : t("common.noData")}</strong>
        <span>${esc(t("drawer.composite"))}</span></div>
      <div style="display:grid;gap:6px;justify-items:end">${chip(row.status_key)}
        <span class="muted-small">${row.rank ? `#${num(row.rank)}` : ""}</span></div>
    </div>`;

  const incomplete = row.score_complete ? "" : `<div class="inline-notice" data-tone="info">${icon("info")}<span><strong>${esc(t("drawer.incompleteTitle"))}</strong><br>${esc(t("drawer.incompleteBody"))}</span></div>`;

  const radarBlock = `<div class="drawer-section"><h4>${esc(t("drawer.profileTitle"))}</h4>
    <div class="radar-host" id="drawer-radar"></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:11.5px;color:var(--text-2)">
      <span><span style="display:inline-block;width:14px;height:3px;background:var(--accent-2);vertical-align:middle"></span> ${esc(t("drawer.legendCurrent"))}</span>
      <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed var(--tone-neutral);vertical-align:middle"></span> ${esc(t("drawer.legendMedian"))}</span>
    </div></div>`;

  const tableRows = keys.map((key) => {
    const value = row.factors[key];
    const contribution = row.contributions?.[key];
    const weak = weakest && weakest.key === key;
    return `<tr><td>${esc(factorName(key, true))}</td>
      <td class="${weak ? "is-weak" : ""}" dir="ltr">${value === null || value === undefined ? t("common.noData") : scoreText(value, 1)}</td>
      <td dir="ltr">${esc(pct(weights[key] || 0, 1))}</td>
      <td dir="ltr">${contribution === null || contribution === undefined ? t("common.noData") : scoreText(contribution, 2)}</td></tr>`;
  }).join("");
  const breakdown = `<div class="drawer-section"><h4>${esc(t("drawer.breakdown"))}</h4>
    <table class="factor-detail-table"><thead><tr>
      <th>${esc(t("drawer.colFactor"))}</th><th>${esc(t("drawer.colScore"))}</th>
      <th>${esc(t("drawer.colWeight"))}</th><th>${esc(t("drawer.colPoints"))}</th>
    </tr></thead><tbody>${tableRows}</tbody></table>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      ${weakest ? `<span class="status-chip" data-tone="caution">${esc(t("drawer.weakest"))}: ${esc(factorName(weakest.key, true))} (${scoreText(weakest.value, 1)})</span>` : ""}
      ${strongest ? `<span class="status-chip" data-tone="positive">${esc(t("drawer.strongest"))}: ${esc(factorName(strongest.key, true))} (${scoreText(strongest.value, 1)})</span>` : ""}
    </div></div>`;

  const question = weakest ? loc(factorMeta(weakest.key)?.question) : "";
  const localRow = state.rows.find((r) => r.id === id);
  const counter = `<div class="counter-panel"><h4>${esc(t("drawer.counterTitle"))}</h4>
    <p>${esc(t("drawer.counterBody"))}</p>
    ${question ? `<ul><li>${esc(question)}</li></ul>` : ""}
    <div class="memo-area"><label class="field-label" for="memo-input">${esc(t("drawer.memoLabel"))}</label>
      <textarea id="memo-input" data-memo="${esc(id)}" placeholder="${esc(t("drawer.memoPlaceholder"))}">${esc(localRow?.note || "")}</textarea>
      <button class="btn btn-soft btn-tiny" data-save-memo="${esc(id)}">${icon("check")}<span>${esc(t("drawer.memoSave"))}</span></button>
    </div></div>`;

  const notTell = `<div class="drawer-section"><h4>${esc(t("drawer.notTellTitle"))}</h4>
    <ul class="drawer-limits">${[1, 2, 3].map((i) => `<li>${icon("alert")}<span>${esc(t(`drawer.notTell${i}`))}</span></li>`).join("")}</ul></div>`;

  $("drawer-body").innerHTML = summary + incomplete + radarBlock + breakdown + counter + notTell;
  radar($("drawer-radar"), keys.map((key) => factorName(key, true)), scores,
    keys.map((key) => medians[key] ?? null), { caption: t("drawer.profileTitle") });
}

async function saveMemo() {
  const textarea = $("drawer-body").querySelector("[data-memo]");
  if (!textarea) return;
  const row = state.rows.find((r) => r.id === textarea.dataset.memo);
  if (row) row.note = textarea.value.slice(0, 600);
  saveWorkspace();
  await recalculate();
  toast(t("toast.memoSaved"), { type: "info" });
}

/* ─────────────────────────── Scenario ─────────────────────────── */

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  $("sim-return").value = preset.return;
  $("sim-volatility").value = preset.volatility;
  $("sim-years").value = preset.years;
  $("sim-simulations").value = preset.simulations;
  document.querySelectorAll(".preset").forEach((btn) => btn.classList.toggle("is-selected", btn.dataset.preset === name));
}

async function runSimulation() {
  const button = $("run-sim-btn");
  button.disabled = true;
  button.querySelector("span").textContent = t("scenario.running");
  try {
    state.simulation = await post("/api/simulate", {
      initial_capital: Number($("sim-capital").value),
      annual_return: Number($("sim-return").value) / 100,
      volatility: Number($("sim-volatility").value) / 100,
      years: Number($("sim-years").value),
      simulations: Number($("sim-simulations").value),
      seed: Number($("sim-seed").value),
    });
    renderScenario();
    toast(t("toast.simDone", { n: num(state.simulation.summary.simulations) }), { type: "info" });
  } catch (error) {
    toast(t("toast.error"), { type: "error", detail: error.message });
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = t("scenario.run");
  }
}

function renderScenario() {
  const sim = state.simulation;
  $("sim-empty-card").hidden = !!sim;
  $("sim-result-card").hidden = !sim;
  $("sim-sens-card").hidden = !sim;
  $("sim-caveat-card").hidden = !sim;
  if (!sim) return;
  const { summary, histogram: bins, markers, chart_bounds, sensitivity } = sim;
  $("sim-count-chip").textContent = t("scenario.paths", { n: num(summary.simulations) });
  histogram($("simulation-chart"), bins, {
    accent: true, caption: t("scenario.outcomes"), valueHeader: t("chart.count"),
    formatX: (v) => compact(v), formatValue: (v) => compact(v),
    markers: [
      { key: "p05", label: t("chart.p05"), value: markers.p05 },
      { key: "median", label: t("chart.median"), value: markers.median },
      { key: "p95", label: t("chart.p95"), value: markers.p95 },
    ],
  });
  const tails = (chart_bounds.tail_low || 0) + (chart_bounds.tail_high || 0);
  $("sim-chart-caption").textContent = t("chart.tailNote", { n: num(tails) });
  $("sim-kpis").innerHTML = [
    { label: t("scenario.kpiMedian"), value: compact(summary.median_terminal_value), help: t("scenario.kpiMedianHelp") },
    { label: t("scenario.kpiRange"), value: `${compact(summary.p05_terminal_value)} – ${compact(summary.p95_terminal_value)}`, help: t("scenario.kpiRangeHelp") },
    { label: t("scenario.kpiLoss"), value: pct(summary.fraction_loss_under_assumptions, 1), help: t("scenario.kpiLossHelp") },
    { label: t("scenario.kpiVar"), value: pct(summary.VaR95_loss_fraction, 1), help: t("scenario.kpiVarHelp") },
    { label: t("scenario.kpiCvar"), value: pct(summary.CVaR95_loss_fraction, 1), help: t("scenario.kpiCvarHelp") },
  ].map((kpi) => `<div class="sim-kpi"><span>${esc(kpi.label)}</span><strong dir="ltr">${esc(kpi.value)}</strong><small>${esc(kpi.help)}</small></div>`).join("");

  const labelKey = (key) => ({ low: "scenario.sensLow", base: "scenario.sensBase", high: "scenario.sensHigh" }[key]);
  $("sim-sens-table").innerHTML = `<thead><tr>
      <th>${esc(t("scenario.tableScenario"))}</th><th>${esc(t("scenario.tableVol"))}</th>
      <th>${esc(t("scenario.tableP05"))}</th><th>${esc(t("scenario.tableMedian"))}</th>
      <th>${esc(t("scenario.tableP95"))}</th><th>${esc(t("scenario.tableLoss"))}</th>
    </tr></thead><tbody>${sensitivity.map((row) => `<tr>
      <td class="row-label">${esc(t(labelKey(row.key)))}</td><td dir="ltr">${esc(pct(row.volatility, 1))}</td>
      <td dir="ltr">${esc(compact(row.p05))}</td><td dir="ltr">${esc(compact(row.median))}</td>
      <td dir="ltr">${esc(compact(row.p95))}</td><td dir="ltr">${esc(pct(row.loss_chance, 1))}</td>
    </tr>`).join("")}</tbody>`;
}

/* ─────────────────────────── Go ─────────────────────────── */
boot();
