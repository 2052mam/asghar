# Design system & psychological rationale

**AQx–Tirole Omega v1.2** · Flask + vanilla HTML/CSS/JS

This document explains *why* the interface looks and behaves the way it does.
The product domain is investment research, an area where interfaces can easily
manufacture false confidence. The design goal is therefore not "maximise
engagement" but **calibrate trust**: show the number, show how it was produced,
show what could be wrong with it, and make the absence of evidence visible.

## 0. What changed in the v1.2 design revision

Persian is now the **default document language and direction** (`<html lang="fa"
dir="rtl">`), with a visible `فا | EN` segmented switch; the browser locale no
longer overrides the product's primary audience. The visual system was
strengthened without weakening the psychological guardrails:

| Upgrade | Why it is engaging *and* responsible |
| --- | --- |
| Locally bundled **Vazirmatn** (Persian) and **Plus Jakarta Sans** (Latin) variable fonts, with their OFL licences | Persian text finally has a purpose-built typeface instead of a system fallback; no CDN request, no tracking, no FOUT dependency. |
| A signature **six-factor colour palette** | Colour becomes a consistent *identity* cue (competition, valuation, earnings, growth, momentum, risk) rather than a good/bad signal. Status still uses separate neutral tones with text. |
| Illustrated **aurora hero** with a generated glass-ribbon artwork, a low-opacity girih (Persian geometric) pattern, metric tiles and a floating signature card | Gives the product a memorable first impression and a sense of place, while remaining purely decorative (no fake charts or implied live data). |
| Drifting gradient canvas, glass surfaces, gradient-topped cards, glow accents | Depth and hierarchy replace flat boxes; contrast and text legibility are preserved in both themes. |
| Gradient SVG charts with grow-in animation, area fills, KPI sparklines, per-row factor sparklines, a clickable band spectrum | More information per glance; each embellishment is tied to real data, never random decoration. |
| A three-step **workflow narrative** and sidebar completeness ring | Turns a passive dashboard into a guided research ritual; the workflow explicitly ends with "write the counter-case". |
| Staggered card entrance, subtle pointer parallax, floating card, animated meters | Deliberate motion signals freshness without urgency; all animation is disabled under `prefers-reduced-motion`. |

The hero is intentionally dark in **both** themes, so the illustrated identity
stays consistent; its local token overrides keep all text above AA contrast on
the artwork overlay.

---

## 1. Design principles

| # | Principle | Concrete implementation |
| --- | --- | --- |
| 1 | **Uncertainty is always visible** | Every headline number has a companion: KPIs show complete/total, the median sits next to a 25–75 interquartile band, the scenario chart shows the 5th/95th percentiles and the loss tail, and the completeness ring shows exactly how much input is missing. |
| 2 | **Force consideration of the opposite** | Each factor ships with a debiasing question ("What evidence would lower this score?"). The detail drawer highlights the **weakest** input first, offers a "consider the opposite" panel and a persisted analyst memo asking what would change the analyst's mind. |
| 3 | **Make the method inspectable** | Weights, bands, the formula, the applied (normalised) weights and the equal-weight rank comparison are all in the UI — not hidden in a model card. Exported CSV repeats the applied weights and as-of date. |
| 4 | **Reduce cognitive load** | One task per view, progressive disclosure (overview → table → results → detail), a consistent 4px spacing scale, ≤ 72ch line lengths, sticky navigation, and a single predictable place for global controls. |
| 5 | **Honest framing** | Status labels say "deeper review", "needs more evidence", "lower priority in this screen". No "buy", "strong buy", "outperform", no green/red price arrows, no countdowns, no streak rewards. |
| 6 | **Missing ≠ zero** | Empty cells stay empty, rows stay unscored, warnings name the exact cell. This is both a data-integrity rule and an anti-anchoring device. |
| 7 | **Support deliberate pace** | Debounced recalculation, non-modal toasts, no attention-grabbing animation, no auto-refresh, `prefers-reduced-motion` support, and a "before reading the chart" framing panel in the scenario lab. |
| 8 | **Robustness over precision** | Scores are rounded to two decimals, chart axes are labelled, extreme simulation tails are explicitly reported as excluded from the *chart only*, and a sensitivity check shows how much of the ranking is an artefact of the chosen weights. |

### Bias countermeasures

Well-established biases in judgement and decision-making are addressed with
specific UI mechanisms (these are design heuristics informed by HCI and
behavioural-decision research, not claims of clinical efficacy):

- **Anchoring on a single score** → factor breakdown, contribution columns, radar
  comparison with the universe median.
- **Overconfidence / illusion of validity** → weight-sensitivity table, band
  boundary note ("a one-point change can move the band"), assumption-sensitivity
  table, explicit caveats.
- **Confirmation bias** → per-factor disconfirming questions, weakest-factor
  highlighting, counter-evidence memo.
- **Framing / loss aversion** → neutral status vocabulary, tone colours that are
  *not* red/green, loss shown as a frequency among simulated paths rather than a
  flashing alarm.
- **Availability / recency** → momentum is labelled as sentiment, not a
  fundamental fact, and given only 10% default weight; a research as-of date is
  a first-class field.
- **Automation bias** → the tool never fetches data, never fills a cell, and
  repeats "these are your inputs" in three views. Export keeps the provenance
  note with the numbers.
- **Default effects** → weights and presets are editable, visible and reversible;
  switching a dataset or resetting weights requires explicit confirmation.

---

## 2. Foundations

### Colour

Two complete token sets (`dark` default, `light` one-click toggle) live in
`static/css/styles.css` as CSS custom properties. Dark is the deliberate
default — it carries the aurora identity — and a saved light choice is honoured.
Dark uses a deep indigo base
(`#090e1b`) with mint (`#6ee7c0`), periwinkle (`#98a0ff`) and amber (`#ffc978`)
accents. Light uses `#f2f5fb` surfaces with darker equivalents of the same
hues to preserve contrast.

Statuses use **five semantic tones** (`focus`, `positive`, `caution`,
`neutral`, `muted`) rather than traffic-light semantics. Each status chip
combines text + a dot shape + a tone + (for incomplete) a dashed border, so
meaning never depends on colour alone.

All tints are derived with `color-mix(in srgb, …)`, which keeps light/dark
consistency from a single token and avoids a palette that drifts between themes.

A second, independent set of six **factor identity colours** (`--f-competition`
through `--f-risk`) is used for table headers, slider tracks, weight bars,
radar dots, ranked-row sparklines and the legend. These are deliberately *not*
performance colours: they never mean "good" or "bad", so they cannot be misread
as buy/sell signals. The light theme darkens the same hues to keep contrast.

### Typography

- **Vazirmatn Variable** (100–900) is bundled locally for Persian and Arabic
  script ranges; **Plus Jakarta Sans Variable** (200–800) handles Latin. Both
  are SIL OFL; licence texts ship in `static/fonts/`. `html[lang="fa"]` swaps the
  stack so Persian is never rendered with a Latin-first fallback.
- Persian headings use `letter-spacing: 0` — negative tracking breaks cursive
  joins — while Latin headings use tight tracking. Display weights are 700–800.
- Tabular numerals (`font-variant-numeric: tabular-nums`) and a monospace stack
  for every score, weight and currency value, so columns align and digits are
  distinguishable.
- Type scale is clamp-based: headings scale with viewport width; body text stays
  14–15px with 1.5–1.6 line height.
- Numeric content is forced `dir="ltr"` even in RTL, while prose follows the
  document direction.

### Space, shape, depth

- 4px base spacing scale (`--s1` … `--s9`: 4 → 56px).
- Radii: 10 / 14 / 20 / 28px; cards use 20px, controls 10–12px, chips pill.
- Elevation: a soft `--shadow-sm` for cards and a larger `--shadow` for
  drawers/dialogs. Borders are 1px translucent strokes rather than heavy
  shadows — the interface reads as an instrument panel, not a stack of paper.
- Motion: 220ms with an ease-out curve; only transform/opacity animations.
  `prefers-reduced-motion` disables all of them.

### Illustration

The hero uses a generated abstract glass-ribbon artwork (no text, no logo), a
low-opacity girih geometric pattern, and a floating "factor signature" card
whose six bars use the real applied weights. It is a structural metaphor for a
weighted system: no stock photography, no generic fintech people, no decorative
candlestick charts that imply real market data. The artwork is mirrored in RTL
so the quiet negative space always sits behind the copy.

---

## 3. Components

`card`, `kpi`, `chip` / `status-chip`, `btn` (primary / soft / ghost / tiny /
danger), `field` + `control`, `search-field`, `data-table` (desktop) →
`card rows` (mobile), `weight-slider`, `rank-row`, `band-row`, `mover-row`,
`inline-notice`, `drawer`, `dialog`, `toast`, `formula-box`, `code-block`.

Charts are hand-built inline SVG (`static/js/charts.js`): horizontal bars,
histogram with percentile markers, completion donut and a six-axis radar. They
use CSS classes for fill/stroke so theme switching requires no re-colouring,
and each chart is accompanied by a visually hidden data table for assistive
technology.

---

## 4. Layout & responsiveness

| Breakpoint | Behaviour |
| --- | --- |
| ≥ 1281px | Fixed 268px sidebar + fluid workspace, 4-column KPI grid, 2-column card grids. |
| ≤ 1280px | KPIs become 2×2; multi-column grids collapse to one column. |
| ≤ 1080px | Hero illustration hides; weight sliders go 2-column; ranked rows tighten. |
| ≤ 900px | Sidebar becomes an off-canvas drawer with a scrim and a hamburger button; compact topbar. |
| ≤ 760px | Score table transforms into stacked cards with `data-label` pseudo-labels; ranked rows reflow into a 3-column grid; drawer becomes full-width. |
| ≤ 480px | Single-column KPIs, vertical card heads, full-width search and filters, smaller padding. |

All positioning uses **CSS logical properties** (`margin-inline`,
`padding-inline`, `inset-inline-start`, `border-inline-start`, `text-align:
start`). The sidebar, drawer and directional icons have explicit RTL rules,
so the Persian layout is a true mirror rather than a stretched LTR layout.

Charts are RTL-aware: label columns, bar origins, text anchoring, radar labels
and tick positions are computed from `document.documentElement.dir`.

---

## 5. Accessibility checklist

Targeting WCAG 2.2 AA-oriented practice:

- Semantic landmarks (`header`, `nav`, `main`, `footer`, `aside`), one `h1`
  per view, ordered headings, labelled form controls and table headers.
- Visible `:focus-visible` outline on every interactive element; skip link;
  focus trap and focus restoration in the detail drawer; `<dialog>` for
  confirmations.
- Live regions for results, health status and toasts (`aria-live="polite"`).
- Text alternatives for charts: `role="img"` + `aria-label`, `<title>` on data
  elements, and hidden data tables.
- Minimum 40px touch targets; no hover-only interactions; no colour-only
  encoding; no text baked into images.
- Both themes maintain high contrast for body and secondary text; status tones
  are paired with text.
- `prefers-reduced-motion` and `forced-colors` fallbacks included.
- Inputs accept keyboard navigation (Tab / Shift+Tab, Arrow Up/Down and Enter
  move between score cells).

---

## 6. Ethical guardrails encoded in the product

1. **No fabricated market data.** The bundled demo uses `DEMO-xx` rows and is
   labelled synthetic in the dataset description, in a persistent warning and
   in the docs. The blank Iranian list contains real symbols but no scores.
2. **No imputation.** Missing evidence is never guessed, averaged or zeroed.
3. **No recommendations.** No buy/sell/hold language, no target price, no
   signal generation, no alerting.
4. **No false probability.** The Monte Carlo engine is described as an
   assumption engine; its caveats are shown next to the chart, and the tail
   exclusions are quantified.
5. **No lock-in.** All inputs and results export to plain UTF-8 CSV; nothing is
   stored server-side; no account is required.
6. **No dark patterns.** Destructive actions ask for confirmation, toasts are
   brief, there are no streaks, no urgency cues, no hidden defaults.

---

## 7. Deliberately avoided

- CDN-hosted frameworks, fonts or chart libraries (offline-friendly, auditable,
  no third-party requests).
- Candlestick/price charts that would imply live data.
- Green/red performance colouring, confetti, gamified progress or "AI score"
  language.
- Client/server duplication of the scoring maths: the browser calls the Python
  function via `/api/score` so there is exactly one implementation.
- Auto-saving to a server or syncing without consent.

---

## 8. Verification

`pytest -q` covers the API, validation, import/export and CLI. `npm run smoke`
(with `jsdom`) executes the real frontend modules against the live API and
checks the Persian/RTL default, the language switch, the illustrated hero and
workflow, factor palette, sparklines, band spectrum, rendering, navigation,
charts, the detail drawer, scenario lab, theme switching and live cell editing.
Manual checks for the interface: light/dark theme switching, 360px / 768px / 1440px widths,
keyboard-only navigation, score-cell validation, CSV round-trip, drawer focus
management and reduced-motion mode. The v1.2 revision was additionally verified
with real headless-Chromium screenshots at 1440px and 390px in both themes and
both languages — including the illustrated hero, RTL chart labels, band ranges
and the factor-coloured radar drawer. `docs/preview.png` is one of those
captures.
