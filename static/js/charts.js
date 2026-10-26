/* Dependency-free SVG charts.
   Everything is inline SVG with CSS classes, so light/dark themes and RTL are
   handled by the stylesheet rather than by hard-coded colours or coordinates. */

const W = 680;

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
export function horizontalBars(host, items, { max = 100, caption = "", labelHeader = "Ticker", valueHeader = "Score" } = {}) {
  if (!items.length) { chartEmpty(host, caption); return; }
  const rtl = isRtl();
  const rowH = 40, top = 26, height = top + items.length * rowH + 12;
  const labelW = 168, valueW = 54, gap = 12;
  const areaX = rtl ? valueW + gap : labelW + gap;
  const areaW = W - labelW - valueW - gap * 2;
  const grid = [0, 25, 50, 75, 100];

  let svg = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(caption)}" preserveAspectRatio="xMinYMin meet">`;
  grid.forEach((tick) => {
    const x = areaX + (areaW * tick) / max;
    svg += `<line class="chart-grid" x1="${x.toFixed(1)}" y1="${top - 8}" x2="${x.toFixed(1)}" y2="${height - 10}" />`;
    svg += `<text class="chart-tick" x="${x.toFixed(1)}" y="${top - 13}" text-anchor="middle">${tick}</text>`;
  });
  items.forEach((item, i) => {
    const y = top + i * rowH;
    const barW = Math.max(2, (Math.min(Number(item.value) || 0, max) / max) * areaW);
    const x = rtl ? areaX + areaW - barW : areaX;
    const labelX = rtl ? W - 2 : 2;
    const anchor = rtl ? "end" : "start";
    const valueX = rtl ? 2 : W - 2;
    const valueAnchor = rtl ? "start" : "end";
    const barClass = item.accent ? "chart-bar-accent" : "chart-bar";
    svg += `<g><title>${esc(item.label)}: ${esc(num(item.value, 2))}</title>`;
    svg += `<text class="chart-label" x="${labelX}" y="${y + 19}" text-anchor="${anchor}" direction="${document.documentElement.dir}">${esc(truncate(item.label))}</text>`;
    svg += `<rect class="chart-bar-ghost" x="${areaX}" y="${y + 7}" width="${areaW}" height="15" rx="7.5" />`;
    svg += `<rect class="${barClass}" x="${x.toFixed(1)}" y="${y + 7}" width="${barW.toFixed(1)}" height="15" rx="7.5" />`;
    svg += `<text class="chart-value" x="${valueX}" y="${y + 19}" text-anchor="${valueAnchor}">${esc(num(item.value, 2))}</text></g>`;
  });
  svg += "</svg>";
  host.innerHTML = svg + accessibleTable(caption, [labelHeader, valueHeader],
    items.map((item) => [item.label, num(item.value, 2)]));
}

/** Histogram with optional percentile markers. */
export function histogram(host, bins, {
  markers = [], formatX = (v) => num(v, 0), caption = "", valueHeader = "Count",
  accent = false, formatValue = (v) => num(v, 0),
} = {}) {
  if (!bins || !bins.length) { chartEmpty(host, caption); return; }
  const height = 300, padTop = 42, padBottom = 36, padLeft = 46, padRight = 14;
  const plotW = W - padLeft - padRight, plotH = height - padTop - padBottom;
  const low = bins[0].x0 ?? bins[0].from;
  const high = bins[bins.length - 1].x1 ?? bins[bins.length - 1].to;
  const span = high - low || 1;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const xOf = (value) => padLeft + ((value - low) / span) * plotW;
  const barW = plotW / bins.length;
  const barClass = accent ? "chart-bar-accent" : "chart-bar";

  let svg = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(caption)}" preserveAspectRatio="xMinYMin meet">`;
  for (let i = 0; i <= 4; i++) {
    const y = padTop + (plotH * i) / 4;
    const value = maxCount - (maxCount * i) / 4;
    svg += `<line class="chart-grid" x1="${padLeft}" y1="${y.toFixed(1)}" x2="${W - padRight}" y2="${y.toFixed(1)}" />`;
    svg += `<text class="chart-tick" x="${padLeft - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(num(value))}</text>`;
  }
  bins.forEach((bin) => {
    const x0 = bin.x0 ?? bin.from, x1 = bin.x1 ?? bin.to;
    const barH = (bin.count / maxCount) * plotH;
    svg += `<rect class="${barClass}" x="${(xOf(x0) + 0.7).toFixed(1)}" y="${(padTop + plotH - barH).toFixed(1)}" width="${Math.max(1, barW - 1.4).toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" rx="2"><title>${esc(formatX(x0))} – ${esc(formatX(x1))}: ${bin.count}</title></rect>`;
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
    svg += `<line class="chart-marker ${colorClass}" x1="${x.toFixed(1)}" y1="${padTop - 6}" x2="${x.toFixed(1)}" y2="${padTop + plotH}" />`;
    const label = `${marker.label}: ${formatValue(marker.value)}`;
    const labelW = label.length * 5.6 + 12;
    const labelX = Math.min(W - labelW - 2, Math.max(2, x - labelW / 2));
    svg += `<rect x="${labelX.toFixed(1)}" y="${index % 2 === 0 ? 2 : 20}" width="${labelW.toFixed(1)}" height="15" rx="7.5" fill="var(--surface-3)" opacity=".95" />`;
    svg += `<text class="chart-marker-label ${colorClass}" x="${(labelX + labelW / 2).toFixed(1)}" y="${index % 2 === 0 ? 13 : 31}" text-anchor="middle" fill="${markerColor}">${esc(label)}</text>`;
  });
  svg += "</svg>";
  host.innerHTML = svg + accessibleTable(caption, [caption, valueHeader],
    bins.map((bin) => [`${formatX(bin.x0 ?? bin.from)} – ${formatX(bin.x1 ?? bin.to)}`, bin.count]));
}

/** Completion ring. */
export function donut(host, complete, total, { label = "", sub = "" } = {}) {
  const size = 148, r = 58, c = 2 * Math.PI * r;
  const fraction = total > 0 ? complete / total : 0;
  const pct = Math.round(fraction * 100);
  host.innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}: ${pct}%">
    <circle class="donut-track" cx="74" cy="74" r="${r}" />
    <circle class="donut-arc" cx="74" cy="74" r="${r}" stroke-dasharray="${(c * fraction).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 74 74)" />
    <text class="donut-label-1" x="74" y="72" text-anchor="middle" direction="ltr">${pct}%</text>
    <text class="donut-label-2" x="74" y="92" text-anchor="middle">${esc(sub)}</text>
  </svg>`;
}

/** Six-axis radar: selected row vs universe median. */
export function radar(host, labels, values, compare, { caption = "" } = {}) {
  const size = 340, cx = 170, cy = 158, radius = 104;
  const count = labels.length;
  const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / count;
  const point = (i, value) => {
    const ratio = Math.max(0, Math.min(100, Number(value) || 0)) / 100;
    return [cx + Math.cos(angle(i)) * radius * ratio, cy + Math.sin(angle(i)) * radius * ratio];
  };
  const polygon = (arr) => arr.map((value, i) => point(i, value).map((n) => n.toFixed(1)).join(",")).join(" ");
  const dir = document.documentElement.dir;

  let svg = `<svg viewBox="0 0 ${size} 300" role="img" aria-label="${esc(caption)}" preserveAspectRatio="xMidYMid meet">`;
  [20, 40, 60, 80, 100].forEach((level) => {
    svg += `<polygon class="radar-grid" points="${polygon(new Array(count).fill(level))}" />`;
  });
  for (let i = 0; i < count; i++) {
    const [x, y] = point(i, 100);
    svg += `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`;
    const lx = cx + Math.cos(angle(i)) * (radius + 24);
    const ly = cy + Math.sin(angle(i)) * (radius + 22);
    const cos = Math.cos(angle(i));
    const anchor = Math.abs(cos) < 0.2 ? "middle" : (cos > 0 ? "start" : "end");
    svg += `<text class="radar-label" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}" direction="${dir}">${esc(labels[i])}</text>`;
  }
  svg += `<text class="radar-tick" x="${cx + 4}" y="${(cy - radius + 2).toFixed(1)}">100</text>`;
  if (compare && compare.some((v) => v !== null && v !== undefined)) {
    svg += `<polygon class="radar-poly-compare" points="${polygon(compare.map((v) => v ?? 0))}" />`;
  }
  svg += `<polygon class="radar-poly" points="${polygon(values.map((v) => v ?? 0))}" />`;
  values.forEach((value, i) => {
    if (value === null || value === undefined) return;
    const [x, y] = point(i, value);
    svg += `<circle class="radar-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2"><title>${esc(labels[i])}: ${esc(num(value, 1))}</title></circle>`;
  });
  svg += "</svg>";
  host.innerHTML = svg + accessibleTable(caption, ["Factor", "This row", "Median"],
    labels.map((label, i) => [label, values[i] ?? "—", compare?.[i] ?? "—"]));
}
