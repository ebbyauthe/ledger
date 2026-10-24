// Hand-rolled inline SVG line chart — no charting library (the app has zero frontend
// dependencies by design, and the default Helmet CSP would block a CDN script anyway).
// Single series only: a cumulative day-by-day progression through a calendar month.

const WIDTH = 520, HEIGHT = 170;
const PAD_L = 42, PAD_R = 10, PAD_T = 10, PAD_B = 10;
const PLOT_W = WIDTH - PAD_L - PAD_R;
const PLOT_H = HEIGHT - PAD_T - PAD_B;

// points: [{ x: dayOfMonth, y: cumulativeValue, hasEntry: bool }], already truncated to
// "today" by the caller for the current month. daysInMonth scales the x-axis so the chart
// always spans the whole month's width even when points stop partway through it.
export function renderProgressionChart(container, { points, daysInMonth, colorVar, formatValue, emptyLabel }){
  if(!points || !points.length){
    container.innerHTML = `<div class="chart-empty">${emptyLabel || 'No data yet'}</div>`;
    return;
  }

  const maxY = Math.max(1, ...points.map(p => p.y));
  const xScale = day => PAD_L + ((day - 1) / Math.max(1, daysInMonth - 1)) * PLOT_W;
  const yScale = val => PAD_T + PLOT_H - (val / maxY) * PLOT_H;

  const linePoints = points.map(p => `${xScale(p.x).toFixed(1)},${yScale(p.y).toFixed(1)}`).join(' L ');
  const pathD = `M ${linePoints}`;
  const firstX = xScale(points[0].x).toFixed(1);
  const lastX = xScale(points[points.length - 1].x).toFixed(1);
  const baseY = yScale(0).toFixed(1);
  const areaD = `M ${firstX},${baseY} L ${linePoints} L ${lastX},${baseY} Z`;

  const gridVals = [0, maxY / 2, maxY];
  const gridMarkup = gridVals.map(v => {
    const y = yScale(v).toFixed(1);
    return `<line x1="${PAD_L}" x2="${WIDTH - PAD_R}" y1="${y}" y2="${y}" style="stroke:var(--line);stroke-width:1" />
      <text x="${PAD_L - 6}" y="${(Number(y) + 3).toFixed(1)}" text-anchor="end" style="font-size:9px;fill:var(--ink-soft);font-family:'IBM Plex Mono',monospace;">${formatValue(v)}</text>`;
  }).join('');

  const dotsMarkup = points.filter(p => p.hasEntry).map(p =>
    `<circle cx="${xScale(p.x).toFixed(1)}" cy="${yScale(p.y).toFixed(1)}" r="3.5" style="fill:var(${colorVar});" />`
  ).join('');

  container.innerHTML = `
    <div class="chart-svg-wrap">
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="${escapeAttr(emptyLabel || '')}">
        ${gridMarkup}
        <path d="${areaD}" style="fill:color-mix(in srgb, var(${colorVar}) 16%, transparent);stroke:none;"></path>
        <path d="${pathD}" style="fill:none;stroke:var(${colorVar});stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"></path>
        ${dotsMarkup}
        <line class="chart-hover-line" x1="0" x2="0" y1="${PAD_T}" y2="${HEIGHT - PAD_B}" style="stroke:var(--ink-soft);stroke-width:1;opacity:0;"></line>
        <circle class="chart-hover-dot" r="4" style="fill:var(${colorVar});stroke:var(--paper-card);stroke-width:2;opacity:0;"></circle>
      </svg>
      <div class="chart-tooltip"></div>
    </div>
  `;

  const svg = container.querySelector('svg');
  const wrap = container.querySelector('.chart-svg-wrap');
  const hoverLine = container.querySelector('.chart-hover-line');
  const hoverDot = container.querySelector('.chart-hover-dot');
  const tooltip = container.querySelector('.chart-tooltip');

  const show = (point) => {
    const x = xScale(point.x), y = yScale(point.y);
    hoverLine.setAttribute('x1', x); hoverLine.setAttribute('x2', x);
    hoverLine.style.opacity = '1';
    hoverDot.setAttribute('cx', x); hoverDot.setAttribute('cy', y);
    hoverDot.style.opacity = '1';
    tooltip.textContent = `Day ${point.x} · ${formatValue(point.y)}`;
    const svgRect = svg.getBoundingClientRect();
    tooltip.style.left = ((x / WIDTH) * svgRect.width) + 'px';
    tooltip.style.top = ((y / HEIGHT) * svgRect.height - 8) + 'px';
    tooltip.classList.add('visible');
  };
  const hide = () => {
    hoverLine.style.opacity = '0';
    hoverDot.style.opacity = '0';
    tooltip.classList.remove('visible');
  };

  wrap.addEventListener('pointermove', (e) => {
    const svgRect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - svgRect.left) / svgRect.width) * WIDTH;
    const day = Math.round(((svgX - PAD_L) / PLOT_W) * (daysInMonth - 1)) + 1;
    const clampedDay = Math.max(points[0].x, Math.min(points[points.length - 1].x, day));
    const point = points.find(p => p.x === clampedDay) || points[points.length - 1];
    if(point) show(point);
  });
  wrap.addEventListener('pointerleave', hide);
}

function escapeAttr(s){
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
