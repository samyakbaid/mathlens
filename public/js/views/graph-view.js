// Graph Lab: a Desmos-style graphing calculator.
//
// Each row is one line of math:
//   y = a sin(bx)        a curve            f(x) = x^2 - 1    a named function (also drawn)
//   a = 2                a slider           k = 2a            a value computed from others
//   x = 3                a vertical line    (h, k)            a point (drag it if h / k are sliders)
//   2^10                 a calculation, the answer shows under the row
//   z = x^2 - y^2        a surface (3D mode)    (a, b, 2)          a point in 3D
//
// The rows are saved in the URL (#/graph?e=...), so a link reproduces the same graph.

import { Plot, COLORS, alpha } from '../lib/plot.js';
import { onThemeChange } from '../lib/theme.js';
import { SERIES } from '../lib/theme.js';
import { parse } from '../lib/expression.js';
import { readNumber } from '../lib/controls.js';
import { renderMath } from '../lib/markdown.js';
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { format } from '../lib/numeric.js';

const EXAMPLES = {
  parabola: {
    label: 'Parabola: drag the vertex',
    rows: [
      { text: 'y = a(x - h)^2 + k' },
      { text: 'a = 0.5', min: -3, max: 3, step: 0.1 },
      { text: 'h = 1', min: -6, max: 6, step: 0.1 },
      { text: 'k = -2', min: -6, max: 6, step: 0.1 },
      { text: '(h, k)' },
    ],
  },
  waves: {
    label: 'Waves: amplitude, frequency, phase',
    rows: [
      { text: 'y = a sin(bx + c)' },
      { text: 'a = 2', min: 0, max: 4, step: 0.1 },
      { text: 'b = 1', min: 0, max: 5, step: 0.1 },
      { text: 'c = 0', min: -3.14, max: 3.14, step: 0.01 },
      { text: 'y = a sin(bx)' },
    ],
  },
  line: {
    label: 'Lines: slope and intercept',
    rows: [
      { text: 'y = mx + b' },
      { text: 'm = 1', min: -5, max: 5, step: 0.1 },
      { text: 'b = 1', min: -5, max: 5, step: 0.1 },
      { text: '(0, b)' },
      { text: '(-b/m, 0)' },
    ],
  },
  taylor: {
    label: 'Taylor polynomials of sin(x)',
    rows: [
      { text: 'y = sin(x)' },
      { text: 'y = x' },
      { text: 'y = x - x^3/6' },
      { text: 'y = x - x^3/6 + x^5/120' },
      { text: 'y = x - x^3/6 + x^5/120 - x^7/5040' },
    ],
  },
  bowl: {
    label: '3D: a bowl you can reshape',
    mode: '3d',
    rows: [
      { text: 'z = a(x^2 + y^2)' },
      { text: 'a = 0.3', min: -1, max: 1, step: 0.05 },
    ],
  },
  saddle: {
    label: '3D: a saddle',
    mode: '3d',
    rows: [
      { text: 'z = (x^2 - y^2)/4' },
      { text: '(0, 0, 0)' },
    ],
  },
  ripples: {
    label: '3D: ripples (press play on t)',
    mode: '3d',
    rows: [
      { text: 'z = cos(sqrt(x^2 + y^2) - t)' },
      { text: 't = 0', min: 0, max: 6.28, step: 0.01 },
    ],
  },
  tangent: {
    label: '3D: the tangent plane at a point',
    mode: '3d',
    rows: [
      { text: 'z = (x^2 + y^2)/4' },
      { text: 'z = (p^2 + q^2)/4 + (p/2)(x - p) + (q/2)(y - q)' },
      { text: 'p = 1', min: -4, max: 4, step: 0.1 },
      { text: 'q = 1', min: -4, max: 4, step: 0.1 },
      { text: '(p, q, (p^2 + q^2)/4)' },
    ],
  },
  growth: {
    label: 'Exponential growth and logs',
    rows: [
      { text: 'f(x) = a e^(kx)' },
      { text: 'a = 1', min: 0.1, max: 5, step: 0.1 },
      { text: 'k = 0.5', min: -2, max: 2, step: 0.05 },
      { text: 'y = ln(x)' },
      { text: 'f(2)' },
    ],
  },
};

const RESERVED = new Set(['x', 'y', 'z', 'e', 'pi']);
const PLOTLY_URL = 'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js';
const RANGES_3D = [2, 5, 10, 20];

export function showGraphPage(view, { encoded, mode: initialMode } = {}) {
  view.innerHTML = `
    <div class="graph-page">
      <aside class="graph-panel">
        <div class="graph-panel-head">
          <h1>Graph Lab</h1>
          <div class="mode-switch" role="group" aria-label="2D or 3D">
            <button type="button" data-mode="2d">2D</button>
            <button type="button" data-mode="3d">3D</button>
          </div>
          <div class="button-row">
            <select class="btn small graph-examples" aria-label="Load an example"></select>
            <button class="btn small graph-share" type="button" title="Copy a link to this graph">Share</button>
          </div>
        </div>
        <div class="graph-rows"></div>
        <div class="graph-add"><button class="btn small" type="button">+ Add expression</button></div>
        <div class="graph-panel-foot">
          <span class="foot-2d">Try <code>y = 2x + 1</code>, <code>f(x) = x^3 - x</code>, <code>a = 3</code>, <code>(1, 2)</code> or <code>sqrt(2)</code>.
          A letter you haven't defined becomes a slider. Scroll on the graph to zoom, drag to move around, and hover a curve to read its values.</span>
          <span class="foot-3d">Try <code>z = x^2 - y^2</code>, <code>z = sin(x)cos(y)</code> or a point like <code>(1, 2, 3)</code>.
          Drag to turn the graph, scroll to zoom, and hover the surface to read x, y and z.</span>
        </div>
      </aside>
      <section class="graph-plot">
        <div class="graph-3d" hidden></div>
        <div class="graph-3d-tools" hidden>
          <label>Range <select aria-label="How far the x and y axes go"></select></label>
          <button class="btn small" type="button" data-action="camera">Reset view</button>
        </div>
      </section>
    </div>
  `;

  const rowsBox = view.querySelector('.graph-rows');
  const plot = new Plot(view.querySelector('.graph-plot'), { xMin: -8, xMax: 8, yMin: -6, yMax: 6 }, { height: '100%', equalAspect: true });
  plot.trackPointer = true;
  plot.alwaysScrollZoom = true; // the graph fills the page, so plain scrolling zooms right away

  let rows = [];
  let nextId = 1;
  let colorCounter = 0;
  let model = { rows: new Map(), env: { vars: {}, fns: {} } };
  let saveTimer = null;
  let playFrame = null;
  let lastPlayTime = 0;
  let mode = initialMode === '3d' ? '3d' : '2d';
  let range3d = 5;
  let render3dQueued = false;
  const graphArea = view.querySelector('.graph-plot');
  const plot3d = view.querySelector('.graph-3d');
  const tools3d = view.querySelector('.graph-3d-tools');
  const modeButtons = [...view.querySelectorAll('.mode-switch button')];

  // ---- 2D / 3D ----------------------------------------------------------------------------
  function setMode(next) {
    mode = next === '3d' ? '3d' : '2d';
    modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    graphArea.classList.toggle('is-3d', mode === '3d');
    plot.wrap.hidden = mode === '3d';
    plot3d.hidden = tools3d.hidden = mode !== '3d';
    view.querySelector('.graph-panel').classList.toggle('is-3d', mode === '3d');
    rows.forEach(updateRowView);
    if (mode === '3d') render3d();
    else plot.render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToUrl, 200);
  }
  modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));

  const rangeSelect = tools3d.querySelector('select');
  for (const r of RANGES_3D) rangeSelect.append(new Option(`±${r}`, String(r)));
  rangeSelect.value = String(range3d);
  rangeSelect.addEventListener('change', () => {
    range3d = Number(rangeSelect.value);
    render3d();
  });
  tools3d.querySelector('[data-action="camera"]').addEventListener('click', () => {
    window.Plotly?.relayout(plot3d, { 'scene.camera': defaultCamera() });
  });

  /** Draw the 3D view (at most once per frame, so dragging a slider stays smooth). */
  function render3d() {
    if (mode !== '3d' || render3dQueued) return;
    render3dQueued = true;
    requestAnimationFrame(async () => {
      render3dQueued = false;
      try {
        if (!window.Plotly) {
          plot3d.dataset.loading = 'Loading the 3D view…';
          await loadScript(PLOTLY_URL);
          delete plot3d.dataset.loading;
        }
        window.Plotly.react(plot3d, traces3d(), layout3d(), { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['toImage', 'resetCameraLastSave3d'] });
      } catch {
        plot3d.dataset.loading = "The 3D view couldn't load. Check your internet connection.";
      }
    });
  }

  function traces3d() {
    const N = 64;
    const xs = Array.from({ length: N }, (_, i) => -range3d + (2 * range3d * i) / (N - 1));
    const traces = [];
    for (const row of rows) {
      const info = model.rows.get(row.id);
      if (!info || info.error || row.hidden) continue;
      const color = COLORS[row.color];
      if (info.kind === 'surface') {
        const z = xs.map((y) =>
          xs.map((x) => {
            let v;
            try {
              v = info.f2(x, y);
            } catch {
              v = NaN;
            }
            return Number.isFinite(v) && Math.abs(v) < 1e4 ? v : null;
          }),
        );
        traces.push({
          type: 'surface',
          x: xs,
          y: xs,
          z,
          name: row.text,
          showscale: false,
          opacity: 0.94,
          colorscale: [[0, mixColors(color, COLORS.background, 0.35)], [1, color]],
          contours: { z: { show: true, usecolormap: false, color: alpha(COLORS.text, 0.22), width: 1 } },
          lighting: { ambient: 0.75, diffuse: 0.6, specular: 0.08, roughness: 0.9 },
          hovertemplate: 'x = %{x:.2f}<br>y = %{y:.2f}<br>z = %{z:.3f}<extra></extra>',
        });
      } else if (info.kind === 'point3') {
        const [x, y, z] = info.point3(model.env);
        if (![x, y, z].every(Number.isFinite)) continue;
        traces.push({
          type: 'scatter3d',
          mode: 'markers+text',
          x: [x],
          y: [y],
          z: [z],
          text: [`(${format(x, 2)}, ${format(y, 2)}, ${format(z, 2)})`],
          textposition: 'top center',
          textfont: { color: COLORS.text, size: 12 },
          marker: { size: 6, color, line: { color: COLORS.background, width: 2 } },
          hovertemplate: 'x = %{x:.2f}<br>y = %{y:.2f}<br>z = %{z:.3f}<extra></extra>',
        });
      }
    }
    return traces;
  }

  function layout3d() {
    const axis = (title) => ({
      title: { text: title, font: { size: 14 } },
      range: title === 'z' ? undefined : [-range3d, range3d],
      gridcolor: COLORS.grid,
      zerolinecolor: COLORS.axis,
      showbackground: true,
      backgroundcolor: alpha(COLORS.gridMinor, 0.6),
      color: COLORS.label,
      tickfont: { family: '"IBM Plex Mono", monospace', size: 11 },
    });
    return {
      paper_bgcolor: COLORS.background,
      plot_bgcolor: COLORS.background,
      font: { family: '"IBM Plex Sans", system-ui, sans-serif', color: COLORS.text },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      showlegend: false,
      uirevision: 'graph-lab-3d', // keep the camera where the reader left it while things change
      scene: { aspectmode: 'cube', xaxis: axis('x'), yaxis: axis('y'), zaxis: axis('z'), camera: defaultCamera() },
    };
  }

  const stopWatchingTheme = onThemeChange(() => render3d());

  // ---- Examples + share ------------------------------------------------------------
  const exampleSelect = view.querySelector('.graph-examples');
  exampleSelect.append(new Option('Examples…', ''));
  for (const [key, example] of Object.entries(EXAMPLES)) exampleSelect.append(new Option(example.label, key));
  exampleSelect.addEventListener('change', () => {
    if (!exampleSelect.value) return;
    loadRows(EXAMPLES[exampleSelect.value].rows);

    const example = EXAMPLES[exampleSelect.value];
    exampleSelect.value = '';
    plot.resetView();
    setMode(example.mode ?? '2d');
  });

  const shareButton = view.querySelector('.graph-share');
  shareButton.addEventListener('click', async () => {
    saveToUrl();
    try {
      await navigator.clipboard.writeText(location.href);
      shareButton.textContent = 'Link copied';
    } catch {
      shareButton.textContent = 'Copy the URL';
    }
    setTimeout(() => (shareButton.textContent = 'Share'), 1600);
  });

  view.querySelector('.graph-add button').addEventListener('click', () => {
    const row = addRow({ text: '' });
    focusRow(row);
  });

  // ---- Rows ------------------------------------------------------------------------
  function createRow({ text = '', color, hidden = false, min, max, step }) {
    const row = {
      id: nextId++,
      text,
      color: color && SERIES.includes(color) ? color : leastUsedColor(),
      hidden,
      slider: { min: min ?? -10, max: max ?? 10, step: step ?? 0.1 },
      playing: false,
      direction: 1,
    };

    const node = el('div', 'expr-row');
    const index = el('div', 'expr-index');
    const swatch = el('button', 'expr-swatch');
    swatch.type = 'button';
    swatch.title = 'Show / hide';
    index.append(swatch);

    const main = el('div', 'expr-main');
    const tex = el('div', 'expr-tex');
    const input = el('input', 'expr-input');
    Object.assign(input, { type: 'text', value: text, spellcheck: false, autocomplete: 'off', placeholder: 'Type an equation…' });
    input.setAttribute('aria-label', 'Expression');
    const value = el('div', 'expr-value');
    const error = el('div', 'expr-error');
    const chips = el('div', 'expr-chips');
    const sliderBox = el('div', 'expr-slider');
    sliderBox.hidden = true;
    main.append(tex, input, value, error, chips, sliderBox);

    const remove = el('button', 'expr-delete');
    remove.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
    remove.type = 'button';
    remove.title = 'Delete';
    node.append(index, main, remove);

    // Slider UI: ▶  min  ───●───  max
    const play = el('button', 'expr-play');
    play.innerHTML = icon('play', 12);
    play.type = 'button';
    play.title = 'Play / pause';
    const minBox = el('input', 'bound');
    const maxBox = el('input', 'bound');
    const range = el('input');
    range.type = 'range';
    minBox.setAttribute('aria-label', 'Slider minimum');
    maxBox.setAttribute('aria-label', 'Slider maximum');
    sliderBox.append(play, minBox, range, maxBox);

    row.ui = { node, swatch, tex, input, value, error, chips, sliderBox, range, minBox, maxBox, play };

    // Events
    swatch.addEventListener('click', () => {
      row.hidden = !row.hidden;
      refresh();
    });
    remove.addEventListener('click', () => removeRow(row));
    tex.addEventListener('click', () => focusRow(row));
    input.addEventListener('focus', () => {
      node.classList.add('focused');
      node.classList.remove('show-tex');
    });
    input.addEventListener('blur', () => {
      node.classList.remove('focused');
      updateRowView(row);
    });
    input.addEventListener('input', () => {
      row.text = input.value;
      refresh();
    });
    input.addEventListener('keydown', (event) => onRowKey(event, row));

    range.addEventListener('input', () => {
      row.playValue = undefined;
      setSliderValue(row, Number(range.value));
    });
    const readBound = (box, key) => {
      const v = readNumber(box.value);
      if (Number.isFinite(v)) row.slider[key] = v;
      if (row.slider.min >= row.slider.max) row.slider.max = row.slider.min + 1;
      refresh();
    };
    minBox.addEventListener('change', () => readBound(minBox, 'min'));
    maxBox.addEventListener('change', () => readBound(maxBox, 'max'));
    play.addEventListener('click', () => {
      row.playing = !row.playing;
      row.playValue = undefined;
      updateRowView(row);
      startPlaying();
    });

    return row;
  }

  /** The series colour used by the fewest rows, so new rows look different from old ones. */
  function leastUsedColor() {
    const counts = new Map(SERIES.map((c) => [c, 0]));
    rows.forEach((row) => counts.set(row.color, (counts.get(row.color) ?? 0) + 1));
    const fewest = Math.min(...counts.values());
    const start = colorCounter++ % SERIES.length;
    return [...SERIES.slice(start), ...SERIES.slice(0, start)].find((c) => counts.get(c) === fewest);
  }

  function addRow(options, afterRow = null) {
    const row = createRow(options);
    const index = afterRow ? rows.indexOf(afterRow) + 1 : rows.length;
    rows.splice(index, 0, row);
    const before = rows[index + 1]?.ui.node ?? null;
    rowsBox.insertBefore(row.ui.node, before);
    refresh();
    return row;
  }

  function removeRow(row) {
    const index = rows.indexOf(row);
    rows.splice(index, 1);
    row.ui.node.remove();
    if (rows.length === 0) addRow({ text: '' });
    refresh();
    return rows[Math.max(0, index - 1)];
  }

  function loadRows(list) {
    rows.forEach((row) => row.ui.node.remove());
    rows = [];
    colorCounter = 0;
    for (const options of list) {
      const row = createRow(options);
      rows.push(row);
      rowsBox.append(row.ui.node);
    }
    if (rows.length === 0) {
      const row = createRow({ text: '' });
      rows.push(row);
      rowsBox.append(row.ui.node);
    }
    refresh();
  }

  function focusRow(row) {
    row.ui.node.classList.remove('show-tex');
    row.ui.input.focus();
    const end = row.ui.input.value.length;
    row.ui.input.setSelectionRange(end, end);
  }

  function onRowKey(event, row) {
    const index = rows.indexOf(row);
    if (event.key === 'Enter') {
      event.preventDefault();
      focusRow(addRow({ text: '' }, row));
    } else if (event.key === 'Backspace' && row.ui.input.value === '' && rows.length > 1) {
      event.preventDefault();
      focusRow(removeRow(row));
    } else if (event.key === 'ArrowDown' && rows[index + 1]) {
      event.preventDefault();
      focusRow(rows[index + 1]);
    } else if (event.key === 'ArrowUp' && rows[index - 1]) {
      event.preventDefault();
      focusRow(rows[index - 1]);
    }
  }

  /** Write a slider's new value into its row text ("a = 1.3"). Extra digits keep animation smooth. */
  function setSliderValue(row, v, extraDigits = 0) {
    const info = model.rows.get(row.id);
    if (!info?.name) return;
    const step = row.slider.step;
    const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) - 1e-9) + extraDigits));
    row.text = `${info.name} = ${Number(v.toFixed(decimals))}`;
    row.ui.input.value = row.text;
    refresh();
  }

  // ---- Understanding the rows -------------------------------------------------------
  /** Work out what every row means, evaluate variables and functions, and redraw. */
  function refresh() {
    model = analyze(rows);
    rows.forEach(updateRowView);
    registerDraggables();
    if (mode === '3d') render3d();
    else plot.render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToUrl, 400);
  }

  function updateRowView(row) {
    const info = model.rows.get(row.id) ?? {};
    const ui = row.ui;
    const focused = document.activeElement === ui.input;
    ui.node.style.setProperty('--swatch', COLORS[row.color]);
    const is3d = ['surface', 'point3'].includes(info.kind);
    const is2d = ['curve', 'function', 'point', 'vertical'].includes(info.kind);
    const drawable = mode === '3d' ? is3d : is2d;
    ui.swatch.style.visibility = drawable ? 'visible' : 'hidden';
    ui.swatch.classList.toggle('hidden-series', row.hidden);

    ui.error.textContent = info.error ?? '';
    const elsewhere = mode === '3d' ? is2d && 'Drawn in the 2D view' : is3d && 'Drawn in the 3D view. Switch to 3D at the top.';
    ui.value.textContent = info.valueText ?? (info.error ? '' : elsewhere || '');

    // "+ add slider" buttons for letters that aren't defined yet.
    // Rebuilt only when the list changes, so a click isn't lost to a re-render.
    const missingKey = (info.missing ?? []).join(',');
    if (ui.chips.dataset.key !== missingKey) {
      ui.chips.dataset.key = missingKey;
      ui.chips.replaceChildren();
      for (const name of info.missing ?? []) {
        const chip = el('button', 'expr-chip', `+ add slider: ${name}`);
        chip.type = 'button';
        chip.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the row
        chip.addEventListener('click', () => addRow({ text: `${name} = 1` }, row));
        ui.chips.append(chip);
      }
    }

    // Typeset preview when not editing
    const texSource = info.tex ?? null;
    ui.tex.innerHTML = texSource ? renderMath(texSource) : '';
    ui.node.classList.toggle('show-tex', Boolean(texSource) && !focused && !info.error);

    // Slider
    const isSlider = info.kind === 'slider';
    ui.sliderBox.hidden = !isSlider;
    if (isSlider) {
      const value = info.value;
      if (value < row.slider.min) row.slider.min = value;
      if (value > row.slider.max) row.slider.max = value;
      Object.assign(ui.range, { min: row.slider.min, max: row.slider.max, step: row.slider.step });
      ui.range.value = value;
      if (document.activeElement !== ui.minBox) ui.minBox.value = format(row.slider.min, 4);
      if (document.activeElement !== ui.maxBox) ui.maxBox.value = format(row.slider.max, 4);
    } else {
      row.playing = false;
    }
    ui.play.innerHTML = icon(row.playing ? 'pause' : 'play', 12);
    ui.play.classList.toggle('playing', row.playing);
  }

  // ---- Drawing ----------------------------------------------------------------------
  plot.onDraw = (p) => {
    p.grid();
    const env = model.env;
    const curves = [];

    for (const row of rows) {
      const info = model.rows.get(row.id);
      if (!info || info.error || row.hidden) continue;
      const color = COLORS[row.color];

      if (info.kind === 'curve' || info.kind === 'function') {
        const f = info.f;
        p.curve(f, { color, width: 2.75 });
        curves.push({ f, color });
      } else if (info.kind === 'vertical') {
        p.verticalLine(info.value, { color, width: 2.5 });
      } else if (info.kind === 'point') {
        const [x, y] = info.point(env);
        p.point(x, y, { color, radius: info.draggable ? 7 : 5.5, ring: info.draggable });
        p.text(`(${format(x, 2)}, ${format(y, 2)})`, x, y, { color: COLORS.muted, font: '12px "IBM Plex Sans", system-ui, sans-serif', offset: [10, -8] });
      }
    }

    // Trace: show the coordinates on the curve nearest the mouse
    if (p.pointer && !p.activeDrag) {
      const [mx, my] = p.pointer;
      let best = null;
      for (const curve of curves) {
        let y;
        try {
          y = curve.f(mx);
        } catch {
          continue;
        }
        if (!Number.isFinite(y)) continue;
        const distance = Math.abs(p.toScreenY(y) - p.toScreenY(my));
        if (distance < 14 && (!best || distance < best.distance)) best = { y, distance, color: curve.color };
      }
      if (best) {
        p.point(mx, best.y, { color: best.color, radius: 6, ring: true });
        p.text(`(${format(mx, 3)}, ${format(best.y, 3)})`, mx, best.y, { color: COLORS.text, offset: [10, -10] });
      }
    }
  };

  function registerDraggables() {
    plot.draggables = [];
    for (const row of rows) {
      const info = model.rows.get(row.id);
      if (!info || info.kind !== 'point' || !info.draggable || row.hidden) continue;
      plot.addDraggable({
        get: () => info.point(model.env),
        set: (x, y) => {
          for (const [name, value] of [[info.xVar, x], [info.yVar, y]]) {
            if (!name) continue;
            const slider = rows.find((r) => model.rows.get(r.id)?.name === name && model.rows.get(r.id)?.kind === 'slider');
            if (!slider) continue;
            slider.playValue = undefined;
            setSliderValue(slider, Math.round(value / slider.slider.step) * slider.slider.step);
          }
        },
      });
    }
  }

  // ---- Playing sliders ----------------------------------------------------------------
  function startPlaying() {
    if (playFrame) return;
    lastPlayTime = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - lastPlayTime) / 1000);
      lastPlayTime = now;
      const playing = rows.filter((row) => row.playing);
      if (playing.length === 0) {
        playFrame = null;
        return;
      }
      for (const row of playing) {
        const info = model.rows.get(row.id);
        if (info?.kind !== 'slider') continue;
        const { min, max } = row.slider;
        let v = (row.playValue ?? info.value) + row.direction * (max - min) * 0.25 * dt; // a full sweep takes 4 s
        if (v > max) [v, row.direction] = [max, -1];
        if (v < min) [v, row.direction] = [min, 1];
        row.playValue = v;
        setSliderValue(row, v, 2);
      }
      playFrame = requestAnimationFrame(tick);
    };
    playFrame = requestAnimationFrame(tick);
  }

  // ---- Saving -----------------------------------------------------------------------------
  function saveToUrl() {
    const data = rows.map((row) => {
      const item = { t: row.text, c: row.color };
      if (row.hidden) item.h = 1;
      if (model.rows.get(row.id)?.kind === 'slider') Object.assign(item, { mn: row.slider.min, mx: row.slider.max, s: row.slider.step });
      return item;
    });
    const url = `#/graph?e=${encodeURIComponent(JSON.stringify(data))}${mode === '3d' ? '&m=3d' : ''}`;
    if (location.hash !== url) history.replaceState(null, '', url);
  }

  function rowsFromUrl(text) {
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) return null;
      return data.slice(0, 100).map((item) => ({
        text: String(item.t ?? '').slice(0, 500),
        color: item.c,
        hidden: Boolean(item.h),
        min: Number.isFinite(item.mn) ? item.mn : undefined,
        max: Number.isFinite(item.mx) ? item.mx : undefined,
        step: Number.isFinite(item.s) && item.s > 0 ? item.s : undefined,
      }));
    } catch {
      return null;
    }
  }

  loadRows((encoded && rowsFromUrl(encoded)) || (mode === '3d' ? EXAMPLES.bowl.rows : EXAMPLES.parabola.rows));
  setMode(mode);

  return () => {
    cancelAnimationFrame(playFrame);
    clearTimeout(saveTimer);
    stopWatchingTheme();
    if (window.Plotly) window.Plotly.purge(plot3d);
    plot.destroy();
  };
}

// ---- Analysis: what does each row mean? --------------------------------------------------

/**
 * Classifies each row, parses it, resolves variables (sliders and computed values) and
 * user functions, and returns, per row, what to draw or show.
 */
function analyze(rows) {
  const result = new Map();
  const variableRows = new Map(); // name → { row, body }
  const functionRows = new Map(); // name → { row, param, body }

  // Pass 1: find definitions
  const classified = rows.map((row) => {
    const text = row.text.trim();
    if (!text) return { row, kind: 'empty' };

    let m = /^([a-z])\s*\(\s*([a-z])\s*\)\s*=(.*)$/i.exec(text);
    if (m && !RESERVED.has(m[1].toLowerCase())) {
      const name = m[1].toLowerCase();
      if (functionRows.has(name)) return { row, kind: 'error', error: `${name}(…) is already defined above` };
      const entry = { row, kind: 'function', name, param: m[2].toLowerCase(), body: m[3] };
      functionRows.set(name, entry);
      return entry;
    }
    m = /^([a-z]|theta)\s*=(.*)$/i.exec(text);
    if (m && !RESERVED.has(m[1].toLowerCase())) {
      const name = m[1].toLowerCase();
      if (variableRows.has(name)) return { row, kind: 'error', error: `${name} is already defined above` };
      const entry = { row, kind: 'variable', name, body: m[2] };
      variableRows.set(name, entry);
      return entry;
    }
    m = /^z\s*=(.*)$/i.exec(text);
    if (m) return { row, kind: 'surface', body: m[1] };
    m = /^y\s*=(.*)$/i.exec(text);
    if (m) return { row, kind: 'curve', body: m[1] };
    m = /^x\s*=(.*)$/i.exec(text);
    if (m) return { row, kind: 'vertical', body: m[1] };
    if (text.startsWith('(') && text.endsWith(')')) {
      const parts = splitTopLevel(text.slice(1, -1));
      if (parts.length === 2) return { row, kind: 'point', parts };
      if (parts.length === 3) return { row, kind: 'point3', parts };
    }
    if (text.includes('=')) return { row, kind: 'error', error: 'Write y = …, z = …, f(x) = …, a = … or x = …' };
    return { row, kind: 'expression', body: text };
  });

  const functionNames = [...functionRows.keys()];
  const env = { vars: {}, fns: {} };
  const parsed = new Map(); // entry → parse result or Error

  const parseBody = (entry, body) => {
    try {
      const p = parse(body, { functionNames });
      parsed.set(entry, p);
      return p;
    } catch (err) {
      parsed.set(entry, err);
      return err;
    }
  };

  // User functions read variables from env.vars at call time
  for (const entry of functionRows.values()) {
    const p = parseBody(entry, entry.body);
    if (p instanceof Error) continue;
    if (p.functions.has(entry.name)) {
      parsed.set(entry, new Error(`${entry.name}(x) can't use itself`));
      continue;
    }
    const local = { vars: env.vars, fns: env.fns };
    const param = entry.param;
    env.fns[entry.name] = (t) => {
      const saved = local.vars[param];
      local.vars[param] = t;
      const value = p.evaluate(local);
      local.vars[param] = saved;
      return value;
    };
  }

  // Variables: resolve in dependency order, detecting cycles and undefined names
  const state = new Map(); // name → 'busy' | 'done'
  const resolve = (name) => {
    const entry = variableRows.get(name);
    if (!entry) return;
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'busy') throw new Error(`${name} depends on itself`);
    state.set(name, 'busy');
    const p = parsed.get(entry) ?? parseBody(entry, entry.body);
    if (!(p instanceof Error)) {
      for (const dep of p.variables) {
        if (dep === name) throw new Error(`${name} can't use itself`);
        resolve(dep);
      }
      env.vars[name] = p.evaluate(env);
    }
    state.set(name, 'done');
  };
  for (const [name, entry] of variableRows) {
    try {
      resolve(name);
    } catch (err) {
      parsed.set(entry, err);
      env.vars[name] = NaN;
      state.set(name, 'done');
    }
  }

  const isDefined = (name, local = []) => name in env.vars || local.includes(name);
  const missingNames = (p, local) => [...p.variables].filter((v) => !isDefined(v, local) && !RESERVED.has(v));

  // Pass 2: what each row shows
  for (const entry of classified) {
    const { row, kind } = entry;
    const info = { kind };
    result.set(row.id, info);
    if (kind === 'empty') continue;
    if (kind === 'error') {
      info.error = entry.error;
      continue;
    }

    try {
      if (kind === 'variable') {
        const p = parsed.get(entry);
        if (p instanceof Error) throw p;
        info.name = entry.name;
        const literal = Number(entry.body.trim());
        const missing = missingNames(p);
        if (missing.length) Object.assign(info, { missing, error: `${missing.join(', ')} not defined` });
        if (Number.isFinite(literal) && entry.body.trim() !== '') {
          Object.assign(info, { kind: 'slider', value: literal });
        } else {
          info.valueText = `= ${format(env.vars[entry.name], 6)}`;
        }
        info.tex = `${texName(entry.name)} = ${p.tex}`;
      } else if (kind === 'function') {
        const p = parsed.get(entry);
        if (p instanceof Error) throw p;
        const missing = missingNames(p, [entry.param]);
        if (missing.length) Object.assign(info, { missing, error: `${missing.join(', ')} not defined` });
        info.f = env.fns[entry.name];
        info.tex = `${entry.name}\\left(${texName(entry.param)}\\right) = ${p.tex}`;
      } else if (kind === 'surface' || (kind === 'expression' && /\by\b/i.test(entry.body) && parseBody(entry, entry.body)?.variables?.has('y'))) {
        const p = parsed.get(entry) ?? parseBody(entry, entry.body);
        if (p instanceof Error) throw p;
        const missing = missingNames(p, ['x', 'y']);
        if (missing.length) Object.assign(info, { missing, error: `${missing.join(', ')} not defined` });
        info.kind = 'surface';
        const local = { vars: Object.create(env.vars), fns: env.fns };
        info.f2 = (x, y) => {
          local.vars.x = x;
          local.vars.y = y;
          return p.evaluate(local);
        };
        info.tex = kind === 'surface' ? `z = ${p.tex}` : p.tex;
      } else if (kind === 'curve' || kind === 'expression') {
        const p = parseBody(entry, entry.body);
        if (p instanceof Error) throw p;
        const usesX = p.variables.has('x');
        const missing = missingNames(p, ['x']);
        if (missing.length) Object.assign(info, { missing, error: `${missing.join(', ')} not defined` });
        if (kind === 'curve' || usesX) {
          info.kind = 'curve';
          const local = { vars: Object.create(env.vars), fns: env.fns };
          info.f = (x) => {
            local.vars.x = x;
            return p.evaluate(local);
          };
          info.tex = kind === 'curve' ? `y = ${p.tex}` : p.tex;
        } else {
          info.kind = 'value';
          info.valueText = `= ${format(p.evaluate(env), 8)}`;
          info.tex = p.tex;
        }
      } else if (kind === 'vertical') {
        const p = parseBody(entry, entry.body);
        if (p instanceof Error) throw p;
        if (p.variables.has('x') || p.variables.has('y')) throw new Error('x = … needs a number, like x = 2');
        const missing = missingNames(p);
        if (missing.length) Object.assign(info, { missing, error: `${missing.join(', ')} not defined` });
        info.value = p.evaluate(env);
        info.tex = `x = ${p.tex}`;
      } else if (kind === 'point3') {
        const coordinates = entry.parts.map((part) => parse(part, { functionNames }));
        const missing = [...new Set(coordinates.flatMap((c) => missingNames(c)))];
        if (missing.length) Object.assign(info, { missing, error: `${missing.join(', ')} not defined` });
        info.point3 = (e) => coordinates.map((c) => c.evaluate(e));
        info.tex = `\\left(${coordinates.map((c) => c.tex).join(', ')}\\right)`;
      } else if (kind === 'point') {
        const [px, py] = entry.parts.map((part) => parse(part, { functionNames }));
        const missing = [...new Set([...missingNames(px), ...missingNames(py)])];
        if (missing.length) Object.assign(info, { missing, error: `${missing.join(', ')} not defined` });
        info.point = (e) => [px.evaluate(e), py.evaluate(e)];
        // Draggable along any coordinate that is just a slider's name, like (h, k) or (a, 2)
        const sliderName = (part) => {
          const name = part.trim().toLowerCase();
          const def = variableRows.get(name);
          return def && Number.isFinite(Number(def.body.trim())) ? name : null;
        };
        info.xVar = sliderName(entry.parts[0]);
        info.yVar = sliderName(entry.parts[1]);
        info.draggable = Boolean(info.xVar || info.yVar);
        info.tex = `\\left(${px.tex}, ${py.tex}\\right)`;
      }
    } catch (err) {
      info.error = err.message;
    }
  }

  return { rows: result, env };
}

/** Split "a, f(b, c)" at top-level commas → ["a", "f(b, c)"]. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

function texName(name) {
  return name === 'theta' ? '\\theta' : name;
}

function defaultCamera() {
  return { eye: { x: 1.55, y: -1.55, z: 1.05 }, up: { x: 0, y: 0, z: 1 } };
}

/** Blend two hex colours: t = 0 gives a, t = 1 gives b. */
function mixColors(a, b, t) {
  const parse = (hex) => {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  try {
    const [r1, g1, b1] = parse(a);
    const [r2, g2, b2] = parse(b);
    const mix = (u, v) => Math.round(u + (v - u) * t);
    return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
  } catch {
    return a;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded) return resolve();
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => {
      script.dataset.loaded = '1';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)));
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.append(script);
    }
  });
}
