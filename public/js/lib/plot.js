// A 2D coordinate plane drawn on a <canvas>, with zoom and pan built in.
//
// You work in math coordinates ("world" units). The plot converts them to pixels.
//
//   const plot = new Plot(container, { xMin: -5, xMax: 5, yMin: -3, yMax: 3 });
//   plot.onDraw = (p) => {
//     p.grid();
//     p.curve(Math.sin, { color: COLORS.blue });
//     p.point(1, Math.sin(1));
//   };
//   plot.render();        // call whenever your state changes
//   plot.destroy();       // call when leaving the page
//
// Dragging: plot.addDraggable({ get: () => [x, y], set: (x, y) => { ...update state, redraw... } })
//
// Zoom and pan (on by default, pass { zoom: false } to turn off):
//   - scroll or pinch to zoom (plain scrolling zooms after you click the graph, so the page still scrolls)
//   - drag empty space to pan, double-click to zoom in
//   - the +, − and ⟲ buttons in the corner; ⟲ goes back to the starting view
//
// Colours come from the theme (light/dark), so read COLORS while drawing, inside onDraw.

import { clamp } from './numeric.js';
import { COLORS, alpha, onThemeChange } from './theme.js';

export { COLORS, alpha };

const FONT = '11.5px "IBM Plex Mono", ui-monospace, monospace'; // tick labels
export const LABEL_FONT = '"IBM Plex Sans", system-ui, -apple-system, sans-serif';
const DRAG_RADIUS = 18; // how close (in pixels) a click must be to grab a handle
const MIN_SPAN = 1e-6;
const MAX_SPAN = 1e6;

export class Plot {
  /**
   * @param {HTMLElement} container - the canvas is appended here
   * @param {{xMin, xMax, yMin, yMax}} view - visible region in math units
   * @param {{height?: number|string, equalAspect?: boolean, zoom?: boolean}} options
   *   height:      pixels, or a CSS length like '100%'
   *   equalAspect: keep 1 unit on x the same length as 1 unit on y (needed for geometry)
   *   zoom:        allow zooming and panning (default true)
   */
  constructor(container, view = {}, { height = 420, equalAspect = false, zoom = true } = {}) {
    this.view = { xMin: -5, xMax: 5, yMin: -5, yMax: 5, ...view };
    this.initialView = { ...this.view };
    this.equalAspect = equalAspect;
    this.zoomEnabled = zoom;
    this.onDraw = null;
    /** Called after the user zooms or pans. */
    this.onViewChange = null;
    /** Set to true to re-render on every mouse move; `plot.pointer` is then [x, y] or null. */
    this.trackPointer = false;
    this.pointer = null;
    /** Plain scroll-wheel zooms only after a click, unless this is true (full-page graphs). */
    this.alwaysScrollZoom = false;
    this.draggables = [];
    this.activeDrag = null;
    this.width = 0;
    this.height = 0;
    this.bounds = null;

    this.wrap = document.createElement('div');
    this.wrap.className = 'plot-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plot';
    this.canvas.style.height = typeof height === 'number' ? `${height}px` : height;
    this.wrap.append(this.canvas);
    if (zoom) this.wrap.append(this.createToolbar(), (this.hint = this.createHint()));
    container.append(this.wrap);
    this.ctx = this.canvas.getContext('2d');

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.stopWatchingTheme = onThemeChange(() => this.render());
    document.fonts?.ready.then(() => this.render()); // canvas text switches to the web font once it loads
    this.listenForPointer();
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.stopWatchingTheme();
    this.wrap.remove();
  }

  /** Change the visible region, e.g. plot.setView({ yMax: 10 }). */
  setView(view) {
    Object.assign(this.view, view);
    this.render();
  }

  /** Go back to the view the plot started with. */
  resetView() {
    this.view = { ...this.initialView };
    this.render();
    this.onViewChange?.(this);
  }

  /** Zoom by `factor` (< 1 zooms in) keeping the point under pixel (px, py) fixed. */
  zoomAt(px, py, factor) {
    if (!this.bounds) return;
    const { xMin, xMax, yMin, yMax } = this.bounds;
    const spanX = (xMax - xMin) * factor;
    const spanY = (yMax - yMin) * factor;
    if (Math.min(spanX, spanY) < MIN_SPAN || Math.max(spanX, spanY) > MAX_SPAN) return;
    const [wx, wy] = this.toWorld(px, py);
    this.view = {
      xMin: wx - (wx - xMin) * factor,
      xMax: wx + (xMax - wx) * factor,
      yMin: wy - (wy - yMin) * factor,
      yMax: wy + (yMax - wy) * factor,
    };
    this.render();
    this.onViewChange?.(this);
  }

  zoomBy(factor) {
    this.zoomAt(this.width / 2, this.height / 2, factor);
  }

  /** Clear the canvas and call onDraw. */
  render() {
    if (!this.width) return; // not on screen yet; resize() will render later
    this.updateBounds();
    this.ctx.fillStyle = COLORS.background;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.onDraw?.(this);
  }

  // ---- Coordinate conversion ---------------------------------------------

  toScreenX(x) {
    const { xMin, xMax } = this.bounds;
    return ((x - xMin) / (xMax - xMin)) * this.width;
  }

  toScreenY(y) {
    const { yMin, yMax } = this.bounds;
    return this.height - ((y - yMin) / (yMax - yMin)) * this.height;
  }

  toWorld(px, py) {
    const { xMin, xMax, yMin, yMax } = this.bounds;
    return [xMin + (px / this.width) * (xMax - xMin), yMin + ((this.height - py) / this.height) * (yMax - yMin)];
  }

  /** How many world units one pixel covers (x direction). */
  get unitsPerPixel() {
    return (this.bounds.xMax - this.bounds.xMin) / this.width;
  }

  // ---- Drawing -------------------------------------------------------------

  /**
   * Grid lines (major + minor), axes and tick labels.
   * Steps are chosen automatically from the zoom level. A fixed xStep/yStep is used only
   * while it stays readable (at least 24px apart).
   */
  grid({ xStep, yStep, xFormat = formatTick, yFormat = formatTick, minor = true } = {}) {
    const { ctx } = this;
    const { xMin, xMax, yMin, yMax } = this.bounds;
    const autoX = niceStep((xMax - xMin) / Math.max(4, this.width / 90));
    const autoY = niceStep((yMax - yMin) / Math.max(4, this.height / 70));
    xStep = xStep && xStep / this.unitsPerPixel >= 24 && (xMax - xMin) / xStep < 60 ? xStep : autoX;
    yStep = yStep && yStep / ((yMax - yMin) / this.height) >= 24 && (yMax - yMin) / yStep < 60 ? yStep : autoY;

    const ticks = (min, max, step) => range(Math.ceil(min / step), Math.floor(max / step)).map((i) => i * step);
    const xTicks = ticks(xMin, xMax, xStep);
    const yTicks = ticks(yMin, yMax, yStep);

    ctx.save();
    ctx.lineWidth = 1;

    if (minor) {
      const xMinor = xStep / minorDivisions(xStep);
      const yMinor = yStep / minorDivisions(yStep);
      ctx.strokeStyle = COLORS.gridMinor;
      ctx.beginPath();
      if (xMinor / this.unitsPerPixel >= 8) {
        for (const x of ticks(xMin, xMax, xMinor)) this.verticalPixelLine(x);
      }
      if (yMinor / ((yMax - yMin) / this.height) >= 8) {
        for (const y of ticks(yMin, yMax, yMinor)) this.horizontalPixelLine(y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    for (const x of xTicks) this.verticalPixelLine(x);
    for (const y of yTicks) this.horizontalPixelLine(y);
    ctx.stroke();

    // Axes (only if visible)
    const axisX = this.toScreenX(0);
    const axisY = this.toScreenY(0);
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (axisY >= 0 && axisY <= this.height) {
      ctx.moveTo(0, axisY);
      ctx.lineTo(this.width, axisY);
    }
    if (axisX >= 0 && axisX <= this.width) {
      ctx.moveTo(axisX, 0);
      ctx.lineTo(axisX, this.height);
    }
    ctx.stroke();

    // Tick labels stay at the edge when an axis is off-screen
    ctx.font = FONT;
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelY = clamp(axisY + 5, 4, this.height - 16);
    for (const x of xTicks) {
      if (Math.abs(x) > xStep * 1e-9) this.labelWithHalo(xFormat(x), this.toScreenX(x), labelY);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const labelX = clamp(axisX - 6, 34, this.width - 4);
    for (const y of yTicks) {
      if (Math.abs(y) > yStep * 1e-9) this.labelWithHalo(yFormat(y), labelX, this.toScreenY(y));
    }
    ctx.restore();
  }

  /** Graph y = f(x). Breaks the line where f is undefined or jumps (e.g. asymptotes). */
  curve(f, { color = COLORS.blue, width = 2.5, dash = [], from, to } = {}) {
    const { ctx } = this;
    const start = Math.max(from ?? -Infinity, this.bounds.xMin);
    const end = Math.min(to ?? Infinity, this.bounds.xMax);
    if (!(end > start)) return;
    const steps = Math.max(2, Math.ceil(Math.abs(this.toScreenX(end) - this.toScreenX(start))));

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let penDown = false;
    let previousPy = 0;
    for (let i = 0; i <= steps; i++) {
      const x = start + ((end - start) * i) / steps;
      let y;
      try {
        y = f(x);
      } catch {
        y = NaN;
      }
      if (!Number.isFinite(y)) {
        penDown = false;
        continue;
      }
      const px = this.toScreenX(x);
      const py = clamp(this.toScreenY(y), -10000, 10000);
      if (penDown && Math.abs(py - previousPy) > this.height) penDown = false; // a jump
      if (penDown) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
      penDown = true;
      previousPy = py;
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Connect a list of [x, y] points. Use fill to shade the shape. */
  path(points, { color = COLORS.blue, width = 2, dash = [], fill = null, closed = false } = {}) {
    if (points.length < 2) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const px = clamp(this.toScreenX(x), -1e5, 1e5);
      const py = clamp(this.toScreenY(y), -1e5, 1e5);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (closed) ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (color && width > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.stroke();
    }
    ctx.restore();
  }

  line(x1, y1, x2, y2, options = {}) {
    this.path([[x1, y1], [x2, y2]], options);
  }

  /** A vertical line across the whole plot at x. */
  verticalLine(x, options = {}) {
    this.line(x, this.bounds.yMin, x, this.bounds.yMax, options);
  }

  /** A horizontal line across the whole plot at y. */
  horizontalLine(y, options = {}) {
    this.line(this.bounds.xMin, y, this.bounds.xMax, y, options);
  }

  /** An arrow from (x1, y1) to (x2, y2), e.g. a vector. */
  arrow(x1, y1, x2, y2, { color = COLORS.blue, width = 2.5, headSize = 11, dash = [] } = {}) {
    const { ctx } = this;
    const ax = this.toScreenX(x1);
    const ay = this.toScreenY(y1);
    const bx = this.toScreenX(x2);
    const by = this.toScreenY(y2);
    const length = Math.hypot(bx - ax, by - ay);
    if (!(length >= 1) || !Number.isFinite(length)) return;

    const angle = Math.atan2(by - ay, bx - ax);
    const head = Math.min(headSize, length * 0.5);
    const shaftEndX = bx - Math.cos(angle) * head * 0.8;
    const shaftEndY = by - Math.sin(angle) * head * 0.8;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - head * Math.cos(angle - 0.4), by - head * Math.sin(angle - 0.4));
    ctx.lineTo(bx - head * Math.cos(angle + 0.4), by - head * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  point(x, y, { color = COLORS.yellow, radius = 5, ring = false } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.toScreenX(x), this.toScreenY(y), radius, 0, Math.PI * 2);
    if (ring) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.fillStyle = COLORS.background;
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.background;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Text at a world position. offset is in pixels, [right, down]. */
  text(label, x, y, { color = COLORS.text, align = 'left', baseline = 'bottom', offset = [6, -6], font = `600 13px ${LABEL_FONT}`, halo = true } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    const px = this.toScreenX(x) + offset[0];
    const py = this.toScreenY(y) + offset[1];
    if (halo) {
      // A soft outline in the background colour keeps labels readable over lines
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = alpha(COLORS.background, 0.85);
      ctx.strokeText(label, px, py);
    }
    ctx.fillStyle = color;
    ctx.fillText(label, px, py);
    ctx.restore();
  }

  // ---- Dragging --------------------------------------------------------------

  /**
   * Make something draggable.
   * handle.get() returns its current [x, y]; handle.set(x, y) is called while dragging
   * and should update your state and redraw.
   */
  addDraggable(handle) {
    this.draggables.push(handle);
  }

  // ---- Pointer handling: drag handles, pan, pinch, wheel zoom, hover ----------

  listenForPointer() {
    const canvas = this.canvas;
    canvas.style.touchAction = 'none'; // the plot handles touch gestures itself
    const pointers = new Map(); // pointerId → [px, py]
    let pan = null; // { start: [px, py], bounds }
    let pinch = null; // { distance, center, bounds }
    this.engaged = false; // after a click, plain scroll-wheel zooms

    const position = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const handleAt = ([px, py]) => {
      if (!this.bounds) return null;
      let best = null;
      let bestDistance = DRAG_RADIUS;
      for (const handle of this.draggables) {
        const [x, y] = handle.get();
        const distance = Math.hypot(this.toScreenX(x) - px, this.toScreenY(y) - py);
        if (distance < bestDistance) {
          best = handle;
          bestDistance = distance;
        }
      }
      return best;
    };
    const startPinch = () => {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      pan = null;
      this.activeDrag = null;
    };

    canvas.addEventListener('pointerdown', (event) => {
      const at = position(event);
      pointers.set(event.pointerId, at);
      canvas.setPointerCapture(event.pointerId);
      this.engaged = true;
      this.wrap.classList.add('engaged');

      if (pointers.size === 2 && this.zoomEnabled) return startPinch();
      this.activeDrag = handleAt(at);
      if (this.activeDrag) {
        canvas.style.cursor = 'grabbing';
      } else if (this.zoomEnabled && this.bounds) {
        pan = { start: at, bounds: { ...this.bounds } };
        canvas.style.cursor = 'grabbing';
      }
    });

    canvas.addEventListener('pointermove', (event) => {
      const at = position(event);
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, at);

      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        this.zoomAt(pinch.center[0], pinch.center[1], pinch.distance / distance);
        pinch.distance = distance;
        return;
      }
      if (this.activeDrag) {
        this.activeDrag.set(...this.toWorld(...at));
        return;
      }
      if (pan) {
        const b = pan.bounds;
        const dx = ((at[0] - pan.start[0]) / this.width) * (b.xMax - b.xMin);
        const dy = ((at[1] - pan.start[1]) / this.height) * (b.yMax - b.yMin);
        this.view = { xMin: b.xMin - dx, xMax: b.xMax - dx, yMin: b.yMin + dy, yMax: b.yMax + dy };
        this.render();
        this.onViewChange?.(this);
        return;
      }
      canvas.style.cursor = handleAt(at) ? 'grab' : this.zoomEnabled ? 'crosshair' : 'default';
      if (this.trackPointer && this.bounds) {
        this.pointer = this.toWorld(...at);
        this.render();
      }
    });

    const release = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        this.activeDrag = null;
        pan = null;
        canvas.style.cursor = 'default';
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => {
      if (this.trackPointer && this.pointer) {
        this.pointer = null;
        this.render();
      }
    });
    this.wrap.addEventListener('mouseleave', () => {
      this.engaged = false;
      this.wrap.classList.remove('engaged');
    });

    if (!this.zoomEnabled) return;

    canvas.addEventListener(
      'wheel',
      (event) => {
        // Pinch on a trackpad arrives as ctrl+wheel. Plain wheel only zooms once the
        // graph has been clicked, so scrolling down the page doesn't get stuck on a plot.
        if (!event.ctrlKey && !event.metaKey && !this.engaged && !this.alwaysScrollZoom) {
          this.flashHint();
          return;
        }
        event.preventDefault();
        const speed = event.ctrlKey ? 0.01 : 0.002;
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
        this.zoomAt(...position(event), Math.exp(clamp(delta, -100, 100) * speed));
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', (event) => {
      if (!handleAt(position(event))) this.zoomAt(...position(event), 0.5);
    });
  }

  createToolbar() {
    const bar = document.createElement('div');
    bar.className = 'plot-toolbar';
    const button = (label, title, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'plot-tool';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = label;
      b.addEventListener('click', onClick);
      bar.append(b);
    };
    button(ICONS.plus, 'Zoom in', () => this.zoomBy(0.7));
    button(ICONS.minus, 'Zoom out', () => this.zoomBy(1 / 0.7));
    button(ICONS.home, 'Reset view', () => this.resetView());
    return bar;
  }

  createHint() {
    const hint = document.createElement('div');
    hint.className = 'plot-hint';
    hint.textContent = 'Click the graph, then scroll to zoom · or pinch · drag to pan';
    return hint;
  }

  flashHint() {
    if (!this.hint) return;
    this.hint.classList.add('visible');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.classList.remove('visible'), 1400);
  }

  // ---- Internals -------------------------------------------------------------

  verticalPixelLine(x) {
    const px = Math.round(this.toScreenX(x)) + 0.5;
    this.ctx.moveTo(px, 0);
    this.ctx.lineTo(px, this.height);
  }

  horizontalPixelLine(y) {
    const py = Math.round(this.toScreenY(y)) + 0.5;
    this.ctx.moveTo(0, py);
    this.ctx.lineTo(this.width, py);
  }

  labelWithHalo(text, px, py) {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.background;
    ctx.strokeText(text, px, py);
    ctx.restore();
    ctx.fillText(text, px, py);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const pixelRatio = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * pixelRatio);
    this.canvas.height = Math.round(rect.height * pixelRatio);
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); // draw in CSS pixels
    this.render();
  }

  /** Work out the actually visible region (it can differ from `view` when equalAspect is on). */
  updateBounds() {
    let { xMin, xMax, yMin, yMax } = this.view;
    if (this.equalAspect) {
      const unitsPerPixel = Math.max((xMax - xMin) / this.width, (yMax - yMin) / this.height);
      const centerX = (xMin + xMax) / 2;
      const centerY = (yMin + yMax) / 2;
      const halfWidth = (unitsPerPixel * this.width) / 2;
      const halfHeight = (unitsPerPixel * this.height) / 2;
      [xMin, xMax, yMin, yMax] = [centerX - halfWidth, centerX + halfWidth, centerY - halfHeight, centerY + halfHeight];
    }
    this.bounds = { xMin, xMax, yMin, yMax };
  }
}

const ICONS = {
  plus: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  minus: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  home: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2.5v3h3"/></svg>',
};

/** Pick a "nice" grid spacing (1, 2 or 5 times a power of ten) close to `rough`. */
function niceStep(rough) {
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / power;
  if (fraction < 1.5) return power;
  if (fraction < 3.5) return 2 * power;
  if (fraction < 7.5) return 5 * power;
  return 10 * power;
}

/** Minor lines between majors: 4 for steps like 2, 20; 5 otherwise. */
function minorDivisions(step) {
  const mantissa = Math.round(step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9)));
  return mantissa === 2 ? 4 : 5;
}

function formatTick(value) {
  return String(Number(value.toPrecision(6)));
}

function range(from, to) {
  const values = [];
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from > 5000) return values;
  for (let i = from; i <= to; i++) values.push(i);
  return values;
}
