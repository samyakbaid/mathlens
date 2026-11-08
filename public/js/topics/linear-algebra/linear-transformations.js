// Linear transformations of the plane: a matrix is "where î and ĵ land".
// Grid, letter F, unit square (determinant) and a vector built from the new basis vectors.

import { Plot, COLORS, alpha } from '../../lib/plot.js';
import { addHeading, addSelect, addSlider, addCheckbox, addReadout, addButtons, addNote, addMatrixInput, addSteps } from '../../lib/controls.js';
import { createAnimator } from '../../lib/animate.js';
import { format } from '../../lib/numeric.js';
import {
  IDENTITY, apply, det, inverse, lerpMatrix, rotation, matrixTex,
  drawTransformedGrid, drawBasisVectors, drawUnitSquare, drawLetterF,
} from '../../lib/linalg.js';

const PRESETS = {
  identity: { label: 'Identity (do nothing)', m: IDENTITY },
  shear: { label: 'Shear', m: { a: 1, b: 1, c: 0, d: 1 } },
  rotate90: { label: 'Rotate 90°', m: { a: 0, b: -1, c: 1, d: 0 } },
  rotate30: { label: 'Rotate 30°', m: rotation(Math.PI / 6) },
  stretch: { label: 'Stretch x, squash y', m: { a: 2, b: 0, c: 0, d: 0.5 } },
  scale: { label: 'Scale everything ×1.5', m: { a: 1.5, b: 0, c: 0, d: 1.5 } },
  reflect: { label: 'Reflect across the y-axis', m: { a: -1, b: 0, c: 0, d: 1 } },
  general: { label: 'A general matrix', m: { a: 1.5, b: 0.5, c: 0.25, d: 1.25 } },
  collapse: { label: 'Squash onto a line (det 0)', m: { a: 1, b: 2, c: 0.5, d: 1 } },
};

export default {
  id: 'linear-transformations',
  title: 'Linear Transformations',
  category: 'Linear Algebra',
  level: 'Foundations',
  summary: 'Think of a matrix as a way of moving the whole plane. Where two arrows land decides everything.',

  explanation: String.raw`
## A matrix is a movement of space
Forget rows of numbers for a moment. A $2 \times 2$ matrix is an instruction for moving **every point of the plane at once**. A movement counts as a *linear* transformation when

- grid lines stay straight and parallel,
- they stay **evenly spaced**, and
- the **origin stays fixed**.

## The columns tell you where î and ĵ land
Every vector is a combination of the two basis vectors: $\mathbf v = (x, y) = x\,\hat\imath + y\,\hat\jmath$. A linear transformation keeps that recipe, it just uses the moved arrows:

$$A\mathbf v = x\,(A\hat\imath) + y\,(A\hat\jmath).$$

So you only need to know two things, where $\hat\imath$ lands and where $\hat\jmath$ lands. Write them as the columns of a matrix and you get the usual rule:

$$\begin{bmatrix} \htmlClass{c-green}{a} & \htmlClass{c-red}{b} \\ \htmlClass{c-green}{c} & \htmlClass{c-red}{d} \end{bmatrix}\begin{bmatrix} x \\ y \end{bmatrix} = x\begin{bmatrix} \htmlClass{c-green}{a} \\ \htmlClass{c-green}{c} \end{bmatrix} + y\begin{bmatrix} \htmlClass{c-red}{b} \\ \htmlClass{c-red}{d} \end{bmatrix} = \begin{bmatrix} ax + by \\ cx + dy \end{bmatrix}.$$

**Example.** The shear $\begin{bmatrix} 1 & 1 \\ 0 & 1 \end{bmatrix}$ leaves $\hat\imath$ alone and tips $\hat\jmath$ over to $(1, 1)$. The vector $(2, 1)$ goes to $2(1, 0) + 1(1, 1) = (3, 1)$.

## The determinant measures area
The unit square spanned by $\hat\imath$ and $\hat\jmath$ becomes the parallelogram spanned by the two columns. Its signed area is

$$\det A = ad - bc,$$

and every region's area gets multiplied by that same factor. If $\det A < 0$ the plane has been flipped over (the F turns into its mirror image). If $\det A = 0$ the plane is squashed onto a line or a point, which can't be undone, so $A$ has no inverse.

## Things to try
- Follow the **guided tour** above the graph, step by step.
- Drag the green and red arrow tips, and watch the matrix entries change with them.
- Drag the orange tip of $A\mathbf v$. The dashed green and red legs show $x$ copies of $A\hat\imath$ plus $y$ copies of $A\hat\jmath$.
- Make $\det A = 0$ by dragging $\hat\jmath$ onto the line of $\hat\imath$.

## Where it's used
Computer graphics (every rotation, zoom and skew on your screen is a matrix), robotics, physics (changes of coordinates), and machine learning, where each layer of a neural network starts with a linear transformation. Next: [Matrix multiplication as composition](#/topic/matrix-composition) and [Eigenvectors](#/topic/eigenvectors).
`,

  mount({ plotArea, controls, lesson }) {
    const state = {
      A: { ...PRESETS.shear.m },
      t: 1,
      v: [2, 1],
      show: { grid: true, square: false, letter: true, vector: true },
    };
    const animator = createAnimator();
    const current = () => lerpMatrix(IDENTITY, state.A, state.t);

    // ---- Guided tour (above the graph) --------------------------------------------
    const tour = addSteps(lesson, [
      {
        title: 'Two arrows reach every point',
        text: String.raw`Every point in the plane can be reached with two arrows: $\htmlClass{c-green}{\hat\imath}$, one step to the right, and $\htmlClass{c-red}{\hat\jmath}$, one step up. The orange vector $(2, 1)$ is **two green steps, then one red step**.`,
        focus: 'Follow the dashed green and red path out to the orange tip.',
        enter: () => scene({ to: IDENTITY, show: { grid: true, square: false, letter: true, vector: true }, v: [2, 1] }),
      },
      {
        title: 'Now move the whole plane',
        text: String.raw`A matrix is an instruction for moving every point at once. Watch this one tip the grid sideways. The grid lines stay straight and parallel, they stay evenly spaced, and the center stays put. A move that keeps those rules is called a **linear transformation**.`,
        focus: 'The grid lines tilt but stay straight and evenly spaced.',
        enter: () => scene({ to: PRESETS.shear.m, fromIdentity: true, show: { grid: true, square: false, letter: true, vector: false } }),
      },
      {
        title: 'Watch where the two arrows land',
        text: String.raw`Because the grid stays evenly spaced, you only need to know where $\htmlClass{c-green}{\hat\imath}$ and $\htmlClass{c-red}{\hat\jmath}$ end up. Every other point follows them. Here the green arrow stays at $(1, 0)$ and the red one tips over to $(1, 1)$.`,
        focus: 'Drag the green or red arrow tip and watch the whole grid follow.',
        enter: () => scene({ to: PRESETS.shear.m, show: { grid: true, square: false, letter: false, vector: false } }),
      },
      {
        title: 'Those landing spots are the matrix',
        text: String.raw`Write the two landing spots side by side as columns and you have the matrix:
$$A = \begin{bmatrix} \htmlClass{c-green}{1} & \htmlClass{c-red}{1} \\ \htmlClass{c-green}{0} & \htmlClass{c-red}{1} \end{bmatrix}$$
The green column is where $\hat\imath$ lands and the red column is where $\hat\jmath$ lands. **A matrix is a record of where the two arrows go.**`,
        focus: 'Compare the matrix in the What A does card with the arrow tips.',
        enter: () => scene({ to: PRESETS.shear.m, show: { grid: true, square: false, letter: false, vector: false } }),
      },
      {
        title: 'Follow one vector through',
        text: String.raw`Where does $(2, 1)$ go? It's still two green steps and one red step, now using the arrows' new positions:
$$A\begin{bmatrix}2\\1\end{bmatrix} = 2\htmlClass{c-green}{\begin{bmatrix}1\\0\end{bmatrix}} + 1\htmlClass{c-red}{\begin{bmatrix}1\\1\end{bmatrix}} = \begin{bmatrix}3\\1\end{bmatrix}$$
That sum is all that multiplying a matrix by a vector does.`,
        focus: 'Drag the orange tip. The panel shows the green and red steps it is made of.',
        enter: () => scene({ to: PRESETS.shear.m, show: { grid: true, square: false, letter: false, vector: true }, v: [2, 1] }),
      },
      {
        title: 'How much the area changes',
        text: String.raw`The yellow square is the one the two arrows used to frame. After the move it's a parallelogram, and its area is the **determinant**:
$$\det A = ad - bc = 2 \cdot 1 - 0.5 \cdot 0 = 2$$
Every shape in the plane has its area multiplied by this same number, so here everything doubles.`,
        focus: 'Read the area written inside the yellow shape.',
        enter: () => scene({ to: { a: 2, b: 0.5, c: 0, d: 1 }, fromIdentity: true, show: { grid: true, square: true, letter: true, vector: false } }),
      },
      {
        title: 'A negative determinant flips the plane',
        text: String.raw`This matrix has $\det A = -1$. The minus sign means the plane was flipped over, like turning a page face down. Look at the F: it now reads backwards, and the square has turned pink.`,
        focus: 'Compare the F with how it started. It is mirrored.',
        enter: () => scene({ to: { a: -1, b: 0.4, c: 0, d: 1 }, fromIdentity: true, show: { grid: true, square: true, letter: true, vector: false } }),
      },
      {
        title: 'A zero determinant squashes everything',
        text: String.raw`When both arrows land on the same line, the whole plane gets squashed onto that line and the area becomes 0. A squash can't be undone, because many points end up on the same spot. That's why a matrix with $\det A = 0$ has no inverse.`,
        focus: 'Watch the grid collapse onto a single line.',
        enter: () => scene({ to: PRESETS.collapse.m, fromIdentity: true, show: { grid: true, square: true, letter: true, vector: false } }),
      },
      {
        title: 'Rotations keep shapes the same',
        text: String.raw`A rotation by an angle $\theta$ sends $\hat\imath$ to $(\cos\theta, \sin\theta)$ and $\hat\jmath$ to $(-\sin\theta, \cos\theta)$. Shapes turn without stretching, so areas stay the same and $\det A = 1$.

Quick check: where does $\hat\imath$ land after a 90° turn? (At $(0, 1)$, straight up.)`,
        focus: 'The square turns but keeps an area of 1.',
        enter: () => scene({ to: PRESETS.rotate90.m, fromIdentity: true, show: { grid: true, square: true, letter: true, vector: false } }),
      },
      {
        title: 'Your turn',
        text: String.raw`Type any matrix into the Matrix card below, pick a preset, or drag the arrows. Press Play to watch the move from the start. When you're ready, see what happens with two moves in a row: [Matrix multiplication](#/topic/matrix-composition).`,
        focus: 'Try to make the determinant exactly 0 by dragging the red arrow.',
        enter: () => scene({ show: { grid: true, square: true, letter: true, vector: true } }),
      },
    ]);

    const plot = new Plot(plotArea, { xMin: -4.5, xMax: 4.5, yMin: -3.5, yMax: 3.5 }, { height: 470, equalAspect: true });
    plot.canvas.setAttribute('aria-label', 'The plane being transformed by a 2×2 matrix');

    // ---- Controls ----------------------------------------------------------------
    addHeading(controls, 'Matrix A');
    const matrixInput = addMatrixInput(controls, {
      value: state.A,
      onInput: (M) => {
        animator.stop();
        Object.assign(state, { A: M, t: 1 });
        tSlider.value = 1;
        update();
      },
    });
    addNote(controls, 'Green column = where î lands. Red column = where ĵ lands.');
    const presetSelect = addSelect(controls, {
      options: [{ value: '', label: 'Presets…' }, ...Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label }))],
      onChange: (key) => {
        if (!key) return;
        scene({ to: PRESETS[key].m, fromIdentity: true });
        presetSelect.value = '';
      },
    });

    addHeading(controls, 'Animate');
    const tSlider = addSlider(controls, {
      label: 'Morph from I to A',
      min: 0,
      max: 1,
      step: 0.01,
      value: 1,
      format: (v) => v.toFixed(2),
      onInput: (v) => {
        animator.stop();
        state.t = v;
        update();
      },
    });
    addButtons(controls, [
      { label: 'Play', icon: 'play', primary: true, onClick: () => play() },
      { label: 'Reset to I', icon: 'restart', onClick: () => scene({ to: IDENTITY }) },
    ]);

    addHeading(controls, 'Show');
    const toggles = {
      grid: addCheckbox(controls, { label: 'Transformed grid', checked: state.show.grid, onChange: (on) => setShow('grid', on) }),
      letter: addCheckbox(controls, { label: 'Letter F (shows flips)', checked: state.show.letter, onChange: (on) => setShow('letter', on) }),
      square: addCheckbox(controls, { label: 'Unit square → det', checked: state.show.square, onChange: (on) => setShow('square', on) }),
      vector: addCheckbox(controls, { label: 'Vector v = (x, y)', checked: state.show.vector, onChange: (on) => setShow('vector', on) }),
    };

    addHeading(controls, 'What A does');
    const matrixReadout = addReadout(controls, 'A', { wide: true });
    const detReadout = addReadout(controls, 'det A', { wide: true });
    const vectorReadout = addReadout(controls, 'A v', { wide: true });
    addNote(controls, 'Drag the green and red arrow tips, or the orange tip of Av. Scroll/pinch on the graph to zoom.');

    function setShow(key, on) {
      state.show[key] = on;
      update();
    }

    // ---- Scenes (used by the tour and presets) --------------------------------------
    /** Move to matrix `to` (smoothly), optionally starting from the identity, and set what's shown. */
    function scene({ to, fromIdentity = false, show, v } = {}) {
      if (show) {
        Object.assign(state.show, show);
        for (const key of Object.keys(toggles)) toggles[key].checked = state.show[key];
      }
      if (v) state.v = v;
      if (!to) return update();
      if (fromIdentity) {
        state.A = { ...to };
        matrixInput.set(state.A);
        play();
      } else {
        const from = current();
        state.t = 1;
        animator.run(900, (s) => {
          state.A = lerpMatrix(from, to, s);
          matrixInput.set(state.A);
          tSlider.value = 1;
          update();
        });
      }
    }

    function play() {
      animator.run(1600, (s) => {
        state.t = s;
        tSlider.value = s;
        update();
      });
    }

    // ---- Dragging ---------------------------------------------------------------------
    const dragColumn = (column) => ({
      get: () => apply(current(), column === 0 ? [1, 0] : [0, 1]),
      set: (x, y) => {
        animator.stop();
        const [sx, sy] = [snap(x), snap(y)];
        state.A = column === 0 ? { ...state.A, a: sx, c: sy } : { ...state.A, b: sx, d: sy };
        state.t = 1;
        tSlider.value = 1;
        matrixInput.set(state.A);
        update();
      },
    });
    plot.addDraggable(dragColumn(0));
    plot.addDraggable(dragColumn(1));
    plot.addDraggable({
      get: () => (state.show.vector ? apply(current(), state.v) : [NaN, NaN]),
      set: (x, y) => {
        const inv = inverse(current());
        if (!inv) return; // squashed flat: many v land here, so we can't tell which one you mean
        const [vx, vy] = apply(inv, [x, y]);
        state.v = [snap(vx, 0.5, 0.12), snap(vy, 0.5, 0.12)];
        update();
      },
    });

    // ---- Drawing ------------------------------------------------------------------------
    plot.onDraw = (p) => {
      const M = current();
      p.grid();
      if (state.show.grid) drawTransformedGrid(p, M);
      if (state.show.square) drawUnitSquare(p, M);
      if (state.show.letter) drawLetterF(p, M);

      if (state.show.vector) {
        const [x, y] = state.v;
        const i = apply(M, [1, 0]);
        const j = apply(M, [0, 1]);
        const leg = [x * i[0], x * i[1]];
        const Av = apply(M, state.v);
        // where v was before the transformation
        if (state.t < 1 || !isIdentity(M)) p.arrow(0, 0, x, y, { color: alpha(COLORS.orange, 0.35), width: 2, dash: [5, 5] });
        // x copies of Aî, then y copies of Aĵ
        p.line(0, 0, ...leg, { color: COLORS.green, width: 2.5, dash: [7, 5] });
        p.line(...leg, ...Av, { color: COLORS.red, width: 2.5, dash: [7, 5] });
        p.arrow(0, 0, ...Av, { color: COLORS.orange, width: 3.5, headSize: 13 });
        p.point(...Av, { color: COLORS.orange, radius: 6 });
        p.text(`Av = ${fmt(x)}·î + ${fmt(y)}·ĵ`, ...Av, { color: COLORS.orange, offset: [10, -8] });
      }
      drawBasisVectors(p, M);
      p.point(...apply(M, [1, 0]), { color: COLORS.green, radius: 5 });
      p.point(...apply(M, [0, 1]), { color: COLORS.red, radius: 5 });
    };

    // ---- Readouts + redraw ------------------------------------------------------------
    function update() {
      const M = current();
      const D = det(M);
      matrixReadout.math(matrixTex(M));

      let meaning;
      if (Math.abs(D) < 1e-6) meaning = String.raw`\text{plane squashed flat, no inverse}`;
      else if (D < 0) meaning = String.raw`\text{flips the plane, areas} \times ${format(Math.abs(D), 2)}`;
      else if (Math.abs(D - 1) < 1e-6) meaning = String.raw`\text{areas unchanged}`;
      else meaning = String.raw`\text{areas} \times ${format(D, 2)}`;
      detReadout.math(String.raw`${format(D, 3)} \;\;\; ${meaning}`);

      const [x, y] = state.v;
      const Av = apply(M, state.v);
      vectorReadout.math(
        String.raw`${fmt(x)}\htmlClass{c-green}{\begin{bmatrix}${format(M.a, 2)}\\${format(M.c, 2)}\end{bmatrix}} + ${fmt(y)}\htmlClass{c-red}{\begin{bmatrix}${format(M.b, 2)}\\${format(M.d, 2)}\end{bmatrix}} = \htmlClass{c-orange}{\begin{bmatrix}${format(Av[0], 2)}\\${format(Av[1], 2)}\end{bmatrix}}`,
      );
      plot.render();
    }

    tour.go(0);
    update();

    return () => {
      animator.stop();
      plot.destroy();
    };
  },
};

/** Round to `step`, and snap to whole numbers when close (makes nice matrices easy to hit). */
function snap(value, step = 0.1, toInteger = 0.08) {
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) < toInteger) return nearest;
  return Number((Math.round(value / step) * step).toFixed(6));
}

function fmt(value) {
  return format(value, 2);
}

function isIdentity(M) {
  return Math.abs(M.a - 1) < 1e-9 && Math.abs(M.b) < 1e-9 && Math.abs(M.c) < 1e-9 && Math.abs(M.d - 1) < 1e-9;
}
