// Hand-rolled inline SVG bar chart — no charting library (the app has zero frontend
// dependencies by design, and the default Helmet CSP would block a CDN script anyway).
// Single series, one rounded bar per bucket. x is a generic 1..xMax index — the caller decides
// what it means (day-of-month for "Daily", month-index for "Overall") and supplies formatX
// (tooltip label) and formatTick (short axis label) accordingly.

const WIDTH = 520, HEIGHT = 190;
const PAD_L = 46, PAD_R = 6, PAD_T = 12, PAD_B = 24;
const PLOT_W = WIDTH - PAD_L - PAD_R;
const PLOT_H = HEIGHT - PAD_T - PAD_B;
const MAX_BAR_W = 36;
const BAR_GAP = 2;

// points: [{ x: 1..xMax, y: value }]. xMax sets the full axis width even when points stop
// partway (e.g. "today" in the current month), so the remaining days show as empty slots.
export function renderProgressionChart(container, { points, xMax, colorVar, formatValue, formatX, formatTick, emptyLabel }){
  if(!points || !points.length){
    container.innerHTML = `<div class="chart-empty">${emptyLabel || 'No data yet'}</div>`;
    return;
  }
  const labelX = formatX || (x => `Day ${x}`);
  const tickX = formatTick || (x => String(x));

  const maxY = Math.max(1, ...points.map(p => p.y));
  const slotW = PLOT_W / xMax;
  const barW = Math.max(2, Math.min(MAX_BAR_W, slotW - BAR_GAP));
  const slotLeft = x => PAD_L + (x - 1) * slotW;
  const barLeft = x => slotLeft(x) + (slotW - barW) / 2;
  const barCenter = x => slotLeft(x) + slotW / 2;
  const yScale = val => PAD_T + PLOT_H - (val / maxY) * PLOT_H;
  const baseY = yScale(0);

  const gridMarkup = [0, maxY / 2, maxY].map(v => {
    const y = yScale(v).toFixed(1);
    return `<line x1="${PAD_L}" x2="${WIDTH - PAD_R}" y1="${y}" y2="${y}" style="stroke:var(--line);stroke-width:1" />
      <text x="${PAD_L - 8}" y="${(Number(y) + 3.5).toFixed(1)}" text-anchor="end" style="font-size:10px;fill:var(--ink-faint);font-family:var(--font);font-variant-numeric:tabular-nums;">${formatValue(v)}</text>`;
  }).join('');

  // Label every bucket when there are few; otherwise weekly (1, 8, 15, 22, 29).
  const tickStep = xMax <= 12 ? 1 : 7;
  let ticksMarkup = '';
  for(let x = 1; x <= xMax; x += tickStep){
    ticksMarkup += `<text x="${barCenter(x).toFixed(1)}" y="${HEIGHT - 6}" text-anchor="middle" style="font-size:10px;fill:var(--ink-faint);font-family:var(--font);">${tickX(x)}</text>`;
  }

  // Rounded top corners, square bottom anchored to the baseline.
  const barPath = (x, y) => {
    const left = barLeft(x), right = left + barW;
    const h = baseY - y;
    const r = Math.min(4, barW / 2, h);
    return `M${left.toFixed(1)},${baseY.toFixed(1)} L${left.toFixed(1)},${(y + r).toFixed(1)} Q${left.toFixed(1)},${y.toFixed(1)} ${(left + r).toFixed(1)},${y.toFixed(1)} L${(right - r).toFixed(1)},${y.toFixed(1)} Q${right.toFixed(1)},${y.toFixed(1)} ${right.toFixed(1)},${(y + r).toFixed(1)} L${right.toFixed(1)},${baseY.toFixed(1)} Z`;
  };
  const barsMarkup = points.filter(p => p.y > 0).map(p =>
    `<path class="chart-bar" data-x="${p.x}" d="${barPath(p.x, yScale(p.y))}" style="fill:var(${colorVar});transition:opacity .12s ease;"></path>`
  ).join('');

  container.innerHTML = `
    <div class="chart-svg-wrap">
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeAttr(emptyLabel || '')}">
        ${gridMarkup}
        ${barsMarkup}
        ${ticksMarkup}
      </svg>
      <div class="chart-tooltip"></div>
    </div>
  `;

  const svg = container.querySelector('svg');
  const wrap = container.querySelector('.chart-svg-wrap');
  const tooltip = container.querySelector('.chart-tooltip');
  const bars = Array.from(container.querySelectorAll('.chart-bar'));

  const show = (point) => {
    bars.forEach(b => { b.style.opacity = Number(b.dataset.x) === point.x ? '1' : '0.35'; });
    tooltip.textContent = `${labelX(point.x)} · ${formatValue(point.y)}`;
    const svgRect = svg.getBoundingClientRect();
    const scale = svgRect.width / WIDTH;
    tooltip.style.left = (barCenter(point.x) * scale) + 'px';
    tooltip.style.top = ((Math.min(yScale(point.y), baseY) - 8) * scale) + 'px';
    tooltip.classList.add('visible');
  };
  const hide = () => {
    bars.forEach(b => { b.style.opacity = '1'; });
    tooltip.classList.remove('visible');
  };

  const lastX = points[points.length - 1].x;
  wrap.addEventListener('pointermove', (e) => {
    const svgRect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - svgRect.left) / svgRect.width) * WIDTH;
    const x = Math.floor((svgX - PAD_L) / slotW) + 1;
    if(x < 1 || x > lastX){ hide(); return; }
    const point = points.find(p => p.x === x);
    if(point) show(point); else hide();
  });
  wrap.addEventListener('pointerleave', hide);
}

function escapeAttr(s){
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
