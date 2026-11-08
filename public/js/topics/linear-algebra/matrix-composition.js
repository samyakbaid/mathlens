// Matrix multiplication as doing one transformation after another.

import { Plot, COLORS } from '../../lib/plot.js';
import { addHeading, addSelect, addSlider, addReadout, addButtons, addNote, addMatrixInput, addSteps, setButtonLabel } from '../../lib/controls.js';
import { createAnimator, linear } from '../../lib/animate.js';
import {
  IDENTITY, apply, multiply, lerpMatrix, matricesEqual, matrixTex, vectorTex,
  drawTransformedGrid, drawBasisVectors, drawLetterF,
} from '../../lib/linalg.js';

const PRESETS = {
  shear: { label: 'Shear right', m: { a: 1, b: 1, c: 0, d: 1 } },
  rotate90: { label: 'Rotate 90°', m: { a: 0, b: -1, c: 1, d: 0 } },
  stretchX: { label: 'Stretch x by 2', m: { a: 2, b: 0, c: 0, d: 1 } },
  squashY: { label: 'Squash y by ½', m: { a: 1, b: 0, c: 0, d: 0.5 } },
  reflectX: { label: 'Reflect across the x-axis', m: { a: 1, b: 0, c: 0, d: -1 } },
  swapAxes: { label: 'Reflect across y = x', m: { a: 0, b: 1, c: 1, d: 0 } },
  identity: { label: 'Identity', m: IDENTITY },
};

export default {
  id: 'matrix-composition',
  title: 'Matrix Multiplication as Composition',
  category: 'Linear Algebra',
  level: 'Foundations',
  summary: 'Do one move, then another. A single matrix does both, and the order you do them in matters.',

  explanation: String.raw`
## Two moves in a row
If $B$ moves the plane and then $A$ moves the result, the combined movement is again linear, so it is again a matrix. That matrix is the **product** $AB$:

$$(AB)\mathbf v = A(B\mathbf v).$$

Read it **right to left**, like function composition $f(g(x))$: $B$ acts first.

## Where the multiplication rule comes from
The columns of $AB$ are where $\hat\imath$ and $\hat\jmath$ end up after both moves. $B$ sends $\hat\imath$ to its first column $\mathbf b_1$, then $A$ sends that to $A\mathbf b_1$. So

$$AB = \begin{bmatrix} | & | \\ A\mathbf b_1 & A\mathbf b_2 \\ | & | \end{bmatrix},$$

and computing $A\mathbf b_1$ entry by entry is exactly the "row times column" rule you may have memorised.

**Example.** $B = \begin{bmatrix} 1 & 1 \\ 0 & 1 \end{bmatrix}$ (shear), $A = \begin{bmatrix} 0 & -1 \\ 1 & 0 \end{bmatrix}$ (rotate 90°). Then $AB = \begin{bmatrix} 0 & -1 \\ 1 & 1 \end{bmatrix}$ but $BA = \begin{bmatrix} 1 & -1 \\ 1 & 0 \end{bmatrix}$. Different!

## Order matters
Shearing and then rotating gives a different result from rotating and then shearing, so in general $AB \neq BA$. Some pairs do commute: two rotations, or two scalings along the same axes. Try them.

## Useful facts that fall out
- $\det(AB) = \det(A)\det(B)$: area factors multiply.
- $(AB)^{-1} = B^{-1}A^{-1}$: to undo "B then A", undo A first.
- Multiplication is associative, $(AB)C = A(BC)$, because three moves in a row give the same result however you group them.

## Where it's used
Graphics pipelines chain model, view and projection matrices. Robot arms multiply one matrix per joint. In deep learning, stacking linear layers without non-linearities collapses to a single matrix, which is why activations are needed.
`,

  mount({ plotArea, controls, lesson }) {
    const state = {
      B: { ...PRESETS.shear.m }, // applied first
      A: { ...PRESETS.rotate90.m }, // applied second
      s: 2, // 0 → 1: applying the first matrix, 1 → 2: applying the second
      swapped: false,
    };
    const animator = createAnimator();
    const first = () => (state.swapped ? state.A : state.B);
    const second = () => (state.swapped ? state.B : state.A);
    const current = () =>
      state.s <= 1 ? lerpMatrix(IDENTITY, first(), state.s) : multiply(lerpMatrix(IDENTITY, second(), state.s - 1), first());

    const tour = addSteps(lesson, [
      {
        title: 'First move: a shear',
        text: String.raw`Here are two moves, one after the other. The first one, $B$, is a shear. $\htmlClass{c-green}{\hat\imath}$ stays where it is and $\htmlClass{c-red}{\hat\jmath}$ tips over to $(1, 1)$.`,
        focus: 'Watch the red arrow tip over while the green one stays.',
        enter: () => scene({ B: PRESETS.shear.m, A: PRESETS.rotate90.m, swapped: false, from: 0, to: 1 }),
      },
      {
        title: 'Second move: a quarter turn',
        text: String.raw`Now $A$ turns the plane a quarter turn to the left. It acts on the plane as it is now, already sheared. The dashed F shows where the letter was after the first move.`,
        focus: 'Compare the dashed F (after the first move) with the solid F (after both).',
        enter: () => scene({ from: 1, to: 2 }),
      },
      {
        title: 'Both moves make one matrix',
        text: String.raw`Doing $B$ and then $A$ is itself a single move, so it has its own matrix, written $AB$. Read it right to left, like $f(g(x))$: the one on the right happens first. **The columns of $AB$ are where the two arrows end up after both moves.**`,
        focus: 'The Result card shows the product AB.',
        enter: () => scene({ from: 0, to: 2 }),
      },
      {
        title: 'Work out the first column',
        text: String.raw`Follow $\hat\imath$. The first move $B$ sends it to $B$'s first column, $(1, 0)$. Then $A$ turns that into
$$A\begin{bmatrix}1\\0\end{bmatrix} = \begin{bmatrix}0\\1\end{bmatrix}$$
So the first column of $AB$ is $(0, 1)$.`,
        focus: 'Column 1 of the product appears in the Result card.',
        enter: () => scene({ to: 2 }),
      },
      {
        title: 'Work out the second column',
        text: String.raw`Now follow $\hat\jmath$. $B$ sends it to $(1, 1)$, and $A$ turns that into $(-1, 1)$. Put the two columns together:
$$AB = \begin{bmatrix} 0 & -1 \\ 1 & 1 \end{bmatrix}$$
Working out each column like this is exactly what the row-times-column rule in textbooks does.`,
        focus: 'Check where the red arrow ends up against the second column.',
        enter: () => scene({ to: 2 }),
      },
      {
        title: 'Swap the order',
        text: String.raw`Now turn first and shear second. That's $BA$. The F lands somewhere else, and the matrices are different:
$$BA = \begin{bmatrix} 1 & -1 \\ 1 & 0 \end{bmatrix}$$
With matrices, **the order of the moves matters**.`,
        focus: 'Compare AB and BA in the Result card.',
        enter: () => scene({ swapped: true, from: 0, to: 2 }),
      },
      {
        title: 'Your turn',
        text: String.raw`Pick two matrices from the presets or type your own. Can you find a pair where the order makes no difference? Try two rotations, or two stretches along the axes.`,
        focus: 'Press Swap order and see whether the F moves.',
        enter: () => scene({ swapped: false }),
      },
    ]);

    const plot = new Plot(plotArea, { xMin: -4.5, xMax: 4.5, yMin: -3.5, yMax: 3.5 }, { height: 460, equalAspect: true });

    // ---- Controls ------------------------------------------------------------------
    const matrixSection = (title, key) => {
      addHeading(controls, title);
      const input = addMatrixInput(controls, {
        value: state[key],
        onInput: (M) => {
          animator.stop();
          state[key] = M;
          state.s = 2;
          update();
        },
      });
      const select = addSelect(controls, {
        options: [{ value: '', label: 'Presets…' }, ...Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label }))],
        onChange: (preset) => {
          if (!preset) return;
          scene({ [key]: PRESETS[preset].m, from: 0, to: 2 });
          select.value = '';
        },
      });
      return input;
    };
    const bInput = matrixSection('First apply B', 'B');
    const aInput = matrixSection('Then apply A', 'A');

    addHeading(controls, 'Timeline');
    const sSlider = addSlider(controls, {
      label: '0 → B → then A',
      min: 0,
      max: 2,
      step: 0.01,
      value: state.s,
      format: (v) => v.toFixed(2),
      onInput: (v) => {
        animator.stop();
        state.s = v;
        update();
      },
    });
    const [, swapButton] = addButtons(controls, [
      { label: 'Play', icon: 'play', primary: true, onClick: () => scene({ from: 0, to: 2 }) },
      { label: 'Swap order', icon: 'swap', onClick: () => scene({ swapped: !state.swapped, from: 0, to: 2 }) },
    ]);

    addHeading(controls, 'Result');
    const productReadout = addReadout(controls, 'Product', { wide: true });
    const columnReadout = addReadout(controls, 'Column 1 of the product', { wide: true });
    const compareReadout = addReadout(controls, 'AB vs BA', { wide: true });
    addNote(controls, 'Product columns: green = where î ends up, red = where ĵ ends up.');

    // ---- Scenes --------------------------------------------------------------------
    function scene({ A, B, swapped, from, to } = {}) {
      if (A) state.A = { ...A };
      if (B) state.B = { ...B };
      if (swapped !== undefined) state.swapped = swapped;
      aInput.set(state.A);
      bInput.set(state.B);
      if (to === undefined) return update();
      const start = from ?? state.s;
      const duration = Math.abs(to - start) * 1300 + 200;
      // ease each stage separately so the motion pauses briefly between B and A
      animator.run(duration, (u) => {
        const s = start + (to - start) * u;
        const stage = Math.floor(Math.min(s, 1.999));
        state.s = stage + smooth(s - stage);
        if (u === 1) state.s = to;
        update();
      }, { easing: linear });
    }

    // ---- Drawing ---------------------------------------------------------------------
    plot.onDraw = (p) => {
      const M = current();
      p.grid();
      drawTransformedGrid(p, M);
      if (state.s > 1) drawLetterF(p, first(), { ghost: true });
      drawLetterF(p, M);
      drawBasisVectors(p, M);

      const [firstName, secondName] = state.swapped ? ['A', 'B'] : ['B', 'A'];
      const label = state.s === 0 ? 'Start' : state.s <= 1 ? `Step 1: apply ${firstName}` : state.s < 2 ? `Step 2: apply ${secondName}` : `Result: ${secondName}${firstName}`;
      p.text(label, p.bounds.xMin, p.bounds.yMax, { color: COLORS.text, baseline: 'top', offset: [14, 14], font: '700 15px "IBM Plex Sans", system-ui, sans-serif' });
    };

    // ---- Readouts ----------------------------------------------------------------------
    function update() {
      sSlider.value = state.s;
      setButtonLabel(swapButton, state.swapped ? 'Back to AB' : 'Swap order', 'swap');
      const AB = multiply(state.A, state.B);
      const BA = multiply(state.B, state.A);
      const name = state.swapped ? 'BA' : 'AB';
      const product = state.swapped ? BA : AB;
      productReadout.math(String.raw`${name} = ${matrixTex(product)}`);

      const [outer, inner] = state.swapped ? ['B', 'A'] : ['A', 'B'];
      const innerM = state.swapped ? state.A : state.B;
      const outerM = state.swapped ? state.B : state.A;
      const column = apply(outerM, [innerM.a, innerM.c]);
      columnReadout.math(String.raw`${outer}\,\htmlClass{c-green}{${vectorTex([innerM.a, innerM.c])}} = \htmlClass{c-green}{${vectorTex(column)}}\ \ \text{(${outer} times column 1 of ${inner})}`);

      compareReadout.math(
        matricesEqual(AB, BA, 1e-6)
          ? String.raw`AB = BA = ${matrixTex(AB, { colored: false })}\ \text{these commute!}`
          : String.raw`AB = ${matrixTex(AB, { colored: false })} \neq ${matrixTex(BA, { colored: false })} = BA`,
      );
      plot.render();
    }

    tour.go(0);

    return () => {
      animator.stop();
      plot.destroy();
    };
  },
};

function smooth(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

