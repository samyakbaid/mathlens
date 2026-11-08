// Eigenvalues & eigenvectors of a 2×2 matrix: the directions a transformation doesn't turn.

import { Plot, COLORS, alpha } from '../../lib/plot.js';
import { addHeading, addSlider, addSelect, addCheckbox, addReadout, addButtons, addNote, addMatrixInput, addSteps } from '../../lib/controls.js';
import { createAnimator, linear } from '../../lib/animate.js';
import { format } from '../../lib/numeric.js';
import {
  IDENTITY, apply, det, dot, eigen, lerpMatrix, matrixTex,
  drawTransformedGrid, drawBasisVectors,
} from '../../lib/linalg.js';

const PRESETS = {
  symmetric: { label: 'Symmetric [[2, 1], [1, 2]]', m: { a: 2, b: 1, c: 1, d: 2 } },
  stretch: { label: 'Stretch [[2, 0], [0, 0.5]]', m: { a: 2, b: 0, c: 0, d: 0.5 } },
  general: { label: 'General [[1.5, 0.8], [0.3, 1]]', m: { a: 1.5, b: 0.8, c: 0.3, d: 1 } },
  shear: { label: 'Shear [[1, 1], [0, 1]]', m: { a: 1, b: 1, c: 0, d: 1 } },
  rotation: { label: 'Rotation by 90°', m: { a: 0, b: -1, c: 1, d: 0 } },
  reflection: { label: 'Reflection across x-axis', m: { a: 1, b: 0, c: 0, d: -1 } },
  projection: { label: 'Projection onto x-axis', m: { a: 1, b: 0, c: 0, d: 0 } },
  scaling: { label: 'Uniform scaling ×1.5', m: { a: 1.5, b: 0, c: 0, d: 1.5 } },
};

const FAN_SIZE = 24;
const FAN_LENGTH = 1.5;
const ALIGNED_DEGREES = 1.5;

export default {
  id: 'eigenvectors',
  title: 'Eigenvalues & Eigenvectors',
  category: 'Linear Algebra',
  level: 'Undergraduate',
  summary: 'A matrix turns most arrows. Find the few directions it only stretches.',

  explanation: String.raw`
*New to matrices as transformations? Start with [Linear Transformations](#/topic/linear-transformations).*

## The idea
A matrix $A$ moves every vector in the plane. Most vectors get knocked off the line they started on (their *span*). A few special directions stay on their own line, and the matrix only stretches, shrinks or flips them. Those are the **eigenvectors**, and the stretch factor is the **eigenvalue**:

$$A\mathbf{v} = \lambda \mathbf{v}, \qquad \mathbf{v} \neq \mathbf{0}.$$

Why care? Along an eigenvector, a complicated matrix acts like plain multiplication by a number. If you can describe a vector in terms of eigenvectors, applying $A$ (or $A^{100}$) becomes easy: each piece just gets multiplied by $\lambda$ (or $\lambda^{100}$).

## How to find them
Rewrite the equation as $(A - \lambda I)\mathbf{v} = \mathbf{0}$. A non-zero $\mathbf v$ can only be sent to $\mathbf 0$ if $A - \lambda I$ squashes the plane flat, that is when its determinant is zero:

$$\det(A - \lambda I) = \lambda^2 - \operatorname{tr}(A)\,\lambda + \det(A) = 0.$$

So for a $2 \times 2$ matrix, $\lambda_1 + \lambda_2 = \operatorname{tr}(A)$ and $\lambda_1 \lambda_2 = \det(A)$.

**Example.** For $A = \begin{bmatrix} 2 & 1 \\ 1 & 2 \end{bmatrix}$: $\lambda^2 - 4\lambda + 3 = 0$, so $\lambda = 3$ with $\mathbf{v} = (1, 1)$ and $\lambda = 1$ with $\mathbf{v} = (1, -1)$. Check: $A(1, 1) = (3, 3) = 3(1, 1)$.

## Things to try
- Follow the **guided tour** above the graph.
- **Drag the purple vector** $\mathbf{v}$. When it lines up with a dashed yellow line, $A\mathbf{v}$ points the same way: that's an eigenvector. It snaps on when you get close.
- Press **Sweep v** to rotate $\mathbf v$ all the way round and watch the angle between $\mathbf v$ and $A\mathbf v$.
- **Rotation**: no direction survives, so the eigenvalues are complex, $\lambda = \pm i$.
- **Shear**: the eigenvalue $1$ is repeated but there's only one eigen-direction. The matrix is *defective* (not diagonalizable).
- **Symmetric** matrices always have real eigenvalues and perpendicular eigenvectors (the spectral theorem).

## Where it's used
Principal component analysis (eigenvectors of a covariance matrix), stability of dynamical systems ($\dot{\mathbf{x}} = A\mathbf{x}$ is stable when every eigenvalue has negative real part), Google's PageRank, vibration modes in engineering, and observables in quantum mechanics.
`,

  mount({ plotArea, controls, lesson }) {
    const state = {
      A: { ...PRESETS.symmetric.m },
      t: 1,
      probe: [1.6, 0.6],
      show: { fan: true, lines: false, circle: false, probe: false },
    };
    const animator = createAnimator();
    const current = () => lerpMatrix(IDENTITY, state.A, state.t);

    // ---- Guided tour -------------------------------------------------------------------
    const tour = addSteps(lesson, [
      {
        title: 'Watch what happens to many arrows',
        text: String.raw`Each blue arrow starts out pointing its own way (its faint dot shows where it started). Watch the matrix act on all of them. Almost every arrow gets turned and ends up pointing somewhere new.`,
        focus: 'Pick one faint dot and follow its arrow to where it ends.',
        enter: () => scene({ to: PRESETS.symmetric.m, play: true, show: { fan: true, lines: false, circle: false, probe: false } }),
      },
      {
        title: 'A few arrows keep their direction',
        text: String.raw`Now look at the yellow arrows on the dashed lines. They didn't turn at all. They only got longer or shorter. Arrows like these are called **eigenvectors**, and the matrix simply stretches them:
$$A\mathbf v = \lambda \mathbf v$$`,
        focus: 'Find the arrows that stay on the dashed yellow lines.',
        enter: () => scene({ to: PRESETS.symmetric.m, play: true, show: { fan: true, lines: true, circle: false, probe: false } }),
      },
      {
        title: 'The stretch factor is λ',
        text: String.raw`The number $\lambda$ (lambda) says how much an eigenvector stretches. Along $(1, 1)$ every arrow becomes 3 times longer, so $\lambda_1 = 3$. Along $(1, -1)$ arrows keep their length, so $\lambda_2 = 1$. Check the first one:
$$A\begin{bmatrix}1\\1\end{bmatrix} = \begin{bmatrix}3\\3\end{bmatrix} = 3\begin{bmatrix}1\\1\end{bmatrix}$$`,
        focus: 'The purple arrow v sits on the first line. Compare v with Av.',
        enter: () => {
          state.probe = [1, 1];
          scene({ to: PRESETS.symmetric.m, show: { fan: false, lines: true, circle: false, probe: true } });
        },
      },
      {
        title: 'Sweep around and look',
        text: String.raw`Now the purple arrow sweeps all the way around. Keep an eye on the angle between $\mathbf v$ and $A\mathbf v$ in the Results card. It drops to 0° each time $\mathbf v$ crosses a yellow line.`,
        focus: 'Watch the angle in the Results card each time v crosses a yellow line.',
        enter: () => {
          scene({ to: PRESETS.symmetric.m, show: { fan: false, lines: true, circle: true, probe: true } });
          sweep();
        },
      },
      {
        title: 'Find them with algebra',
        text: String.raw`Sweeping works, but there's a shortcut. If $A\mathbf v = \lambda\mathbf v$, then $(A - \lambda I)\mathbf v = \mathbf 0$. A nonzero arrow can only be sent to zero if $A - \lambda I$ squashes the plane flat, which means its determinant is zero:
$$\det(A - \lambda I) = \lambda^2 - 4\lambda + 3 = 0$$
That gives $\lambda = 3$ and $\lambda = 1$, the two lines you found.`,
        focus: 'The two dashed lines match the two solutions.',
        enter: () => scene({ to: PRESETS.symmetric.m, show: { fan: false, lines: true, circle: true, probe: false } }),
      },
      {
        title: 'A rotation has none',
        text: String.raw`A quarter turn rotates every arrow, so no direction is left alone and there are no real eigenvectors. The algebra agrees: $\lambda^2 + 1 = 0$ has no real solutions.`,
        focus: 'No arrow stays on its own line.',
        enter: () => scene({ to: PRESETS.rotation.m, play: true, show: { fan: true, lines: true, circle: false, probe: false } }),
      },
      {
        title: 'A shear has only one',
        text: String.raw`A shear leaves the horizontal direction alone ($\lambda = 1$) and tips everything else over. That's one eigen-direction where you might expect two. Matrices like this are called *defective*.`,
        focus: 'Only the arrows along the x-axis keep their direction.',
        enter: () => scene({ to: PRESETS.shear.m, play: true, show: { fan: true, lines: true, circle: false, probe: false } }),
      },
      {
        title: 'Your turn',
        text: String.raw`Type a matrix, pick a preset, or drag the green and red tips. Guess where the eigen-lines are before you switch them on. Eigenvectors show up in PCA, which finds the main trends in a dataset, and in engineering, where they give the ways a bridge can wobble.`,
        focus: 'Switch off Eigen-lines, guess where they are, then switch them back on.',
        enter: () => scene({ to: PRESETS.general.m, play: true, show: { fan: true, lines: true, circle: false, probe: true } }),
      },
    ]);

    const plot = new Plot(plotArea, { xMin: -4, xMax: 4, yMin: -3.5, yMax: 3.5 }, { height: 480, equalAspect: true });

    // ---- Controls ------------------------------------------------------------------------
    addHeading(controls, 'Matrix A');
    const matrixInput = addMatrixInput(controls, {
      value: state.A,
      onInput: (M) => {
        animator.stop();
        Object.assign(state, { A: M, t: 1 });
        update();
      },
    });
    const presetSelect = addSelect(controls, {
      options: [{ value: '', label: 'Presets…' }, ...Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label }))],
      onChange: (key) => {
        if (!key) return;
        scene({ to: PRESETS[key].m, play: true });
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
      { label: 'Play', icon: 'play', primary: true, onClick: play },
      { label: 'Sweep v', icon: 'restart', onClick: sweep },
    ]);

    addHeading(controls, 'Show');
    const toggles = {
      fan: addCheckbox(controls, { label: 'Many vectors', checked: state.show.fan, onChange: (on) => setShow('fan', on) }),
      lines: addCheckbox(controls, { label: 'Eigen-lines', checked: state.show.lines, onChange: (on) => setShow('lines', on) }),
      probe: addCheckbox(controls, { label: 'Purple vector v', checked: state.show.probe, onChange: (on) => setShow('probe', on) }),
      circle: addCheckbox(controls, { label: 'Unit circle → ellipse', checked: state.show.circle, onChange: (on) => setShow('circle', on) }),
    };

    addHeading(controls, 'Results');
    const matrixReadout = addReadout(controls, 'A');
    const traceReadout = addReadout(controls, 'tr A, det A');
    const eigenvalueReadout = addReadout(controls, 'Eigenvalues', { wide: true });
    const probeReadout = addReadout(controls, 'Angle between v and Av', { wide: true });
    addNote(controls, 'Drag the purple v, or the green (Aî) and red (Aĵ) tips to edit the matrix.');

    function setShow(key, on) {
      state.show[key] = on;
      update();
    }

    // ---- Scenes ---------------------------------------------------------------------------
    function scene({ to, play: animateFromIdentity = false, show } = {}) {
      if (show) {
        Object.assign(state.show, show);
        for (const key of Object.keys(toggles)) toggles[key].checked = state.show[key];
      }
      if (to) {
        state.A = { ...to };
        matrixInput.set(state.A);
      }
      if (animateFromIdentity) play();
      else {
        animator.stop();
        state.t = 1;
        update();
      }
    }

    function play() {
      animator.run(1800, (s) => {
        state.t = s;
        update();
      });
    }

    /** Rotate v once around the circle at a steady speed. */
    function sweep() {
      Object.assign(state.show, { probe: true });
      toggles.probe.checked = true;
      state.t = 1;
      const radius = 1.6;
      animator.run(7000, (u) => {
        const angle = u * 2 * Math.PI;
        state.probe = [radius * Math.cos(angle), radius * Math.sin(angle)];
        update();
      }, { easing: linear });
    }

    // ---- Dragging ---------------------------------------------------------------------------
    plot.addDraggable({
      get: () => (state.show.probe ? state.probe : [NaN, NaN]),
      set: (x, y) => {
        animator.stop();
        state.probe = snapToEigenvector([x, y], eigen(state.A));
        update();
      },
    });
    const dragColumn = (column) => ({
      get: () => apply(current(), column === 0 ? [1, 0] : [0, 1]),
      set: (x, y) => {
        animator.stop();
        const [sx, sy] = [round1(x), round1(y)];
        state.A = column === 0 ? { ...state.A, a: sx, c: sy } : { ...state.A, b: sx, d: sy };
        state.t = 1;
        matrixInput.set(state.A);
        update();
      },
    });
    plot.addDraggable(dragColumn(0));
    plot.addDraggable(dragColumn(1));

    // ---- Drawing ------------------------------------------------------------------------------
    plot.onDraw = (p) => {
      const M = current();
      const result = eigen(state.A); // the in-between matrices (1−t)I + tA share A's eigenvectors

      p.grid();
      drawTransformedGrid(p, M, { opacity: 0.22 });

      if (state.show.circle) {
        const circle = Array.from({ length: 121 }, (_, i) => [Math.cos((i / 120) * 2 * Math.PI), Math.sin((i / 120) * 2 * Math.PI)]);
        p.path(circle, { color: alpha(COLORS.muted, 0.6), width: 1, dash: [4, 4], closed: true });
        p.path(circle.map((v) => apply(M, v)), { color: COLORS.blue, width: 1.5, fill: alpha(COLORS.blue, 0.06), closed: true });
      }

      if (state.show.lines && !result.complex) {
        for (const { vector } of result.pairs) {
          if (!vector) continue;
          const [vx, vy] = vector;
          p.line(-50 * vx, -50 * vy, 50 * vx, 50 * vy, { color: alpha(COLORS.yellow, 0.7), width: 2, dash: [8, 6] });
        }
      }

      if (state.show.fan) drawFan(p, M, result);

      if (state.show.lines && !result.complex) {
        result.pairs.forEach(({ value, vector }, i) => {
          if (!vector) return;
          const scale = 1 - state.t + state.t * value; // the eigenvalue of the in-between matrix
          const tip = [vector[0] * FAN_LENGTH * Math.max(scale, 0.3), vector[1] * FAN_LENGTH * Math.max(scale, 0.3)];
          p.text(`λ${result.pairs.length > 1 ? i + 1 : ''} = ${format(value, 2)}`, ...tip, { color: COLORS.yellow, offset: [10, -8] });
        });
      }

      drawBasisVectors(p, M, { width: 3 });

      if (state.show.probe) {
        const [px, py] = state.probe;
        const [qx, qy] = apply(M, state.probe);
        const aligned = isAligned(state.probe, [qx, qy]);
        p.line(-50 * px, -50 * py, 50 * px, 50 * py, { color: alpha(COLORS.purple, 0.25), width: 1 });
        p.arrow(0, 0, qx, qy, { color: aligned ? COLORS.yellow : COLORS.purple, width: 3.5 });
        p.arrow(0, 0, px, py, { color: alpha(COLORS.purple, 0.6), width: 2.5 });
        p.point(px, py, { color: COLORS.purple, radius: 7 });
        p.text('v', px, py, { color: COLORS.purple });
        p.text(aligned ? 'Av = λv' : 'Av', qx, qy, { color: aligned ? COLORS.yellow : COLORS.purple });
      }
    };

    /** A ring of vectors and their images; the ones that stay on their line glow yellow. */
    function drawFan(p, M, result) {
      const directions = Array.from({ length: FAN_SIZE }, (_, k) => (k / FAN_SIZE) * 2 * Math.PI).map((angle) => [Math.cos(angle), Math.sin(angle)]);
      if (!result.complex) {
        for (const { vector } of result.pairs) {
          if (vector) directions.push(vector, [-vector[0], -vector[1]]);
        }
      }
      for (const [ux, uy] of directions) {
        const start = [ux * FAN_LENGTH, uy * FAN_LENGTH];
        const end = apply(M, start);
        const aligned = state.t > 0.02 && isAligned(start, end);
        p.point(...start, { color: alpha(COLORS.muted, 0.5), radius: 2.5 });
        p.arrow(0, 0, ...end, {
          color: aligned ? COLORS.yellow : alpha(COLORS.blue, 0.55),
          width: aligned ? 3.5 : 1.75,
          headSize: aligned ? 12 : 8,
        });
      }
    }

    // ---- Readouts + redraw -------------------------------------------------------------------
    function update() {
      tSlider.value = state.t;
      const { A } = state;
      const result = eigen(A);

      matrixReadout.math(matrixTex(A));
      traceReadout.text(`${format(A.a + A.d, 3)},  ${format(det(A), 3)}`);

      if (result.complex) {
        eigenvalueReadout.math(String.raw`\lambda = ${format(result.re, 3)} \pm ${format(result.im, 3)}\,i \;\text{(no real eigenvectors)}`);
      } else if (result.everyVector) {
        eigenvalueReadout.math(String.raw`\lambda = ${format(result.pairs[0].value, 3)} \;\text{(every vector is an eigenvector)}`);
      } else {
        const lines = result.pairs.map(({ value, vector }, i) =>
          vector ? String.raw`\lambda_${i + 1} = ${format(value, 3)},\ \mathbf{v}_${i + 1} = (${format(vector[0], 2)}, ${format(vector[1], 2)})` : '',
        );
        const defective = result.defective ? String.raw`\\ \text{repeated, only one direction}` : '';
        eigenvalueReadout.math(String.raw`\begin{array}{l}${lines.join(String.raw`\\`)}${defective}\end{array}`);
      }

      if (!state.show.probe) {
        probeReadout.text('Turn on “Purple vector v”');
      } else {
        const v = state.probe;
        const Av = apply(current(), v);
        const lengths = Math.hypot(...v) * Math.hypot(...Av);
        if (lengths < 1e-9) {
          probeReadout.math(String.raw`A\mathbf{v} = \mathbf{0}\ \text{(eigenvalue } 0\text{)}`);
        } else {
          const cross = v[0] * Av[1] - v[1] * Av[0];
          const angle = (Math.atan2(cross, dot(v, Av)) * 180) / Math.PI;
          if (isAligned(v, Av)) {
            const ratio = dot(Av, v) / dot(v, v);
            probeReadout.math(String.raw`${format(Math.abs(angle) > 90 ? 180 : 0, 0)}^\circ\ \ \checkmark\ \ A\mathbf{v} = ${format(ratio, 3)}\,\mathbf{v}`);
          } else {
            probeReadout.math(String.raw`${format(angle, 1)}^\circ\ \ \text{(v gets turned)}`);
          }
        }
      }
      plot.render();
    }

    tour.go(0);

    return () => {
      animator.stop();
      plot.destroy();
    };
  },
};

// ---- Helpers ------------------------------------------------------------------------------

/** True when w points along the same line as v (either direction), within a small angle. */
function isAligned(v, w) {
  const lengths = Math.hypot(...v) * Math.hypot(...w);
  if (lengths < 1e-9) return false;
  const sin = Math.abs(v[0] * w[1] - v[1] * w[0]) / lengths;
  return sin < Math.sin((ALIGNED_DEGREES * Math.PI) / 180);
}

/** If v is within 4° of an eigen-direction, move it exactly onto that direction. */
function snapToEigenvector(v, result) {
  if (result.complex || result.everyVector) return v;
  const length = Math.hypot(...v);
  if (length < 1e-9) return v;
  for (const { vector } of result.pairs) {
    if (!vector) continue;
    const projection = dot(v, vector);
    const angle = Math.acos(Math.min(1, Math.abs(projection) / length));
    if (angle < (4 * Math.PI) / 180) return [vector[0] * projection, vector[1] * projection];
  }
  return v;
}

function round1(value) {
  return Math.max(-5, Math.min(5, Math.round(value * 10) / 10));
}
