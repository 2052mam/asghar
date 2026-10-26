# AQx–Tirole Omega · v1.2

> **Educational research prototype. Not investment advice.** No live market or
> Codal data is fetched, no symbol is ranked automatically, and no output is a
> buy/sell signal or a calibrated probability. Every score in the application
> comes from data you enter or import.

![Overview of the Persian workspace](docs/preview.png)

This repository started as a Persian-language CLI prototype for a six-factor
equity screen (`aqx_tirole_omega.py`). Version 1.2 adds a complete,
**Persian-first (فارسی / English), fully responsive Flask web interface** built
with plain HTML, CSS and JavaScript — no frontend build step, no CDN, no remote
fonts, no analytics. Persian/RTL is the default; a segmented language switch
remembers an English preference. The original CLI still works and remains the
analytical source of truth.

### Design language (v1.2)

The interface uses a locally bundled **Vazirmatn** variable font for Persian and
**Plus Jakarta Sans** for Latin (SIL OFL, licenses in `static/fonts/`), a
signature six-factor colour palette, an illustrated aurora hero with a subtle
Persian geometric (girih) pattern, glass surfaces over a drifting gradient
canvas, gradient SVG charts with grow-in animation, KPI sparklines, a
three-step workflow narrative, a clickable band spectrum and per-row factor
sparklines. Motion is subtle, respects `prefers-reduced-motion`, and the
uncertainty-first psychology of the original build is unchanged. See
[DESIGN.md](DESIGN.md) for the full rationale.

---

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py                      # http://localhost:5000
```

Then open `http://localhost:5000`. The workspace starts with **synthetic DEMO
rows** so you can explore the interface immediately. Replace them with your own
dated research, import a CSV, or choose the shipped blank Iranian ticker list.

For a production deployment, run a WSGI server instead of the development
server, e.g. `pip install waitress && waitress-serve --host 0.0.0.0 --port 5000 app:app`.

### Requirements

- Python 3.10+
- `Flask>=3,<4`, `pandas>=2,<4`, `numpy>=1.24,<3`
- A modern browser with ES modules, CSS `color-mix()` and SVG support
  (Chrome/Edge 111+, Firefox 113+, Safari 16.2+)

---

## What the interface does

| View | Purpose |
| --- | --- |
| **Overview** | KPI cards, top-ranked bars, a completeness ring, per-factor coverage, weight summary and the limitations that must travel with the numbers. |
| **Universe** | Editable score table (0–100), six weight sliders with a visible total, research as-of date and provenance note, CSV import/template/export, dataset loader, inline validation. |
| **Results** | Distribution histogram, interpretation bands, searchable/filterable ranked list, and a **weight-sensitivity check** that re-ranks everything with equal weights. Inspecting a row opens a radar chart, factor contributions, weakest/strongest inputs, a counter-evidence memo and an explicit "what this does not tell you" list. |
| **Scenario lab** | Monte Carlo terminal-value simulation with a full histogram, 5th/median/95th percentile markers, VaR/CVaR, loss frequency, and an assumption-sensitivity table (0.5× / 1× / 1.5× volatility). Prominent framing notes explain what the chart excludes. |
| **Method & limits** | Published formula, factor definitions with debiasing questions, all limitations, the design-system rationale, accessibility/privacy statement, and CLI usage. |

Other behaviours:

- **Persian by default, bilingual + RTL.** Persian/RTL loads first; one click on
  the `فا | EN` switch changes language, direction, labels and charts. Numeric
  cells stay LTR for legibility. Language, theme and the workspace persist in
  `localStorage`.
- **Dark by default**, with a one-click light theme that is remembered. The hero
  stays dark in both themes so the illustrated identity remains consistent.
- **Local-first.** Your rows never leave the browser except for the scoring and
  export requests you trigger; there is no account, no database and no tracking.
- **Auto-recalculation** is debounced, so typing in the score table is never
  interrupted by a re-render.

---

## Data format

One row per ticker. Scores are numbers between `0` and `100`; an empty cell means
*evidence is missing*, which is **not** a zero. Any row with a missing factor is
left unscored — this prevents incomplete data from producing a false ranking.

```csv
ticker,competition,valuation,earnings_quality,growth,market_momentum,risk_control,note
EXAMPLE_ONLY,70,65,75,60,55,60,Illustrative only
YOUR_TICKER,,,,,,,
```

- `GET /api/template.csv` downloads a ready-to-fill template.
- `iran_universe_blank.csv` ships 18 sample Iranian symbols with empty scores.
- `data/illustrative_demo.csv` ships 14 clearly fictional `DEMO-xx` rows; the UI
  labels them synthetic everywhere they appear.
- Import accepts UTF-8 (with or without BOM), Windows-1256 and Latin-1 CSV,
  English or Persian headers, Persian/Arabic digits, comma or auto-detected
  delimiters, and an optional `note` column. Unrecognised columns are reported
  and ignored rather than silently dropped.

### Default weights

| Factor | Weight |
| --- | ---: |
| Competitive strength | 25% |
| Valuation appeal | 25% |
| Earnings quality | 15% |
| Growth capacity | 15% |
| Market momentum | 10% |
| Risk control | 10% |

All six weights are editable. Any positive set is normalised to 100% **and the
applied weights are reported back** in the results and in the exported CSV.

### Bands

`≥ 80` deeper review · `≥ 70` worth reviewing · `≥ 60` needs more evidence ·
`< 60` lower priority in this screen · incomplete → no score. Bands are
prompts to investigate, not trading thresholds.

---

## HTTP API

All endpoints are local JSON (except the CSV downloads). Errors return
`{"ok": false, "error": {"code": ..., "message": ...}}`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Application shell. |
| `GET` | `/api/health` | Version/health check. |
| `GET` | `/api/meta` | Factors, bilingual labels, weights, bands, statuses, limitations, bounds. |
| `GET` | `/api/datasets` | Shipped demo and blank universes. |
| `POST` | `/api/score` | `{rows, weights?, asOf?}` → ranked rows, statistics, distribution, coverage, equal-weight ranks, warnings, applied weights. |
| `POST` | `/api/simulate` | `{initial_capital, annual_return, volatility, years, simulations, seed}` → summary, 40-bin histogram, percentile markers, volatility sensitivity. |
| `POST` | `/api/import` | `multipart/form-data` file → validated rows + warnings. |
| `GET` | `/api/template.csv` | CSV template (UTF-8 BOM). |
| `POST` | `/api/export` | `{rows, weights?, asOf?}` → ranked CSV (UTF-8 BOM, includes applied weights and as-of date). |

Limits: 250 rows per universe, 2 MB uploads, 100–50,000 simulations.

---

## Project layout

```
app.py                     Flask app, validation, CSV I/O, API routes
aqx_tirole_omega.py        Original analytical core (scoring + Monte Carlo)
templates/index.html       Semantic bilingual app shell + icon sprite
static/css/styles.css      Design tokens, components, RTL, responsive, a11y
static/js/app.js           State, routing, rendering, events
static/js/i18n.js          FA/EN dictionary and DOM binding (Persian default)
static/js/charts.js        Dependency-free SVG charts
static/fonts/              Local variable fonts + SIL OFL license texts
static/img/                Generated hero artwork + girih pattern
static/favicon.svg         App icon
data/illustrative_demo.csv Synthetic demo values
tests/test_app.py          API, validation, import/export and CLI regression tests
tests/frontend_smoke.mjs   Optional jsdom UI smoke test (npm run smoke)
package.json               Optional Node dev dependency for the smoke test
README_FA.md               Original Persian documentation (+ GUI section)
DESIGN.md                  Design system and psychological rationale
docs/preview.png           Screenshot of the default Persian workspace
```

---

## Tests

```bash
pip install pytest
pytest -q
```

The suite covers scoring correctness, incomplete-data handling, invalid-cell
sanitisation, weight normalisation, simulation determinism, CSV import with
Persian headers, template/export output and the unchanged CLI entrypoint.

An optional DOM smoke test runs the real ES modules against a live server:

```bash
python app.py &                # or use the preview server
npm install                    # installs jsdom only
npm run smoke                  # set AQX_BASE_URL to override the origin
```

It checks rendering, navigation, charts, the detail drawer, scenario lab,
EN↔FA/RTL switching, theme switching and live cell editing without a real
browser.

---

## Limitations (unchanged from the original project)

- No automatic market or Codal data retrieval is implemented.
- Fundamental valuation requires valid, dated financial statements.
- A capital increase alone does not create value; dilution, use of proceeds and
  profitability must be examined separately.
- A screening score is not a buy/sell signal or a guarantee of return.
- Monte Carlo parameters are assumptions, not calibrated forecasts; its output
  is not the real probability of gain or loss on a share.

See [DESIGN.md](DESIGN.md) for how the interface makes these limits visible and
resists common judgement biases.
