/**
 * Optional browser-DOM smoke test (no real browser required).
 *
 *   npm install
 *   python app.py                 # in another terminal
 *   npm run smoke
 *
 * It mounts the real index.html in jsdom, executes the real ES modules against
 * the running Flask API, and exercises navigation, charts, drawer, scenario
 * lab, language/theme switching and live editing. jsdom is the only dependency.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = process.env.AQX_BASE_URL || 'http://127.0.0.1:5000';
const PAGE = `${BASE}/`;

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  console.error('jsdom is not installed. Run `npm install` first.');
  process.exit(2);
}

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'templates/index.html'), 'utf8'), {
  url: PAGE, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
});
const { window } = dom;
window.scrollTo = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
  this.dispatchEvent(new window.Event('close'));
};

for (const key of ['document', 'localStorage', 'CustomEvent', 'Event', 'FormData',
  'Node', 'HTMLElement', 'navigator', 'location', 'history',
  'getComputedStyle', 'requestAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => nativeFetch(new URL(String(input), BASE), init);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
let checks = 0;
function assert(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  checks += 1;
  console.log(`  ✓ ${label}`);
}
function click(selector) {
  const node = window.document.querySelector(selector);
  assert(!!node, `element exists: ${selector}`);
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return node;
}
function go(view) {
  window.location.hash = `#/${view}`;
  window.dispatchEvent(new window.Event('hashchange'));
}

process.on('unhandledRejection', (e) => errors.push(`unhandledRejection: ${e?.stack || e}`));
process.on('uncaughtException', (e) => errors.push(`uncaughtException: ${e?.stack || e}`));

try {
  await import(pathToFileURL(path.join(ROOT, 'static/js/app.js')).href + `?v=${Date.now()}`);
  await waitFor(() => window.document.querySelector('#overview-chart svg'), 'initial render');

  console.log('\nInitial render (FA / RTL / dark / overview)');
  assert(window.document.documentElement.lang === 'fa', 'Persian is the default language');
  assert(window.document.documentElement.dir === 'rtl', 'RTL is the default direction');
  assert(window.document.querySelector('[data-lang="fa"]').classList.contains('is-active'), 'language switch shows Persian active');
  assert(window.document.documentElement.dataset.theme === 'dark', 'dark theme applied');
  assert(window.document.querySelectorAll('#overview-kpis .kpi').length === 4, '4 KPI cards');
  assert(window.document.querySelectorAll('#overview-kpis .kpi-spark').length >= 2, 'KPI sparklines');
  assert(window.document.querySelectorAll('#overview-chart svg rect.chart-bar').length > 0, 'ranking bars');
  assert(window.document.querySelector('#completeness-chart svg'), 'completeness donut');
  assert(window.document.querySelectorAll('#coverage-list .coverage-row').length === 6, '6 coverage rows');
  assert(/ساختگی|synthetic/.test(window.document.querySelector('#overview-warnings').textContent), 'synthetic-data warning');
  assert(window.document.querySelector('#nav-row-count').textContent === '14', '14 demo rows');
  assert(window.document.querySelectorAll('.workflow-steps .workflow-step').length === 3, '3 workflow steps');
  assert(window.document.querySelectorAll('#factor-legend .factor-pill').length === 6, '6 factor legend pills');
  assert(window.document.querySelectorAll('#hero-float-bars .hero-float-bar').length === 6, '6 hero signature bars');
  assert(window.document.querySelectorAll('#sidebar-progress-ring span').length === 1, 'sidebar completeness ring');
  assert(window.document.querySelectorAll('#design-principles .design-principle').length === 6, '6 design principles');
  assert(window.document.querySelectorAll('#method-factors .method-factor').length === 6, '6 method factors');
  assert(window.document.querySelectorAll('#bands-list .band-row').length === 5, '5 interpretation bands');

  console.log('\nNavigation and results');
  go('universe');
  assert(!window.document.querySelector('#view-universe').hidden, 'universe view visible');
  assert(window.document.querySelectorAll('#universe-body tr').length === 14, '14 editable rows');
  assert(window.document.querySelectorAll('#weight-sliders input[type=range]').length === 6, '6 weight sliders');
  go('results');
  assert(window.document.querySelectorAll('#ranked-list .rank-row').length === 14, '14 ranked rows');
  assert(window.document.querySelectorAll('#distribution-chart svg rect.chart-bar').length > 0, 'score histogram');
  assert(window.document.querySelectorAll('#results-kpis .kpi').length === 4, '4 results KPIs');
  assert(window.document.querySelectorAll('#score-spectrum .spectrum-seg').length === 4, '4 score-band spectrum segments');
  assert(window.document.querySelectorAll('#ranked-list .factor-spark').length === 14, 'factor sparklines in ranked rows');
  assert(window.document.querySelectorAll('#sensitivity-list .mover-row').length >= 1, 'sensitivity check');

  console.log('\nDetail drawer');
  click('#ranked-list .inspect-btn');
  assert(!window.document.querySelector('#detail-drawer').hidden, 'drawer opened');
  assert(window.document.querySelector('#drawer-radar svg'), 'radar chart');
  assert(window.document.querySelectorAll('.factor-detail-table tbody tr').length === 6, '6 factor rows');
  assert(window.document.querySelector('#memo-input'), 'counter-evidence memo');
  click('#drawer-close');
  assert(window.document.querySelector('#detail-drawer').hidden, 'drawer closed');

  console.log('\nScenario lab');
  go('scenario');
  click('.preset[data-preset="stressed"]');
  assert(window.document.querySelector('#sim-volatility').value === '55', 'stressed preset');
  click('#run-sim-btn');
  await waitFor(() => !window.document.querySelector('#sim-result-card').hidden, 'simulation result');
  assert(window.document.querySelectorAll('#simulation-chart svg rect.chart-bar-accent').length > 0, 'simulation histogram');
  assert(window.document.querySelectorAll('#sim-kpis .sim-kpi').length === 5, '5 simulation KPIs');
  assert(window.document.querySelectorAll('#sim-sens-table tbody tr').length === 3, '3 sensitivity scenarios');
  assert(!window.document.querySelector('#sim-caveat-card').hidden, 'caveat visible');

  console.log('\nLanguage, theme, live editing');
  click('[data-lang="en"]');
  assert(window.document.documentElement.dir === 'ltr', 'LTR direction in English');
  assert(window.document.documentElement.lang === 'en', 'English language selected');
  assert(window.document.querySelector('[data-lang="en"]').classList.contains('is-active'), 'language switch shows English active');
  assert(window.document.querySelectorAll('#universe-body tr').length === 14, 'table survives language switch');
  click('[data-lang="fa"]');
  assert(window.document.documentElement.dir === 'rtl', 'RTL direction restored');
  assert(window.document.documentElement.lang === 'fa', 'Persian restored');
  click('#theme-btn');
  assert(window.document.documentElement.dataset.theme === 'light', 'light theme');

  go('universe');
  const cell = window.document.querySelector('#universe-body .cell-input');
  cell.value = '95';
  cell.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => window.document.querySelector('#nav-row-count').textContent === '14', 'recalculation after edit');
  assert(!window.document.querySelector('#universe-body .cell-input').classList.contains('is-invalid'), 'valid cell');
  const slider = window.document.querySelector('#weight-sliders input[type=range]');
  slider.value = '45';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => window.document.querySelector('#weight-total').classList.contains('is-off'), 'weight total update');

  if (errors.length) throw new Error(`Runtime errors:\n${errors.join('\n')}`);
  assert(true, 'no runtime or console errors');
  console.log(`\n${checks} frontend smoke checks passed.`);
} catch (error) {
  console.error('\nSMOKE TEST FAILED:', error.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  dom.window.close();
}
