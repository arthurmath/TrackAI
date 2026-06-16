export interface ScorePoint {
  iteration: number;
  avg_progress: number;
  best_progress: number;
}

const PAD = { top: 28, right: 24, bottom: 44, left: 56 };
const AVG_COLOR = '#ff8c42';
const BEST_COLOR = '#2ecc71';
const GRID_COLOR = 'rgba(255, 255, 255, 0.08)';
const AXIS_COLOR = 'rgba(255, 255, 255, 0.35)';
const TEXT_COLOR = 'rgba(255, 255, 255, 0.55)';
const Y_PADDING = 0.08;

function computeYRange(values: number[]): { yMin: number; yMax: number } {
  if (!values.length) return { yMin: 0, yMax: 1 };

  let yMin = Math.min(...values);
  let yMax = Math.max(...values);

  if (yMin === yMax) {
    const pad = Math.max(0.02, yMax * Y_PADDING);
    yMin = Math.max(0, yMin - pad);
    yMax = Math.min(1, yMax + pad);
  } else {
    const span = yMax - yMin;
    yMin = Math.max(0, yMin - span * Y_PADDING);
    yMax = Math.min(1, yMax + span * Y_PADDING);
  }

  if (yMax - yMin < 0.01) yMax = Math.min(1, yMin + 0.01);
  return { yMin, yMax };
}

function formatProgress(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

export function drawTrainingChart(
  canvas: HTMLCanvasElement,
  points: ScorePoint[],
  showBest: boolean,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, w, h);

  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;

  if (!points.length || plotW <= 0 || plotH <= 0) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Aucune donnée à afficher', w / 2, h / 2);
    return;
  }

  const xMin = points[0].iteration;
  const xMax = points[points.length - 1].iteration;
  const xSpan = xMax - xMin || 1;

  const visibleValues: number[] = [];
  for (const p of points) {
    visibleValues.push(p.avg_progress);
    if (showBest) visibleValues.push(p.best_progress);
  }
  const { yMin, yMax } = computeYRange(visibleValues);
  const ySpan = yMax - yMin || 1;

  const toX = (iteration: number): number => PAD.left + ((iteration - xMin) / xSpan) * plotW;
  const toY = (progress: number): number => PAD.top + plotH - ((progress - yMin) / ySpan) * plotH;

  const yTicks = 5;
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '11px system-ui, sans-serif';

  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + (ySpan * i) / yTicks;
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + plotW, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatProgress(v), PAD.left - 8, y);
  }

  const xTicks = Math.min(6, points.length);
  for (let i = 0; i <= xTicks; i++) {
    const iteration = xMin + (xSpan * i) / xTicks;
    const x = toX(iteration);
    ctx.beginPath();
    ctx.moveTo(x, PAD.top);
    ctx.lineTo(x, PAD.top + plotH);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(Math.round(iteration)), x, PAD.top + plotH + 8);
  }

  ctx.strokeStyle = AXIS_COLOR;
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top);
  ctx.lineTo(PAD.left, PAD.top + plotH);
  ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
  ctx.stroke();

  const drawLine = (key: 'avg_progress' | 'best_progress', color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = toX(p.iteration);
      const y = toY(p[key]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = color;
    points.forEach((p) => {
      const x = toX(p.iteration);
      const y = toY(p[key]);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  drawLine('avg_progress', AVG_COLOR);
  if (showBest) drawLine('best_progress', BEST_COLOR);

  const legendY = PAD.top - 10;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '12px system-ui, sans-serif';

  ctx.fillStyle = AVG_COLOR;
  ctx.fillRect(PAD.left, legendY - 5, 18, 3);
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText('avg_progress', PAD.left + 24, legendY);

  if (showBest) {
    const bestX = PAD.left + 130;
    ctx.fillStyle = BEST_COLOR;
    ctx.fillRect(bestX, legendY - 5, 18, 3);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText('best_progress', bestX + 24, legendY);
  }
}

export function attachTrainingChart(
  canvas: HTMLCanvasElement,
  getPoints: () => ScorePoint[],
  getShowBest: () => boolean,
): { redraw: () => void; destroy: () => void } {
  const redraw = (): void => {
    drawTrainingChart(canvas, getPoints(), getShowBest());
  };

  const ro = new ResizeObserver(redraw);
  ro.observe(canvas);
  redraw();

  return {
    redraw,
    destroy: () => ro.disconnect(),
  };
}
