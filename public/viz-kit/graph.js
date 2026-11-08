// MathLens viz kit, part 2: zooming, and graphs whose labels stay attached to what they point at.
//
//   const g = MathLens.graph('#plot', { x: [-3, 3], y: [-1, 9], xLabel: 'x', yLabel: 'height' });
//   g.draw((d) => {
//     d.fn((x) => x * x, { color: 'blue', label: 'y = x²' });
//     d.point(1, 1, { color: 'orange', drag: (x) => { a = x; g.redraw(); } });
//     d.note(1, 1, 'You are here', { color: 'orange' });
//   });
//
// Every graph gets + / − / Reset buttons, pinch and drag to move around. Everything else on the page
// gets zoom buttons too: Plotly charts through their own axes and camera, any other canvas or SVG
// by enlarging it inside a scrollable box. Saved lessons pick this up without being rewritten.
(function () {
  const graphs = new Set();
  const animations = new Set();
  let highlight = null;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const colorOf = (name) => (/^[a-z]+$/.test(name || '') ? css(name) || name : name);
  const NAMES = ['blue', 'orange', 'green', 'red', 'purple', 'yellow', 'cyan', 'pink'];
  /** Code may pass MathLens.color('orange') or just 'orange'. Either way it's the colour called orange. */
  const nameOf = (color) => NAMES.find((name) => name === color || css(name) === color) || color;

  function zoomBar(actions) {
    const bar = document.createElement('div');
    bar.className = 'ml-zoom';
    const add = (text, title, run) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        run();
      });
      bar.append(button);
    };
    add('−', 'Zoom out', actions.out);
    add('+', 'Zoom in', actions.in);
    add('Reset', 'Back to the full view', actions.reset);
    bar.addEventListener('pointerdown', (event) => event.stopPropagation());
    bar.addEventListener('dblclick', (event) => event.stopPropagation());
    return bar;
  }

  function niceStep(span, count) {
    if (!Number.isFinite(span) || span <= 0) return 1;
    const raw = span / Math.max(1, count);
    const power = 10 ** Math.floor(Math.log10(raw));
    const scaled = raw / power;
    return (scaled < 1.5 ? 1 : scaled < 3 ? 2 : scaled < 7 ? 5 : 10) * power;
  }

  const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // ---- The graph --------------------------------------------------------------------------
  function createGraph(target, options = {}) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('MathLens.graph: element not found');
    host.classList.add('ml-graph');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    host.replaceChildren(canvas);
    const ctx = canvas.getContext('2d');

    const axesByDefault = options.axes !== false;
    let showAxes = axesByDefault;
    const padding = () => (showAxes ? { l: options.yLabel ? 58 : 44, r: 14, t: 14, b: options.xLabel ? 46 : 30 } : { l: 8, r: 8, t: 8, b: 8 });
    let home = { x: [...(options.x || [-5, 5])], y: [...(options.y || [-5, 5])] };
    let view = { x: [...home.x], y: [...home.y] };
    let scene = null;
    let width = 0;
    let height = 0;
    let frame = 0;
    let handles = [];
    let engaged = false; // after a click, plain scroll-wheel zooms (same rule as the built-in lessons)

    const plot = () => {
      const pad = padding();
      return { x: pad.l, y: pad.t, w: Math.max(10, width - pad.l - pad.r), h: Math.max(10, height - pad.t - pad.b) };
    };
    function shown() {
      if (!options.equal) return view;
      // One unit is the same length on both axes: grow whichever axis has spare room
      const p = plot();
      const dx = view.x[1] - view.x[0];
      const dy = view.y[1] - view.y[0];
      const perPx = Math.max(dx / p.w, dy / p.h);
      const cx = (view.x[0] + view.x[1]) / 2;
      const cy = (view.y[0] + view.y[1]) / 2;
      return { x: [cx - (perPx * p.w) / 2, cx + (perPx * p.w) / 2], y: [cy - (perPx * p.h) / 2, cy + (perPx * p.h) / 2] };
    }
    const toPx = (x, y) => {
      const p = plot();
      const v = shown();
      return [p.x + ((x - v.x[0]) / (v.x[1] - v.x[0])) * p.w, p.y + p.h - ((y - v.y[0]) / (v.y[1] - v.y[0])) * p.h];
    };
    const toData = (px, py) => {
      const p = plot();
      const v = shown();
      return [v.x[0] + ((px - p.x) / p.w) * (v.x[1] - v.x[0]), v.y[0] + ((p.y + p.h - py) / p.h) * (v.y[1] - v.y[0])];
    };

    function setStyle(opts, baseWidth) {
      const name = nameOf(opts.color || 'blue');
      const dim = highlight && name !== highlight;
      const lit = highlight && name === highlight;
      ctx.globalAlpha = (opts.alpha ?? 1) * (dim ? 0.18 : 1);
      ctx.strokeStyle = colorOf(name);
      ctx.fillStyle = colorOf(name);
      ctx.lineWidth = (opts.width || baseWidth) * (lit ? 1.7 : 1);
      ctx.setLineDash(opts.dash ? [7, 5] : []);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }

    const labelFont = '500 13px "IBM Plex Sans", system-ui, sans-serif';
    function drawLabels(labels) {
      const p = plot();
      const placed = [{ x: width - 150, y: 0, w: 150, h: 46 }]; // the zoom buttons
      ctx.font = labelFont;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (const label of labels) {
        const lines = String(label.text).split('\n');
        const w = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 14;
        const h = lines.length * 17 + 8;
        const near = label.leader ? 22 : 8;
        const candidates = [
          [label.dx ?? near, label.dy ?? -near - h],
          [near, near],
          [-near - w, -near - h],
          [-near - w, near],
          [near, -near * 2 - h * 1.6],
          [-near - w, -near * 2 - h * 1.6],
        ];
        let box = null;
        for (const [dx, dy] of candidates) {
          const trial = {
            x: Math.min(Math.max(p.x + 2, label.px + dx), p.x + p.w - w - 2),
            y: Math.min(Math.max(p.y + 2, label.py + dy), p.y + p.h - h - 2),
            w,
            h,
          };
          if (!placed.some((other) => rectsOverlap(trial, other))) {
            box = trial;
            break;
          }
          box = box || trial;
        }
        placed.push(box);
        const name = nameOf(label.color || 'blue');
        ctx.globalAlpha = highlight && name !== highlight ? 0.25 : 1;
        ctx.setLineDash([]);
        if (label.leader) {
          // The line ends exactly on the thing being talked about
          const ex = Math.max(box.x, Math.min(label.px, box.x + box.w));
          const ey = Math.max(box.y, Math.min(label.py, box.y + box.h));
          ctx.strokeStyle = colorOf(name);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(label.px, label.py);
          ctx.stroke();
          ctx.fillStyle = colorOf(name);
          ctx.beginPath();
          ctx.arc(label.px, label.py, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = css('bg');
        ctx.strokeStyle = colorOf(name);
        ctx.lineWidth = label.leader ? 1.6 : 1;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = css('text');
        lines.forEach((line, i) => ctx.fillText(line, box.x + 7, box.y + 13 + i * 17));
      }
      ctx.globalAlpha = 1;
    }

    function drawAxes() {
      const p = plot();
      const v = shown();
      ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillStyle = css('muted');
      ctx.lineWidth = 1;
      const stepX = niceStep(v.x[1] - v.x[0], p.w / 80);
      const stepY = niceStep(v.y[1] - v.y[0], p.h / 50);
      const maxTicks = 200; // a safety limit, far more than ever fits on screen
      const fmt = (value, step) => {
        const digits = Math.max(0, -Math.floor(Math.log10(step)));
        return Number(value.toFixed(digits)).toString();
      };
      const zeroX = toPx(0, 0)[0];
      const zeroY = toPx(0, 0)[1];
      const axisY = Math.min(p.y + p.h, Math.max(p.y, zeroY));
      const axisX = Math.min(p.x + p.w, Math.max(p.x, zeroX));
      ctx.strokeStyle = css('grid');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let drawn = 0;
      for (let t = Math.ceil(v.x[0] / stepX) * stepX; t <= v.x[1] + stepX * 0.001 && drawn < maxTicks; t += stepX, drawn += 1) {
        const px = toPx(t, 0)[0];
        ctx.beginPath();
        ctx.moveTo(px, p.y);
        ctx.lineTo(px, p.y + p.h);
        ctx.stroke();
        ctx.fillText(fmt(t, stepX), px, p.y + p.h + 7);
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      drawn = 0;
      for (let t = Math.ceil(v.y[0] / stepY) * stepY; t <= v.y[1] + stepY * 0.001 && drawn < maxTicks; t += stepY, drawn += 1) {
        const py = toPx(0, t)[1];
        ctx.beginPath();
        ctx.moveTo(p.x, py);
        ctx.lineTo(p.x + p.w, py);
        ctx.stroke();
        ctx.fillText(fmt(t, stepY), p.x - 7, py);
      }
      ctx.strokeStyle = css('axis');
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x, axisY);
      ctx.lineTo(p.x + p.w, axisY);
      ctx.moveTo(axisX, p.y);
      ctx.lineTo(axisX, p.y + p.h);
      ctx.stroke();
      ctx.font = '500 13px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillStyle = css('text');
      if (options.xLabel) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(options.xLabel, p.x + p.w / 2, height - 4);
      }
      if (options.yLabel) {
        ctx.save();
        ctx.translate(15, p.y + p.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(options.yLabel, 0, 0);
        ctx.restore();
      }
    }

    function render() {
      frame = 0;
      if (!width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      if (showAxes) drawAxes();
      const p = plot();
      const v = shown();
      const labels = [];
      handles = [];
      const inView = (x, y) => x >= v.x[0] && x <= v.x[1] && y >= v.y[0] && y <= v.y[1];
      const pushLabel = (x, y, text, opts, leader) => {
        if (text != null && text !== '' && inView(x, y)) {
          const [px, py] = toPx(x, y);
          labels.push({ px, py, text, color: opts.color, leader, dx: opts.dx, dy: opts.dy });
        }
      };
      const tracePoints = (points) => {
        ctx.beginPath();
        let open = false;
        for (const [x, y] of points) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            open = false;
            continue;
          }
          const [px, py] = toPx(x, y);
          if (open) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          open = true;
        }
      };
      const d = {
        /** y = f(x), drawn across whatever is on screen, so it stays smooth when you zoom in. */
        fn(f, opts = {}) {
          const from = Math.max(opts.from ?? -Infinity, v.x[0]);
          const to = Math.min(opts.to ?? Infinity, v.x[1]);
          const samples = Math.max(120, Math.round(p.w));
          const points = [];
          for (let i = 0; i <= samples; i += 1) {
            const x = from + ((to - from) * i) / samples;
            let y = NaN;
            try {
              y = f(x);
            } catch {
              y = NaN;
            }
            const far = (v.y[1] - v.y[0]) * 50;
            points.push([x, Math.abs(y) > Math.abs(v.y[0]) + far ? NaN : y]);
          }
          setStyle(opts, 3);
          tracePoints(points);
          ctx.stroke();
          if (opts.label) {
            const atX = opts.labelAt ?? from + (to - from) * 0.8;
            pushLabel(atX, f(atX), opts.label, opts, false);
          }
        },
        /** Any path: an array of [x, y], or t → [x, y] with { t: [from, to] }. */
        curve(path, opts = {}) {
          let points = path;
          if (typeof path === 'function') {
            const [a, b] = opts.t || [0, 1];
            points = Array.from({ length: 301 }, (_, i) => path(a + ((b - a) * i) / 300));
          }
          setStyle(opts, 3);
          tracePoints(points);
          if (opts.fill) {
            ctx.save();
            ctx.globalAlpha *= opts.fillAlpha ?? 0.18;
            ctx.fill();
            ctx.restore();
          }
          ctx.stroke();
          if (opts.label && points.length) {
            const at = points[Math.floor(points.length * 0.7)];
            pushLabel(at[0], at[1], opts.label, opts, false);
          }
        },
        line(x1, y1, x2, y2, opts = {}) {
          d.curve([[x1, y1], [x2, y2]], { width: 2.5, ...opts, label: null });
          if (opts.label) pushLabel((x1 + x2) / 2, (y1 + y2) / 2, opts.label, opts, false);
        },
        arrow(x1, y1, x2, y2, opts = {}) {
          const [ax, ay] = toPx(x1, y1);
          const [bx, by] = toPx(x2, y2);
          setStyle(opts, 3.5);
          const size = 8 + ctx.lineWidth * 1.6;
          const angle = Math.atan2(by - ay, bx - ax);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx - Math.cos(angle) * size * 0.7, by - Math.sin(angle) * size * 0.7);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - size * Math.cos(angle - 0.45), by - size * Math.sin(angle - 0.45));
          ctx.lineTo(bx - size * Math.cos(angle + 0.45), by - size * Math.sin(angle + 0.45));
          ctx.closePath();
          ctx.fill();
          if (opts.label) pushLabel(x2, y2, opts.label, opts, false);
        },
        point(x, y, opts = {}) {
          if (!inView(x, y)) return;
          const [px, py] = toPx(x, y);
          setStyle(opts, 2);
          const r = (opts.r || (opts.drag ? 8 : 6)) * (highlight && highlight === nameOf(opts.color || 'blue') ? 1.25 : 1);
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = css('bg');
          ctx.lineWidth = 2;
          ctx.stroke();
          if (opts.drag) handles.push({ px, py, drag: opts.drag });
          pushLabel(x, y, opts.label, opts, false);
        },
        polygon(points, opts = {}) {
          setStyle(opts, 2);
          tracePoints(points);
          ctx.closePath();
          ctx.save();
          ctx.globalAlpha *= opts.fillAlpha ?? 0.22;
          ctx.fill();
          ctx.restore();
          if (opts.stroke !== false) ctx.stroke();
          if (opts.label && points.length) {
            const cx = points.reduce((sum, q) => sum + q[0], 0) / points.length;
            const cy = points.reduce((sum, q) => sum + q[1], 0) / points.length;
            pushLabel(cx, cy, opts.label, opts, false);
          }
        },
        rect(x, y, w, h, opts = {}) {
          d.polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], opts);
        },
        circle(cx, cy, r, opts = {}) {
          const steps = 72;
          d.polygon(Array.from({ length: steps }, (_, i) => [cx + r * Math.cos((i / steps) * Math.PI * 2), cy + r * Math.sin((i / steps) * Math.PI * 2)]), opts);
        },
        /** Level curves of z = f(x, y): the lines a map draws for equal height. */
        contour(f, opts = {}) {
          const cols = opts.detail || 90;
          const rows = Math.max(20, Math.round((cols * p.h) / p.w));
          const dx = (v.x[1] - v.x[0]) / cols;
          const dy = (v.y[1] - v.y[0]) / rows;
          const grid = [];
          for (let j = 0; j <= rows; j += 1) {
            const row = [];
            for (let i = 0; i <= cols; i += 1) {
              let z = NaN;
              try {
                z = f(v.x[0] + i * dx, v.y[0] + j * dy);
              } catch {
                z = NaN;
              }
              row.push(z);
            }
            grid.push(row);
          }
          let levels = opts.levels;
          if (!levels) {
            const flat = grid.flat().filter(Number.isFinite);
            const low = Math.min(...flat);
            const high = Math.max(...flat);
            const step = niceStep(high - low || 1, opts.count || 8);
            levels = [];
            for (let z = Math.ceil(low / step) * step; z <= high && levels.length < 60; z += step) levels.push(Number(z.toFixed(6)));
          }
          setStyle(opts, 1.6);
          const edge = (level, a, b, ax, ay, bx, by) => {
            const t = (level - a) / (b - a);
            return [ax + (bx - ax) * t, ay + (by - ay) * t];
          };
          for (const level of levels) {
            let labelAt = null;
            ctx.beginPath();
            for (let j = 0; j < rows; j += 1) {
              for (let i = 0; i < cols; i += 1) {
                const x0 = v.x[0] + i * dx;
                const y0 = v.y[0] + j * dy;
                const x1 = x0 + dx;
                const y1 = y0 + dy;
                const [a, b, c, e] = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
                if (![a, b, c, e].every(Number.isFinite)) continue;
                const crossings = [];
                if (a < level !== b < level) crossings.push(edge(level, a, b, x0, y0, x1, y0));
                if (b < level !== c < level) crossings.push(edge(level, b, c, x1, y0, x1, y1));
                if (c < level !== e < level) crossings.push(edge(level, c, e, x1, y1, x0, y1));
                if (e < level !== a < level) crossings.push(edge(level, e, a, x0, y1, x0, y0));
                for (let k = 0; k + 1 < crossings.length; k += 2) {
                  const [mx, my] = toPx(...crossings[k]);
                  const [nx, ny] = toPx(...crossings[k + 1]);
                  ctx.moveTo(mx, my);
                  ctx.lineTo(nx, ny);
                  if (!labelAt && j > rows * 0.55 && i > cols * 0.2) labelAt = crossings[k];
                }
              }
            }
            ctx.stroke();
            if (opts.labels !== false && labelAt) {
              const [lx, ly] = toPx(...labelAt);
              const words = String(Number(level.toFixed(3)));
              ctx.save();
              ctx.globalAlpha = 1;
              ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = css('bg');
              ctx.fillRect(lx - ctx.measureText(words).width / 2 - 2, ly - 7, ctx.measureText(words).width + 4, 14);
              ctx.fillStyle = css('muted');
              ctx.fillText(words, lx, ly);
              ctx.restore();
            }
          }
        },
        text(x, y, text, opts = {}) {
          pushLabel(x, y, text, opts, false);
        },
        /** A label joined by a line to the exact point (x, y). Use this for what the step talks about. */
        note(x, y, text, opts = {}) {
          pushLabel(x, y, text, opts, true);
        },
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, p.y, p.w, p.h);
      ctx.clip();
      if (scene) {
        try {
          scene(d, { view: shown() });
        } catch (err) {
          console.error('MathLens graph', err);
        }
      }
      ctx.restore();
      drawLabels(labels);
      host.style.touchAction = isZoomed() ? 'none' : 'pan-y';
    }

    function redraw() {
      if (!frame) frame = requestAnimationFrame(render);
    }
    function isZoomed() {
      return view.x[0] !== home.x[0] || view.x[1] !== home.x[1] || view.y[0] !== home.y[0] || view.y[1] !== home.y[1];
    }
    function zoomAround(factor, cx, cy) {
      const spanNow = view.x[1] - view.x[0];
      const spanHome = home.x[1] - home.x[0];
      if (!Number.isFinite(factor) || factor <= 0) return;
      if ((factor > 1 && spanNow / factor < spanHome / 5000) || (factor < 1 && spanNow / factor > spanHome * 500)) return;
      const scale = (range, center) => [center + (range[0] - center) / factor, center + (range[1] - center) / factor];
      view = { x: scale(view.x, cx ?? (view.x[0] + view.x[1]) / 2), y: scale(view.y, cy ?? (view.y[0] + view.y[1]) / 2) };
      redraw();
    }
    function reset() {
      view = { x: [...home.x], y: [...home.y] };
      redraw();
    }

    host.append(zoomBar({ in: () => zoomAround(1.5), out: () => zoomAround(1 / 1.5), reset }));

    // ---- Pointer: drag a handle, otherwise move the view; two fingers pinch -----------------
    const pointers = new Map();
    let dragging = null;
    let panFrom = null;
    let pinchFrom = 0;
    const local = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const handleAt = (x, y, touch) => {
      const reach = touch ? 24 : 15;
      return handles.find((h) => Math.hypot(h.px - x, h.py - y) <= reach);
    };
    canvas.addEventListener('pointerdown', (event) => {
      engaged = true;
      canvas.setPointerCapture(event.pointerId);
      const [x, y] = local(event);
      pointers.set(event.pointerId, [x, y]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchFrom = Math.hypot(a[0] - b[0], a[1] - b[1]);
        dragging = null;
        panFrom = null;
        return;
      }
      dragging = handleAt(x, y, event.pointerType === 'touch') || null;
      if (!dragging && (event.pointerType !== 'touch' || isZoomed())) panFrom = { x, y, view: { x: [...view.x], y: [...view.y] } };
    });
    canvas.addEventListener('pointermove', (event) => {
      const [x, y] = local(event);
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, [x, y]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinchFrom > 0) {
          const [cx, cy] = toData((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          zoomAround(distance / pinchFrom, cx, cy);
        }
        pinchFrom = distance;
        return;
      }
      if (dragging) {
        const [dx, dy] = toData(x, y);
        try {
          dragging.drag(dx, dy);
        } catch (err) {
          console.error('MathLens drag', err);
        }
        redraw();
        return;
      }
      if (panFrom) {
        const p = plot();
        const from = panFrom.view;
        const shiftX = ((x - panFrom.x) / p.w) * (from.x[1] - from.x[0]);
        const shiftY = ((y - panFrom.y) / p.h) * (from.y[1] - from.y[0]);
        view = { x: [from.x[0] - shiftX, from.x[1] - shiftX], y: [from.y[0] + shiftY, from.y[1] + shiftY] };
        redraw();
        return;
      }
      if (event.pointerType === 'mouse') canvas.style.cursor = handleAt(x, y, false) ? 'grab' : 'move';
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      dragging = null;
      panFrom = null;
      pinchFrom = 0;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('dblclick', reset);
    canvas.addEventListener(
      'wheel',
      (event) => {
        // A trackpad pinch arrives as ctrl+wheel. A plain wheel keeps scrolling the page until you click.
        if (!event.ctrlKey && !event.metaKey && !engaged) return;
        event.preventDefault();
        const [x, y] = local(event);
        const [cx, cy] = toData(x, y);
        zoomAround(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), cx, cy);
      },
      { passive: false },
    );
    canvas.addEventListener('pointerleave', () => {
      engaged = false;
    });

    function resize() {
      const rect = host.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height) || Number(options.height) || 320;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      render();
    }
    new ResizeObserver(resize).observe(host);
    resize();

    const graph = {
      element: host,
      /** Set what to draw. Called again whenever the view changes, so draw from your current values. */
      draw(fn) {
        scene = fn;
        redraw();
        return graph;
      },
      redraw,
      /** Change the starting view for this step: { x: [from, to], y: [from, to], axes: false }.
       *  Calling it again with the same values does nothing, so the reader's zoom survives redraws. */
      setView(next) {
        const wanted = { x: [...(next.x || home.x)], y: [...(next.y || home.y)] };
        const axes = next.axes ?? axesByDefault;
        const same = axes === showAxes && wanted.x.every((n, i) => n === home.x[i]) && wanted.y.every((n, i) => n === home.y[i]);
        if (same) return graph;
        showAxes = axes;
        home = wanted;
        reset();
        return graph;
      },
      reset,
      zoom: (factor) => zoomAround(factor),
    };
    graphs.add(graph);
    return graph;
  }

  // ---- Plotly: use our zoom buttons, keep the reader's zoom while sliders move --------------
  let plotlyLibrary = window.Plotly;
  const plotOf = (target) => (typeof target === 'string' ? document.getElementById(target) : target);
  const LABEL_OFFSETS = [[52, -44], [-74, -36], [64, 40], [-66, 48], [6, -74], [104, -6], [-104, 4], [4, 70]];
  /** Labels starting near the same point would pile up, so fan them out. */
  function spreadLabels(list) {
    if (!Array.isArray(list)) return list;
    const labelled = list.filter((note) => note && note.text && note.showarrow !== false && (!note.axref || note.axref === 'pixel'));
    if (labelled.length < 2) return list;
    return list.map((note) => {
      const index = labelled.indexOf(note);
      if (index < 0) return note;
      const [ax, ay] = LABEL_OFFSETS[index % LABEL_OFFSETS.length];
      return { ...note, ax, ay };
    });
  }
  function tidyLayout(layout) {
    if (layout.annotations) layout.annotations = spreadLabels(layout.annotations);
    for (const key of Object.keys(layout)) {
      if (!/^scene\d*$/.test(key) || !layout[key]) continue;
      const scene = { ...layout[key] };
      if (scene.annotations) scene.annotations = spreadLabels(scene.annotations);
      for (const axis of ['xaxis', 'yaxis', 'zaxis']) {
        scene[axis] = { nticks: 5, tickfont: { size: 10 }, ...(scene[axis] || {}) };
      }
      layout[key] = scene;
      if (layout.margin === undefined) layout.margin = { l: 0, r: 0, t: 0, b: 0 };
    }
    return layout;
  }
  function wrapPlotly(library) {
    if (!library || library.__mlWrapped || typeof library.newPlot !== 'function') return library;
    for (const method of ['newPlot', 'react']) {
      const original = library[method];
      library[method] = function (target, data, layout, config) {
        const figure = data && !Array.isArray(data) && typeof data === 'object' ? data : null;
        const nextLayout = tidyLayout({ ...((figure ? figure.layout : layout) || {}) });
        // Zoom survives slider updates (the uirevision stays the same) and resets on the next step
        if (nextLayout.uirevision === undefined) nextLayout.uirevision = `ml-${window.MathLens.step}`;
        if (nextLayout.dragmode === undefined) nextLayout.dragmode = 'pan';
        const nextConfig = { displaylogo: false, responsive: true, ...((figure ? figure.config : config) || {}), displayModeBar: false, scrollZoom: false };
        const call = figure ? original.call(this, target, { ...figure, layout: nextLayout, config: nextConfig }) : original.call(this, target, data, nextLayout, nextConfig);
        Promise.resolve(call).then(() => {
          attachPlotWheel(plotOf(target));
          scheduleScan();
        });
        return call;
      };
    }
    library.__mlWrapped = true;
    return library;
  }
  Object.defineProperty(window, 'Plotly', {
    configurable: true,
    enumerable: true,
    get: () => plotlyLibrary,
    set: (value) => {
      plotlyLibrary = wrapPlotly(value);
    },
  });
  wrapPlotly(plotlyLibrary);

  function plotCamera(scene) {
    try {
      return scene._scene?.getCamera?.() || scene.camera;
    } catch {
      return scene.camera;
    }
  }
  function plotView(gd) {
    const out = {};
    const full = gd._fullLayout || {};
    for (const key of Object.keys(full)) {
      if (/^[xy]axis\d*$/.test(key) && Array.isArray(full[key].range) && full[key].range.every((n) => Number.isFinite(Number(n)))) {
        out[`${key}.range`] = full[key].range.map(Number);
      }
      if (/^scene\d*$/.test(key) && full[key]) out[`${key}.camera`] = JSON.parse(JSON.stringify(plotCamera(full[key]) || {}));
    }
    return out;
  }
  function zoomPlot(gd, factor) {
    const current = plotView(gd);
    const next = {};
    for (const [key, value] of Object.entries(current)) {
      if (key.endsWith('.range')) {
        const center = (value[0] + value[1]) / 2;
        const half = (value[1] - value[0]) / 2 / factor;
        next[key] = [center - half, center + half];
      } else if (value.eye) {
        const c = value.center || { x: 0, y: 0, z: 0 };
        next[key] = { ...value, eye: { x: c.x + (value.eye.x - c.x) / factor, y: c.y + (value.eye.y - c.y) / factor, z: c.z + (value.eye.z - c.z) / factor } };
      }
    }
    if (Object.keys(next).length) window.Plotly.relayout(gd, next);
  }
  function attachPlotWheel(gd) {
    if (!gd || gd.__mlWheel) return;
    gd.__mlWheel = true;
    let engaged = false;
    gd.addEventListener('pointerdown', () => {
      engaged = true;
    });
    gd.addEventListener('pointerleave', () => {
      engaged = false;
    });
    gd.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey && !event.metaKey && !engaged) return;
        event.preventDefault();
        event.stopPropagation();
        zoomPlot(gd, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)));
      },
      { passive: false, capture: true },
    );
  }

  // ---- Zoom buttons for everything that isn't a MathLens graph ------------------------------
  const targets = new Map(); // element → { bar, kind, level, home }
  const MIN_WIDTH = 170;
  const MIN_HEIGHT = 110;

  function zoomElement(el, state, factor) {
    state.level = Math.min(6, Math.max(1, state.level * factor));
    const box = el.parentElement;
    if (state.level > 1 && !state.frozen && box) {
      // Hold the box at its size, so the enlarged picture scrolls inside it
      const rect = box.getBoundingClientRect();
      state.frozen = { width: box.style.width, height: box.style.height, overflow: box.style.overflow };
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      box.style.overflow = 'auto';
    }
    el.style.zoom = state.level === 1 ? '' : String(state.level);
    if (state.level === 1 && state.frozen && box) {
      Object.assign(box.style, state.frozen);
      state.frozen = null;
    }
  }
  function makeBar(el, kind) {
    const state = { kind, level: 1, home: null, frozen: null };
    const change = (factor) => {
      if (kind === 'plot') {
        state.home = state.home || plotView(el);
        zoomPlot(el, factor);
      } else zoomElement(el, state, factor);
    };
    state.bar = zoomBar({
      in: () => change(1.4),
      out: () => change(1 / 1.4),
      reset: () => {
        if (kind === 'plot') {
          if (state.home && Object.keys(state.home).length) window.Plotly.relayout(el, state.home);
        } else zoomElement(el, state, 0);
      },
    });
    state.bar.classList.add('floating');
    document.body.append(state.bar);
    return state;
  }
  function placeBars() {
    for (const [el, state] of targets) {
      const rect = el.getBoundingClientRect();
      const box = state.level > 1 && el.parentElement ? el.parentElement.getBoundingClientRect() : rect;
      const visible = el.isConnected && rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT;
      state.bar.hidden = !visible;
      if (!visible) continue;
      // Plotly keeps its legend at the top right, so its buttons go at the top left
      const left = state.kind === 'plot' ? box.left + 8 : box.right - state.bar.offsetWidth - 8;
      state.bar.style.left = `${Math.max(2, left + window.scrollX)}px`;
      state.bar.style.top = `${box.top + window.scrollY + 8}px`;
    }
  }
  function scan() {
    const found = [];
    document.querySelectorAll('.js-plotly-plot').forEach((el) => found.push([el, 'plot']));
    document.querySelectorAll('canvas, svg').forEach((el) => {
      if (el.closest('.ml-graph, .js-plotly-plot, .katex, .ml-zoom, button')) return;
      const rect = el.getBoundingClientRect();
      if (rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT) found.push([el, 'element']);
    });
    const keep = new Set();
    for (const [el, kind] of found.slice(0, 4)) {
      keep.add(el);
      if (!targets.has(el)) targets.set(el, makeBar(el, kind));
    }
    for (const [el, state] of targets) {
      if (!keep.has(el) || !el.isConnected) {
        state.bar.remove();
        targets.delete(el);
      }
    }
    placeBars();
  }
  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 150);
  }

  // ---- Words in the lesson light up what they name -------------------------------------------
  function setHighlight(name) {
    highlight = name || null;
    graphs.forEach((graph) => graph.redraw());
    if (!window.Plotly?.restyle) return;
    const wanted = highlight ? colorOf(highlight) : null;
    document.querySelectorAll('.js-plotly-plot').forEach((gd) => {
      const traces = gd.data || [];
      if (!traces.length) return;
      const original = traces.map((trace) => {
        if (trace.__mlOpacity === undefined) trace.__mlOpacity = trace.opacity ?? 1;
        return trace.__mlOpacity;
      });
      const matches = (trace) => [trace.line?.color, trace.marker?.color, trace.color].flat().includes(wanted);
      const any = wanted && traces.some(matches);
      const next = any ? traces.map((trace, i) => (matches(trace) ? original[i] : Math.min(original[i], 0.2))) : original;
      try {
        window.Plotly.restyle(gd, { opacity: next });
      } catch (err) {
        console.error('MathLens highlight', err);
      }
    });
  }

  // ---- Small helpers for the AI's code -------------------------------------------------------
  function animate(duration, draw) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const job = { stop: false };
    animations.add(job);
    const tick = (now) => {
      if (job.stop) return;
      const raw = reduce ? 1 : Math.min(1, (now - start) / Math.max(1, duration));
      const eased = raw < 0.5 ? 2 * raw * raw : 1 - (-2 * raw + 2) ** 2 / 2;
      try {
        draw(eased);
      } catch (err) {
        console.error('MathLens animate', err);
        job.stop = true;
      }
      if (raw < 1 && !job.stop) requestAnimationFrame(tick);
      else animations.delete(job);
    };
    requestAnimationFrame(tick);
    return () => {
      job.stop = true;
    };
  }

  // ---- A visible hint when this page itself scrolls -------------------------------------------
  let scrollHint = null;
  function updateScrollHint() {
    const root = document.documentElement;
    if (!scrollHint) {
      scrollHint = document.createElement('button');
      scrollHint.type = 'button';
      scrollHint.className = 'ml-scroll-hint';
      scrollHint.textContent = 'More below ↓';
      scrollHint.addEventListener('click', () => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }));
      document.body.append(scrollHint);
    }
    const more = root.scrollHeight > window.innerHeight + 12 && window.scrollY + window.innerHeight < root.scrollHeight - 12;
    scrollHint.hidden = !more;
  }

  // ---- Wiring ---------------------------------------------------------------------------------
  document.addEventListener('mathlens:beforestep', () => {
    animations.forEach((job) => {
      job.stop = true;
    });
    animations.clear();
    highlight = null;
    graphs.forEach((graph) => {
      if (graph.element.isConnected) graph.reset();
      else graphs.delete(graph);
    });
    targets.forEach((state, el) => {
      if (state.kind === 'element' && state.level > 1) zoomElement(el, state, 0);
      if (state.kind === 'plot') state.home = null;
    });
  });
  document.addEventListener('mathlens:highlight', (event) => setHighlight(event.detail));

  function start() {
    scan();
    updateScrollHint();
    new MutationObserver(scheduleScan).observe(document.body, { subtree: true, childList: true });
    window.addEventListener('resize', () => {
      scheduleScan();
      updateScrollHint();
    });
    window.addEventListener('scroll', updateScrollHint, { passive: true });
    document.addEventListener('scroll', placeBars, { passive: true, capture: true });
    setInterval(() => {
      placeBars();
      updateScrollHint();
    }, 700);
  }

  // kit.js has already defined window.MathLens
  window.MathLens.graph = createGraph;
  window.MathLens.animate = animate;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
