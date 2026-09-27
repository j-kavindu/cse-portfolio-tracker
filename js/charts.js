/*
 * charts.js — small, dependency-free SVG chart renderers.
 * Each function returns an SVG string sized to a viewBox and is injected
 * into a container via innerHTML. No external chart library is used, so
 * the app has zero third-party runtime dependencies (per the brief's
 * "avoid unnecessary frameworks" guidance).
 */
(function (global) {
  "use strict";

  const PALETTE = ["#2f6f4f", "#1f5c8a", "#b5772f", "#7a4fa0", "#3d7a7a", "#a03d3d", "#5a6b3d", "#3d5a99", "#8a5a3d", "#4f7a9e"];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtShort(n) {
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(0) + "K";
    return n.toFixed(0);
  }

  function emptyState(width, height, message) {
    return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="${esc(message)}">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty-text">${esc(message)}</text>
    </svg>`;
  }

  /** points: [{label, value}] sorted by natural order (e.g. date) */
  function lineChart(points, opts) {
    opts = opts || {};
    const width = opts.width || 600;
    const height = opts.height || 260;
    const padL = 56;
    const padR = 16;
    const padT = 16;
    const padB = 32;
    if (!points || points.length === 0) return emptyState(width, height, "No portfolio history logged yet");
    if (points.length === 1) {
      points = [{ label: "", value: 0 }, points[0]];
    }

    const values = points.map((p) => p.value);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const x = (i) => padL + (i / (points.length - 1)) * plotW;
    const y = (v) => padT + plotH - ((v - min) / range) * plotH;

    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => {
        const gy = padT + plotH * f;
        const val = max - f * range;
        return `<line x1="${padL}" y1="${gy}" x2="${width - padR}" y2="${gy}" class="chart-gridline" />
        <text x="${padL - 8}" y="${gy + 4}" text-anchor="end" class="chart-axis-label">${fmtShort(val)}</text>`;
      })
      .join("");

    const labelEvery = Math.max(1, Math.ceil(points.length / 6));
    const xLabels = points
      .map((p, i) => (i % labelEvery === 0 || i === points.length - 1 ? `<text x="${x(i).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-axis-label">${esc(p.label)}</text>` : ""))
      .join("");

    const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" class="chart-dot" />`).join("");

    return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Portfolio value over time">
      ${gridLines}
      <path d="${areaPath}" class="chart-area" />
      <path d="${linePath}" class="chart-line" />
      ${dots}
      ${xLabels}
    </svg>`;
  }

  /** slices: [{label, value}] */
  function donutChart(slices, opts) {
    opts = opts || {};
    const size = opts.size || 240;
    const total = slices.reduce((s, d) => s + d.value, 0);
    if (!slices.length || total <= 0) return emptyState(size, size, "No holdings to allocate yet");

    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size / 2 - 8;
    const rInner = rOuter * 0.6;
    let angle = -Math.PI / 2;

    const paths = slices
      .map((s, i) => {
        const frac = s.value / total;
        const start = angle;
        const end = angle + frac * Math.PI * 2;
        angle = end;
        const largeArc = end - start > Math.PI ? 1 : 0;
        const x0 = cx + rOuter * Math.cos(start);
        const y0 = cy + rOuter * Math.sin(start);
        const x1 = cx + rOuter * Math.cos(end);
        const y1 = cy + rOuter * Math.sin(end);
        const xi0 = cx + rInner * Math.cos(end);
        const yi0 = cy + rInner * Math.sin(end);
        const xi1 = cx + rInner * Math.cos(start);
        const yi1 = cy + rInner * Math.sin(start);
        const d = `M${x0.toFixed(2)},${y0.toFixed(2)} A${rOuter},${rOuter} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${xi0.toFixed(2)},${yi0.toFixed(2)} A${rInner},${rInner} 0 ${largeArc} 0 ${xi1.toFixed(2)},${yi1.toFixed(2)} Z`;
        return `<path d="${d}" fill="${PALETTE[i % PALETTE.length]}"><title>${esc(s.label)}: ${fmtShort(s.value)}</title></path>`;
      })
      .join("");

    return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg" role="img" aria-label="Sector allocation">${paths}</svg>`;
  }

  function donutLegend(slices) {
    const total = slices.reduce((s, d) => s + d.value, 0) || 1;
    return slices
      .map(
        (s, i) =>
          `<div class="legend-row"><span class="legend-swatch" style="background:${PALETTE[i % PALETTE.length]}"></span>
        <span class="legend-label">${esc(s.label)}</span>
        <span class="legend-value">${((s.value / total) * 100).toFixed(1)}%</span></div>`
      )
      .join("");
  }

  /** bars: [{label, value, tone?}] tone: 'positive'|'negative'|'neutral' */
  function barChart(bars, opts) {
    opts = opts || {};
    const width = opts.width || 420;
    const height = opts.height || 220;
    const padL = 64;
    const padR = 16;
    const padT = 16;
    const padB = 32;
    if (!bars || !bars.length) return emptyState(width, height, "No data yet");

    const values = bars.map((b) => b.value);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const zeroY = padT + plotH - ((0 - min) / range) * plotH;
    const bw = plotW / bars.length;

    const bars_svg = bars
      .map((b, i) => {
        const bx = padL + i * bw + bw * 0.18;
        const bwInner = bw * 0.64;
        const by = padT + plotH - ((b.value - min) / range) * plotH;
        const top = Math.min(by, zeroY);
        const h = Math.abs(by - zeroY);
        const tone = b.tone || (b.value >= 0 ? "positive" : "negative");
        return `<rect x="${bx.toFixed(1)}" y="${top.toFixed(1)}" width="${bwInner.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" class="chart-bar chart-bar-${tone}" />
        <text x="${(bx + bwInner / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-axis-label">${esc(b.label)}</text>`;
      })
      .join("");

    const gridLines = [0, 0.5, 1]
      .map((f) => {
        const gy = padT + plotH * f;
        const val = max - f * range;
        return `<line x1="${padL}" y1="${gy}" x2="${width - padR}" y2="${gy}" class="chart-gridline" />
        <text x="${padL - 8}" y="${gy + 4}" text-anchor="end" class="chart-axis-label">${fmtShort(val)}</text>`;
      })
      .join("");

    return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Bar chart">
      ${gridLines}<line x1="${padL}" y1="${zeroY}" x2="${width - padR}" y2="${zeroY}" class="chart-zeroline" />
      ${bars_svg}
    </svg>`;
  }

  global.Charts = { lineChart, donutChart, donutLegend, barChart };
})(window);
