/* Dependency-free SVG charts.
   Everything is inline SVG with CSS variables/classes, so light/dark themes and
   RTL are handled by the stylesheet rather than by hard-coded colours. Each
   chart also emits a visually hidden data table for assistive technology. */

const W = 680;
let gradientSeq = 0;

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function num(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

export function compact(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
    .format(Number(value));
}

function truncate(text, max = 20) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function isRtl() { return document.documentElement.dir === "rtl"; }

/** Gradient definitions with CSS-variable stops, so themes recolour automatically. */
function defs(prefix) {
  const id = `${prefix}-${++gradientSeq}`;
  const bar = `${id}-bar`, area = `${id}-area`, donut = `${id}-donut`, radar = `${id}-radar`;
  return {
    ids: { bar, area, donut, radar },
    markup: `<defs>
      <linearGradient id="${bar}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style="stop-color:var(--accent-2)" stop-opacity=".85"/>
        <stop offset="1" style="stop-color:var(--accent)" stop-opacity=".85"/>
      </linearGradient>
      <linearGradient id="${area}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--accent-2)" stop-opacity=".34"/>
        <stop offset="1" style="stop-color:var(--accent-2)" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${donut}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--accent)"/>
        <stop offset="1" style="stop-color:var(--accent-2)"/>
      </linearGradient>
      <radialGradient id="${radar}" cx="50%" cy="40%" r="70%">
        <stop offset="0" style="stop-color:var(--accent-2)" stop-opacity=".42"/>
        <stop offset="1" style="stop-color:var(--accent-2)" stop-opacity=".12"/>
      </radialGradient>
    </defs>`,
  };
}

function accessibleTable(caption, headers, rows) {
  return `<table class="sr-only"><caption>${esc(caption)}</caption><thead><tr>${
    headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")
  }</tr></thead><tbody>${
    rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")
  }</tbody></table>`;
}

export function chartEmpty(host, message) {
  host.innerHTML = `<div class="chart-empty">${esc(message)}</div>`;
}

/** Horizontal bar chart for the top ranked rows. */
export function horizontalBars(host, items, {
  max = 100, caption = "", labelHeader = "Ticker", valueHeader = "Score", barColors = [],
} = {}) {
  if (!items.length) { chartEmpty(host, caption); return; }
  const rtl = isRtl();
  const g = defs("bars");
  const rowH = 42, top = 30, height = top + items.length * rowH + 14;
  const labelW = 168, valueW = 54, gap = 12;
  const areaX = rtl ? valueW + gap : labelW + gap;
  const areaW = W - labelW - valueW - gap * 2;
  const grid = [0, 25, 50, 75, 100];

  let svg = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(caption)}" preserveAspectRatio="xMinYMin meet">${g.markup}`;
  grid.forEach((tick) => {
    const x = areaX + (areaW * tick) / max;
    svg += `<line class="chart-grid" x1="${x.toFixed(1)}" y1="${top - 8}" x2="${x.toFixed(1)}" y2="${height - 10}" />`;
    svg += `<text class="chart-tick" x="${x.toFixed(1)}" y="${top - 13}" text-anchor="middle">${tick}</text>`;
  });
  items.forEach((item, i) => {
    const y = top + i * rowH;
    const barW = Math.max(3, (Math.min(Number(item.value) || 0, max) / max) * areaW);
    const x = rtl ? areaX + areaW - barW : areaX;
    // Bidi-safe placement: the label column sits at the inline start of the
    // chart, but a Latin ticker inside an RTL chart must still read LTR and be
    // anchored by its right edge (otherwise it is clipped off the viewBox).
    const labelRtl = /[\u0590-\u08FF]/.test(String(item.label));
    const labelDir = labelRtl ? "rtl" : "ltr";
    const labelX = rtl ? W - 2 : (labelRtl ? labelW - 6 : 2);
    const anchor = rtl ? (labelRtl ? "start" : "end") : "start";
    const valueX = rtl ? 2 : W - 2;
    const valueAnchor = rtl ? "start" : "end";
    const color = barColors[i];
    const barClass = `chart-bar ${color ? "chart-bar-solid" : "chart-bar-gradient"} chart-bar-grow`;
    // Inline style is required: a stylesheet `fill` would beat an SVG fill attribute.
    const fillStyle = color
      ? `fill:${color};fill-opacity:.62;stroke:${color};`
      : `fill:url(#${g.ids.bar});`;
    const barStyle = `animation-delay:${i * 55}ms;${fillStyle}`;
    svg += `<g><title>${esc(item.label)}: ${esc(num(item.value, 2))}</title>`;
    svg += `<text class="chart-label" x="${labelX}" y="${y + 20}" text-anchor="${anchor}" direction="${labelDir}" unicode-bidi="isolate">${esc(truncate(item.label))}</text>`;
    svg += `<rect class="chart-bar-ghost" x="${areaX}" y="${y + 8}" width="${areaW}" height="16" rx="8" />`;
    svg += `<rect class="${barClass}" x="${x.toFixed(1)}" y="${y + 8}" width="${barW.toFixed(1)}" height="16" rx="8" style="${barStyle}" />`;
    svg += `<text class="chart-value" x="${valueX}" y="${y + 21}" text-anchor="${valueAnchor}" direction="ltr" unicode-bidi="isolate">${esc(num(item.value, 2))}</text></g>`;
  });
  svg += "</svg>";
  host.innerHTML = svg + accessibleTable(caption, [labelHeader, valueHeader],
    items.map((item) => [item.label, num(item.value, 2)]));
}

/** Histogram with an area fill and optional percentile markers. */
export function histogram(host, bins, {
  markers = [], formatX = (v) => num(v, 0), caption = "", valueHeader = "Count",
  accent = false, formatValue = (v) => num(v, 0),
} = {}) {
  if (!bins || !bins.length) { chartEmpty(host, caption); return; }
  const g = defs("hist");
  const height = 310, padTop = 46, padBottom = 38, padLeft = 48, padRight = 14;
  const plotW = W - padLeft - padRight, plotH = height - padTop - padBottom;
  const low = bins[0].x0 ?? bins[0].from;
  const high = bins[bins.length - 1].x1 ?? bins[bins.length - 1].to;
  const span = high - low || 1;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const xOf = (value) => padLeft + ((value - low) / span) * plotW;
  const barW = plotW / bins.length;
  const barFill = accent ? `url(#${g.ids.bar})` : `url(#${g.ids.bar})`;

  let svg = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(caption)}" preserveAspectRatio="xMinYMin meet">${g.markup}`;
  for (let i = 0; i <= 4; i++) {
    const y = padTop + (plotH * i) / 4;
    const value = maxCount - (maxCount * i) / 4;
    svg += `<line class="chart-grid" x1="${padLeft}" y1="${y.toFixed(1)}" x2="${W - padRight}" y2="${y.toFixed(1)}" />`;
    svg += `<text class="chart-tick" x="${padLeft - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(num(value))}</text>`;
  }

  // Smooth area under the bin tops: gives the distribution a readable silhouette.
  const tops = bins.map((bin, i) => {
    const x0 = bin.x0 ?? bin.from, x1 = bin.x1 ?? bin.to;
    const barH = (bin.count / maxCount) * plotH;
    return [xOf(x0) + barW / 2, padTop + plotH - barH];
  });
  const firstX = xOf(bins[0].x0 ?? bins[0].from);
  const lastX = xOf(bins[bins.length - 1].x1 ?? bins[bins.length - 1].to);
  svg += `<path class="chart-area" d="M${firstX.toFixed(1)},${padTop + plotH} L${tops.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} L${lastX.toFixed(1)},${padTop + plotH} Z" style="fill:url(#${g.ids.area})"/>`;

  bins.forEach((bin, i) => {
    const x0 = bin.x0 ?? bin.from, x1 = bin.x1 ?? bin.to;
    const barH = (bin.count / maxCount) * plotH;
    svg += `<rect class="chart-bar chart-bar-gradient chart-bar-grow-vertical ${accent ? "chart-bar-accent" : ""}" x="${(xOf(x0) + 0.7).toFixed(1)}" y="${(padTop + plotH - barH).toFixed(1)}" width="${Math.max(1, barW - 1.4).toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" rx="2" style="fill:${barFill};animation-delay:${Math.min(i * 12, 320)}ms"><title>${esc(formatX(x0))} – ${esc(formatX(x1))}: ${bin.count}</title></rect>`;
  });
  for (let i = 0; i <= 4; i++) {
    const value = low + (span * i) / 4;
    svg += `<text class="chart-tick" x="${xOf(value).toFixed(1)}" y="${height - 14}" text-anchor="middle">${esc(formatX(value))}</text>`;
  }
  svg += `<line class="chart-axis" x1="${padLeft}" y1="${padTop + plotH}" x2="${W - padRight}" y2="${padTop + plotH}" />`;

  markers.forEach((marker, index) => {
    if (marker.value === null || marker.value === undefined) return;
    const rawX = xOf(marker.value);
    const x = Math.min(W - padRight - 1, Math.max(padLeft + 1, rawX));
    const colorClass = `chart-marker-${marker.key || "median"}`;
    const markerColors = { p05: "var(--tone-caution)", median: "var(--accent)", p95: "var(--accent-2)" };
    const markerColor = markerColors[marker.key] || "var(--text-2)";
    svg += `<line class="chart-marker ${colorClass}" x1="${x.toFixed(1)}" y1="${padTop - 8}" x2="${x.toFixed(1)}" y2="${padTop + plotH}" />`;
    const label = `${marker.label}: ${formatValue(marker.value)}`;
    const labelW = label.length * 5.6 + 14;
    const labelX = Math.min(W - labelW - 2, Math.max(2, x - labelW / 2));
    svg += `<rect x="${labelX.toFixed(1)}" y="${index % 2 === 0 ? 2 : 22}" width="${labelW.toFixed(1)}" height="16" rx="8" fill="var(--surface-3)" opacity=".95" />`;
    svg += `<text class="chart-marker-label ${colorClass}" x="${(labelX + labelW / 2).toFixed(1)}" y="${index % 2 === 0 ? 14 : 34}" text-anchor="middle" fill="${markerColor}">${esc(label)}</text>`;
  });
  svg += "</svg>";
  host.innerHTML = svg + accessibleTable(caption, [caption, valueHeader],
    bins.map((bin) => [`${formatX(bin.x0 ?? bin.from)} – ${formatX(bin.x1 ?? bin.to)}`, bin.count]));
}

/** Completion ring with a gradient arc and soft glow. */
export function donut(host, complete, total, { label = "", sub = "" } = {}) {
  const g = defs("donut");
  const size = 148, r = 58, c = 2 * Math.PI * r;
  const fraction = total > 0 ? complete / total : 0;
  const pct = Math.round(fraction * 100);
  host.innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}: ${pct}%">${g.markup}
    <circle class="donut-halo" cx="74" cy="74" r="${r}" />
    <circle class="donut-track" cx="74" cy="74" r="${r}" />
    <circle class="donut-arc" cx="74" cy="74" r="${r}" style="stroke:url(#${g.ids.donut})" stroke-dasharray="${(c * fraction).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 74 74)" />
    <text class="donut-label-1" x="74" y="72" text-anchor="middle" direction="ltr">${pct}%</text>
    <text class="donut-label-2" x="74" y="92" text-anchor="middle">${esc(sub)}</text>
  </svg>`;
}

/** Six-axis radar: selected row vs universe median, with per-factor dot colours. */
export function radar(host, labels, values, compare, { caption = "", colors = [] } = {}) {
  const g = defs("radar");
  const size = 340, cx = 170, cy = 158, radius = 104;
  const count = labels.length;
  const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / count;
  const point = (i, value) => {
    const ratio = Math.max(0, Math.min(100, Number(value) || 0)) / 100;
    return [cx + Math.cos(angle(i)) * radius * ratio, cy + Math.sin(angle(i)) * radius * ratio];
  };
  const polygon = (arr) => arr.map((value, i) => point(i, value).map((n) => n.toFixed(1)).join(",")).join(" ");
  const dir = document.documentElement.dir;

  let svg = `<svg viewBox="0 0 ${size} 300" role="img" aria-label="${esc(caption)}" preserveAspectRatio="xMidYMid meet">${g.markup}`;
  [20, 40, 60, 80, 100].forEach((level, index) => {
    svg += `<polygon class="radar-grid" data-ring="${index}" points="${polygon(new Array(count).fill(level))}" />`;
  });
  for (let i = 0; i < count; i++) {
    const [x, y] = point(i, 100);
    svg += `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`;
    const lx = cx + Math.cos(angle(i)) * (radius + 25);
    const ly = cy + Math.sin(angle(i)) * (radius + 23);
    const cos = Math.cos(angle(i));
    const anchor = Math.abs(cos) < 0.2 ? "middle" : (cos > 0 ? "start" : "end");
    svg += `<text class="radar-label" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}" direction="${dir}">${esc(labels[i])}</text>`;
  }
  svg += `<text class="radar-tick" x="${cx + 4}" y="${(cy - radius + 2).toFixed(1)}">100</text>`;
  if (compare && compare.some((v) => v !== null && v !== undefined)) {
    svg += `<polygon class="radar-poly-compare" points="${polygon(compare.map((v) => v ?? 0))}" />`;
  }
  svg += `<polygon class="radar-poly" points="${polygon(values.map((v) => v ?? 0))}" style="fill:url(#${g.ids.radar})" />`;
  values.forEach((value, i) => {
    if (value === null || value === undefined) return;
    const [x, y] = point(i, value);
    const color = colors[i] || "var(--accent-2)";
    svg += `<circle class="radar-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" style="fill:${color}"><title>${esc(labels[i])}: ${esc(num(value, 1))}</title></circle>`;
  });
  svg += "</svg>";
  host.innerHTML = svg + accessibleTable(caption, ["Factor", "This row", "Median"],
    labels.map((label, i) => [label, values[i] ?? "—", compare?.[i] ?? "—"]));
}
